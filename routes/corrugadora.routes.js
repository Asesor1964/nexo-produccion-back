const express = require('express');
const router = express.Router();
const db = require('../db');

const ANCHOS_BASE_DEFAULT = [1000, 1400, 1650, 1800, 1900, 2050, 2150];

// =========================================================================
// 1. INICIALIZACIÓN DE TABLAS DEL CEREBRO DE CORRUGADORA
// =========================================================================
const asegurarTablasCorrugadora = async () => {
  try {
    // 1. Formatos / Anchos de bobina disponibles
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.corrugadora_anchos_bobina (
        id SERIAL PRIMARY KEY,
        ancho_mm INTEGER UNIQUE NOT NULL,
        activo BOOLEAN DEFAULT TRUE,
        observacion VARCHAR(120)
      );
    `);

    for (const ancho of ANCHOS_BASE_DEFAULT) {
      await db.query(
        `INSERT INTO public.corrugadora_anchos_bobina (ancho_mm, activo, observacion)
         VALUES ($1, TRUE, 'Formato estándar de planta')
         ON CONFLICT (ancho_mm) DO NOTHING`,
        [ancho]
      );
    }

    // 2. Catálogo de Claves de Material (TMC1, TMC5, etc.) y Papeles Alternativos Permitidos
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.corrugadora_claves_material (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(50) UNIQUE NOT NULL,
        onda VARCHAR(20) DEFAULT 'C',
        liner_ext_ideal VARCHAR(80),
        medium_ideal VARCHAR(80),
        liner_int_ideal VARCHAR(80),
        gramaje_total_teorico NUMERIC DEFAULT 0,
        alternativas_aprobadas JSONB DEFAULT '[]'::jsonb,
        activo BOOLEAN DEFAULT TRUE
      );
    `);

    // 3. Programa de Tiradas de Corrugadora (Historial y Cola de Máquina Corrugadora)
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.corrugadora_programas (
        id SERIAL PRIMARY KEY,
        codigo_tirada VARCHAR(50),
        clave_material VARCHAR(50) NOT NULL,
        papel_utilizado VARCHAR(120),
        es_alternativa_manual BOOLEAN DEFAULT FALSE,
        motivo_alternativa TEXT,
        ancho_bobina_mm INTEGER NOT NULL,
        ancho_utilizado_mm INTEGER NOT NULL,
        trim_mm INTEGER NOT NULL,
        trim_porcentaje NUMERIC(5,2) NOT NULL,
        metros_lineales NUMERIC(10,2) NOT NULL,
        pistas_detalle JSONB NOT NULL,
        estado VARCHAR(30) DEFAULT 'Programada',
        fecha_programacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err) {
    console.error('Aviso inicializando tablas de Corrugadora:', err.message);
  }
};
asegurarTablasCorrugadora();

// Helper para detectar la clave (TMC1, TMC5, etc.) desde columnas de pedido o maestro_productos
const extraerClaveMaterial = (row) => {
  const directa = row.clave_material || row.material || row.plancha || row.rubro || '';
  const matchTMC = String(directa).toUpperCase().match(/\b([A-Z]{2,5}\d{1,3}[A-Z]?)\b/);
  if (matchTMC) return matchTMC[1];
  const limpia = String(directa).trim().toUpperCase();
  return limpia || 'SIN_CLAVE';
};

// =========================================================================
// 2. OBTENER CONTEXTO COMPLETO PARA EL PROGRAMADOR DE CORRUGADORA
// =========================================================================
router.get('/contexto', async (req, res) => {
  try {
    // Aseguramos columna opcional clave_material en ordenes_produccion y maestro_productos
    await db.query(`ALTER TABLE ordenes_produccion ADD COLUMN IF NOT EXISTS clave_material VARCHAR(50)`).catch(() => {});
    await db.query(`ALTER TABLE maestro_productos ADD COLUMN IF NOT EXISTS clave_material VARCHAR(50)`).catch(() => {});

    const [resAnchos, resClaves, resPedidos, resProgramas] = await Promise.all([
      db.query('SELECT * FROM public.corrugadora_anchos_bobina ORDER BY ancho_mm ASC'),
      db.query('SELECT * FROM public.corrugadora_claves_material ORDER BY clave ASC'),
      db.query(`
        SELECT 
          o.numero_orden AS id,
          o.numero_orden,
          o.codigo_producto,
          COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
          COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS producto_descripcion,
          COALESCE(o.cantidad_programada, 0) AS cantidad_programada,
          COALESCE(o.cantidad_fabricada, 0) AS cantidad_fabricada,
          GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) AS cantidad_pendiente,
          COALESCE(o.largo, p.largo_mm, 0) AS largo_mm,
          COALESCE(o.ancho, p.ancho_mm, 0) AS ancho_mm,
          COALESCE(p.bocas, 1) AS bocas,
          COALESCE(NULLIF(o.clave_material, ''), NULLIF(p.clave_material, ''), NULLIF(p.material, ''), NULLIF(o.plancha, ''), 'SIN_CLAVE') AS clave_raw,
          o.fecha_entrega,
          o.maquina_asignada,
          o.estado,
          o.prioridad_secuencia
        FROM ordenes_produccion o
        LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
        WHERE TRIM(LOWER(COALESCE(o.estado, 'pendiente'))) IN ('pendiente', 'habilitada', 'finalizada parcial')
          AND GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) > 0
        ORDER BY o.fecha_entrega ASC NULLS LAST, COALESCE(o.prioridad_secuencia, 9999) ASC, o.numero_orden ASC
      `),
      db.query('SELECT * FROM public.corrugadora_programas ORDER BY id DESC LIMIT 40')
    ]);

    const clavesMap = new Map();
    resClaves.rows.forEach(c => clavesMap.set(c.clave.toUpperCase(), c));

    const pedidosNormalizados = resPedidos.rows.map(r => {
      const claveDetectada = extraerClaveMaterial({ clave_material: r.clave_raw });
      const cantPend = Number(r.cantidad_pendiente) || 0;
      const bocas = Math.max(1, Number(r.bocas) || 1);
      const planchasNecesarias = Math.ceil(cantPend / bocas);

      return {
        ...r,
        clave_material: claveDetectada,
        cantidad_pendiente: cantPend,
        largo_mm: Number(r.largo_mm) || 0,
        ancho_mm: Number(r.ancho_mm) || 0,
        bocas,
        planchas_necesarias: planchasNecesarias
      };
    });

    // Autodescubrimos claves nuevas que vengan en los pedidos/productos y aún no estén en la tabla
    const clavesEnPedidos = Array.from(new Set(pedidosNormalizados.map(p => p.clave_material))).filter(c => c && c !== 'SIN_CLAVE');
    for (const clv of clavesEnPedidos) {
      if (!clavesMap.has(clv)) {
        const ins = await db.query(
          `INSERT INTO public.corrugadora_claves_material (clave, onda, liner_ext_ideal, medium_ideal, liner_int_ideal, alternativas_aprobadas)
           VALUES ($1, 'C', 'Kraft / Blanco Estándar', 'Onda Estándar', 'Kraft Estándar', '[]'::jsonb)
           ON CONFLICT (clave) DO NOTHING
           RETURNING *`,
          [clv]
        );
        if (ins.rows[0]) clavesMap.set(clv, ins.rows[0]);
      }
    }

    res.json({
      anchos: resAnchos.rows,
      claves: Array.from(clavesMap.values()).sort((a, b) => a.clave.localeCompare(b.clave)),
      pedidos: pedidosNormalizados,
      programas: resProgramas.rows
    });
  } catch (error) {
    console.error('❌ Error cargando contexto de Corrugadora:', error.message);
    res.status(500).json({ error: 'Error al cargar contexto de corrugadora: ' + error.message });
  }
});

// =========================================================================
// 3. GESTIÓN DE ANCHOS DE BOBINA Y MATRIZ DE EQUIVALENCIAS DE PAPEL
// =========================================================================
router.post('/anchos', async (req, res) => {
  const { ancho_mm, observacion } = req.body;
  const anchoNum = parseInt(ancho_mm, 10);
  if (!anchoNum || anchoNum < 500 || anchoNum > 3500) {
    return res.status(400).json({ error: 'Ingresá un ancho de bobina válido en milímetros (ej. 2200).' });
  }
  try {
    const result = await db.query(
      `INSERT INTO public.corrugadora_anchos_bobina (ancho_mm, activo, observacion)
       VALUES ($1, TRUE, $2)
       ON CONFLICT (ancho_mm) DO UPDATE SET activo = TRUE, observacion = COALESCE(EXCLUDED.observacion, corrugadora_anchos_bobina.observacion)
       RETURNING *`,
      [anchoNum, observacion || 'Agregado por Programación']
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/anchos/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'UPDATE public.corrugadora_anchos_bobina SET activo = NOT activo WHERE id = $1 RETURNING *',
      [id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar configuración ideal y alternativas de papel/gramaje aprobadas para una Clave (ej. TMC1)
router.put('/claves/:clave', async (req, res) => {
  const { clave } = req.params;
  const { onda, liner_ext_ideal, medium_ideal, liner_int_ideal, gramaje_total_teorico, alternativas_aprobadas } = req.body;
  const claveClean = String(clave || '').trim().toUpperCase();

  try {
    const result = await db.query(
      `INSERT INTO public.corrugadora_claves_material (
         clave, onda, liner_ext_ideal, medium_ideal, liner_int_ideal, gramaje_total_teorico, alternativas_aprobadas
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (clave) DO UPDATE SET
         onda = EXCLUDED.onda,
         liner_ext_ideal = EXCLUDED.liner_ext_ideal,
         medium_ideal = EXCLUDED.medium_ideal,
         liner_int_ideal = EXCLUDED.liner_int_ideal,
         gramaje_total_teorico = EXCLUDED.gramaje_total_teorico,
         alternativas_aprobadas = EXCLUDED.alternativas_aprobadas
       RETURNING *`,
      [
        claveClean,
        onda || 'C',
        liner_ext_ideal || '',
        medium_ideal || '',
        liner_int_ideal || '',
        Number(gramaje_total_teorico) || 0,
        JSON.stringify(Array.isArray(alternativas_aprobadas) ? alternativas_aprobadas : [])
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================================================================
// 4. 🧠 MOTOR DE IA: OPTIMIZADOR DE COMBINACIÓN Y TRIM CON RESTRICCIONES DE MÁQUINA
// =========================================================================
router.post('/optimizar', async (req, res) => {
  const {
    clave_objetivo,
    claves_compatibles = [],
    anchos_disponibles = [],
    trim_minimo_mm = 15,     // Refile mínimo técnico de cuchillas (15mm)
    trim_maximo_pct = 5.5,   // Máximo % de desperdicio tolerable
    forzar_ancho_bobina = null,
    forzar_orden_id = null
  } = req.body;

  try {
    const resPed = await db.query(`
      SELECT 
        o.numero_orden AS id,
        o.numero_orden,
        o.codigo_producto,
        COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
        COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS producto_descripcion,
        GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) AS cantidad_pendiente,
        COALESCE(o.largo, p.largo_mm, 0) AS largo_mm,
        COALESCE(o.ancho, p.ancho_mm, 0) AS ancho_mm,
        COALESCE(p.bocas, 1) AS bocas,
        COALESCE(NULLIF(o.clave_material, ''), NULLIF(p.clave_material, ''), NULLIF(p.material, ''), NULLIF(o.plancha, ''), 'SIN_CLAVE') AS clave_raw,
        o.fecha_entrega,
        o.maquina_asignada
      FROM ordenes_produccion o
      LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
      WHERE TRIM(LOWER(COALESCE(o.estado, 'pendiente'))) IN ('pendiente', 'habilitada', 'finalizada parcial')
        AND GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) > 0
      ORDER BY o.fecha_entrega ASC NULLS LAST, o.numero_orden ASC
    `);

    const clavesFiltro = new Set(
      [clave_objetivo, ...(Array.isArray(claves_compatibles) ? claves_compatibles : [])]
        .filter(Boolean)
        .map(c => String(c).trim().toUpperCase())
    );

    const candidatos = resPed.rows
      .map(r => {
        const clave = extraerClaveMaterial({ clave_material: r.clave_raw });
        const ancho = Number(r.ancho_mm) || 0;
        const largo = Number(r.largo_mm) || 0;
        const bocas = Math.max(1, Number(r.bocas) || 1);
        const planchas = Math.ceil((Number(r.cantidad_pendiente) || 0) / bocas);
        return {
          ...r,
          clave_material: clave,
          ancho_mm: ancho,
          largo_mm: largo,
          bocas,
          planchas_necesarias: planchas
        };
      })
      .filter(p => p.ancho_mm > 100 && p.largo_mm > 100 && p.planchas_necesarias > 0)
      .filter(p => clavesFiltro.size === 0 || clavesFiltro.has(p.clave_material));

    if (candidatos.length === 0) {
      return res.json({
        propuestas: [],
        mensaje: 'No hay pedidos pendientes con ancho/largo válidos para la clave seleccionada.'
      });
    }

    let bobinas = Array.isArray(anchos_disponibles) && anchos_disponibles.length > 0
      ? anchos_disponibles.map(Number).filter(n => n > 0)
      : ANCHOS_BASE_DEFAULT;

    if (forzar_ancho_bobina) {
      bobinas = [Number(forzar_ancho_bobina)];
    }

    const pool = candidatos.slice(0, 28);
    const propuestasCrudas = [];

    const evaluarCombinacion = (bobina, pistas) => {
      // 🛑 RESTRICCIÓN 1: El Slitter físico solo soporta cortar y marcar hasta un MÁXIMO DE 5 CAJAS a lo ancho
      const salidasTotales = pistas.reduce((acc, p) => acc + p.salidas, 0);
      if (salidasTotales < 1 || salidasTotales > 5) return;

      // 🛑 RESTRICCIÓN 2: La Guillotina maneja UNICAMENTE DOS MEDIDAS DE LARGO como máximo en simultáneo
      const largosUnicos = new Set(pistas.map(p => p.orden.largo_mm));
      if (largosUnicos.size > 2) return;

      const anchoUsado = pistas.reduce((acc, p) => acc + (p.orden.ancho_mm * p.salidas), 0);
      const trimMm = bobina - anchoUsado;
      if (trimMm < Number(trim_minimo_mm)) return;

      const trimPct = Number(((trimMm / bobina) * 100).toFixed(2));
      if (trimPct > Number(trim_maximo_pct)) return;

      const metrosPorPista = pistas.map(p => ({
        ...p,
        metros_ideales: Math.ceil((p.orden.planchas_necesarias / p.salidas) * (p.orden.largo_mm / 1000))
      }));

      const metrosCorrida = Math.max(50, Math.min(...metrosPorPista.map(m => m.metros_ideales)));

      let desbalanceTotalPct = 0;
      const detallePistas = metrosPorPista.map(p => {
        const planchasAProducir = Math.floor((metrosCorrida * 1000) / p.orden.largo_mm) * p.salidas;
        const cajasAProducir = planchasAProducir * p.orden.bocas;
        const cumplimientoPct = Math.min(150, Math.round((planchasAProducir / p.orden.planchas_necesarias) * 100));
        desbalanceTotalPct += Math.abs(100 - Math.min(100, cumplimientoPct));

        return {
          numero_orden: p.orden.numero_orden,
          cliente: p.orden.cliente,
          producto_descripcion: p.orden.producto_descripcion,
          clave_material: p.orden.clave_material,
          ancho_mm: p.orden.ancho_mm,
          largo_mm: p.orden.largo_mm,
          salidas: p.salidas,
          ancho_ocupado_mm: p.orden.ancho_mm * p.salidas,
          planchas_necesarias: p.orden.planchas_necesarias,
          planchas_tirada: planchasAProducir,
          cajas_tirada: cajasAProducir,
          cumplimiento_pct: cumplimientoPct,
          maquina_conversion: p.orden.maquina_asignada
        };
      });

      const penalizacionTrim = trimPct * 12;
      const penalizacionDesbalance = (desbalanceTotalPct / pistas.length) * 0.25;
      const bonusUrgencia = pistas.some(p => p.orden.fecha_entrega) ? 5 : 0;
      const scoreIA = Math.max(10, Math.min(99, Math.round(100 - penalizacionTrim - penalizacionDesbalance + bonusUrgencia)));

      const firma = `${bobina}|` + detallePistas
        .map(d => `${d.numero_orden}x${d.salidas}`)
        .sort()
        .join('+');

      propuestasCrudas.push({
        firma,
        score_ia: scoreIA,
        clave_material: pistas[0].orden.clave_material,
        ancho_bobina_mm: bobina,
        ancho_utilizado_mm: anchoUsado,
        trim_mm: trimMm,
        trim_porcentaje: trimPct,
        metros_lineales: metrosCorrida,
        pistas: detallePistas
      });
    };

    for (const bobina of bobinas) {
      for (let i = 0; i < pool.length; i++) {
        const ordA = pool[i];

        // Caso 1: Orden única (hasta 5 salidas a lo ancho, respetando el límite del slitter)
        if (!forzar_orden_id || Number(ordA.numero_orden) === Number(forzar_orden_id)) {
          for (let sA = 1; sA <= 5; sA++) {
            evaluarCombinacion(bobina, [{ orden: ordA, salidas: sA }]);
          }
        }

        // Caso 2: Combinación de 2 pedidos distintos en paralelo
        for (let j = i + 1; j < pool.length; j++) {
          const ordB = pool[j];
          if (
            forzar_orden_id &&
            Number(ordA.numero_orden) !== Number(forzar_orden_id) &&
            Number(ordB.numero_orden) !== Number(forzar_orden_id)
          ) {
            continue;
          }

          for (let sA = 1; sA <= 4; sA++) {
            for (let sB = 1; sB <= 4; sB++) {
              if (sA + sB <= 5) { // Garantiza que no supere el límite físico de 5 del slitter
                evaluarCombinacion(bobina, [
                  { orden: ordA, salidas: sA },
                  { orden: ordB, salidas: sB }
                ]);
              }
            }
          }
        }
      }
    }

    const unicasMap = new Map();
    propuestasCrudas.forEach(prop => {
      if (!unicasMap.has(prop.firma)) {
        unicasMap.set(prop.firma, prop);
      }
    });

    const topPropuestas = Array.from(unicasMap.values())
      .sort((a, b) => b.score_ia - a.score_ia || a.trim_porcentaje - b.trim_porcentaje)
      .slice(0, 15);

    res.json({
      propuestas: topPropuestas,
      total_candidatos: candidatos.length
    });
  } catch (error) {
    console.error('❌ Error en motor optimizador de corrugadora:', error.message);
    res.status(500).json({ error: 'Error al optimizar combinaciones: ' + error.message });
  }
});

// =========================================================================
// 5. APROBAR TIRADA (IA O MANUAL) Y HABILITAR ÓRDENES HIJAS A CONVERSIÓN
// =========================================================================
router.post('/aprobar-tirada', async (req, res) => {
  const {
    clave_material,
    papel_utilizado,
    es_alternativa_manual = false,
    motivo_alternativa = '',
    ancho_bobina_mm,
    ancho_utilizado_mm,
    trim_mm,
    trim_porcentaje,
    metros_lineales,
    pistas = [],
    habilitar_en_conversion = true
  } = req.body;

  if (!Array.isArray(pistas) || pistas.length === 0) {
    return res.status(400).json({ error: 'La tirada debe incluir al menos una orden/pista.' });
  }

  try {
    const codigoTirada = `CORR-${Date.now().toString().slice(-6)}`;

    const ins = await db.query(
      `INSERT INTO public.corrugadora_programas (
         codigo_tirada, clave_material, papel_utilizado, es_alternativa_manual, motivo_alternativa,
         ancho_bobina_mm, ancho_utilizado_mm, trim_mm, trim_porcentaje, metros_lineales, pistas_detalle, estado
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'Programada')
       RETURNING *`,
      [
        codigoTirada,
        String(clave_material || 'SIN_CLAVE').toUpperCase(),
        papel_utilizado || 'Papel Estándar según Clave',
        Boolean(es_alternativa_manual),
        motivo_alternativa || '',
        Number(ancho_bobina_mm) || 0,
        Number(ancho_utilizado_mm) || 0,
        Number(trim_mm) || 0,
        Number(trim_porcentaje) || 0,
        Number(metros_lineales) || 0,
        JSON.stringify(pistas)
      ]
    );

    if (habilitar_en_conversion) {
      for (const pista of pistas) {
        const numOrd = parseInt(pista.numero_orden, 10);
        if (!numOrd) continue;
        await db.query(
          `UPDATE ordenes_produccion
           SET estado = CASE WHEN TRIM(LOWER(COALESCE(estado, ''))) = 'pendiente' THEN 'Habilitada' ELSE estado END
           WHERE numero_orden = $1`,
          [numOrd]
        );
      }
    }

    res.json({
      status: 'ok',
      mensaje: `Tirada ${codigoTirada} aprobada (${metros_lineales} mts lineales · Trim ${trim_porcentaje}%).`,
      programa: ins.rows[0]
    });
  } catch (error) {
    console.error('❌ Error al aprobar tirada de corrugadora:', error.message);
    res.status(500).json({ error: 'Error al registrar tirada: ' + error.message });
  }
});

module.exports = router;