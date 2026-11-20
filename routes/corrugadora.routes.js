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

    // 2. Catálogo de Claves de Material (Simple y Doble Onda + RCT/CCT)
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.corrugadora_claves_material (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(80) UNIQUE NOT NULL,
        onda VARCHAR(20) DEFAULT 'C',
        es_doble_onda BOOLEAN DEFAULT FALSE,
        liner_ext_ideal VARCHAR(80),
        liner_ext_gramaje NUMERIC DEFAULT 0,
        liner_ext_rct NUMERIC DEFAULT 0,
        medium_ideal VARCHAR(80),
        onda1_gramaje NUMERIC DEFAULT 0,
        onda1_cct NUMERIC DEFAULT 0,
        liner_int_ideal VARCHAR(80),
        liner_int_gramaje NUMERIC DEFAULT 0,
        liner_int_rct NUMERIC DEFAULT 0,
        onda2_ideal VARCHAR(80),
        onda2_gramaje NUMERIC DEFAULT 0,
        onda2_cct NUMERIC DEFAULT 0,
        entretapa_ideal VARCHAR(80),
        entretapa_gramaje NUMERIC DEFAULT 0,
        entretapa_rct NUMERIC DEFAULT 0,
        gramaje_total_teorico NUMERIC DEFAULT 0,
        alternativas_aprobadas JSONB DEFAULT '[]'::jsonb,
        activo BOOLEAN DEFAULT TRUE
      );
    `);

    // Asegurar columnas nuevas si la tabla ya existía de la versión anterior
    await db.query(`
      ALTER TABLE public.corrugadora_claves_material
        ADD COLUMN IF NOT EXISTS es_doble_onda BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS liner_ext_gramaje NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS liner_ext_rct NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS onda1_gramaje NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS onda1_cct NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS liner_int_gramaje NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS liner_int_rct NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS onda2_ideal VARCHAR(80),
        ADD COLUMN IF NOT EXISTS onda2_gramaje NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS onda2_cct NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS entretapa_ideal VARCHAR(80),
        ADD COLUMN IF NOT EXISTS entretapa_gramaje NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS entretapa_rct NUMERIC DEFAULT 0;
    `).catch(() => {});

    // 3. Stock Real de Papeles / Bobinas (desde REGISTRO DE PAPELES.csv o Bobinas.csv)
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.corrugadora_stock_papeles (
        codigo VARCHAR(60) PRIMARY KEY,
        nombre VARCHAR(200),
        precio_kg NUMERIC DEFAULT 0,
        fabricante VARCHAR(100),
        proveedor VARCHAR(150),
        color VARCHAR(50),
        gramaje NUMERIC DEFAULT 0,
        tipo_papel VARCHAR(80),
        punto_pedido_kg NUMERIC DEFAULT 0,
        stock_kg NUMERIC DEFAULT 0,
        valor_stock NUMERIC DEFAULT 0,
        fsc VARCHAR(40),
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Cola Real de Pendientes de Corrugadora (desde PENDIENTES DE CORRUGADORA.csv)
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.corrugadora_pendientes (
        numero_orden INTEGER PRIMARY KEY,
        fecha_pedido DATE,
        fecha_entrega DATE,
        clave_material VARCHAR(80),
        ancho_pref_mm INTEGER,
        codigo_producto VARCHAR(60),
        cliente VARCHAR(180),
        descripcion TEXT,
        largo_mm NUMERIC DEFAULT 0,
        ancho_mm NUMERIC DEFAULT 0,
        cant_pedido NUMERIC DEFAULT 0,
        cajas NUMERIC DEFAULT 0,
        planchas_necesarias NUMERIC DEFAULT 0,
        pendiente NUMERIC DEFAULT 0,
        m2_pendientes NUMERIC DEFAULT 0,
        primer_pedido BOOLEAN DEFAULT FALSE,
        progr_siguiente NUMERIC DEFAULT 0,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Programa de Tiradas de Corrugadora
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.corrugadora_programas (
        id SERIAL PRIMARY KEY,
        codigo_tirada VARCHAR(50),
        clave_material VARCHAR(80) NOT NULL,
        papel_utilizado VARCHAR(180),
        es_alternativa_manual BOOLEAN DEFAULT FALSE,
        motivo_alternativa TEXT,
        ancho_bobina_mm INTEGER NOT NULL,
        ancho_utilizado_mm INTEGER NOT NULL,
        trim_mm INTEGER NOT NULL,
        trim_porcentaje NUMERIC(5,2) NOT NULL,
        metros_lineales NUMERIC(10,2) NOT NULL,
        consumo_estimado_kg NUMERIC(10,2) DEFAULT 0,
        pistas_detalle JSONB NOT NULL,
        estado VARCHAR(30) DEFAULT 'Programada',
        fecha_programacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      ALTER TABLE public.corrugadora_programas
        ADD COLUMN IF NOT EXISTS consumo_estimado_kg NUMERIC(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS prioridad_secuencia INTEGER DEFAULT 999,
        ADD COLUMN IF NOT EXISTS metros_reales NUMERIC(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMP,
        ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMP;
    `).catch(() => {});

  } catch (err) {
    console.error('Aviso inicializando tablas de Corrugadora:', err.message);
  }
};
asegurarTablasCorrugadora();

const normalizarClave = (txt) => {
  if (!txt) return 'SIN_CLAVE';
  return String(txt).replace(/"/g, '').trim().toUpperCase();
};

const parseFechaISO = (fechaStr) => {
  if (!fechaStr) return null;
  const limpia = String(fechaStr).trim();
  if (!limpia) return null;
  const partes = limpia.split(/[\/\-]/);
  if (partes.length === 3) {
    if (partes[0].length === 4) return limpia;
    const dia = partes[0].padStart(2, '0');
    const mes = partes[1].padStart(2, '0');
    const anio = partes[2].length === 2 ? `20${partes[2]}` : partes[2];
    const iso = `${anio}-${mes}-${dia}`;
    return isNaN(Date.parse(iso)) ? null : iso;
  }
  return null;
};

// Calcula el gramaje efectivo por m² de plancha (incluyendo factor de acanalado ~1.38 en ondas)
const calcularGramajeEfectivoClave = (claveObj) => {
  if (!claveObj) return 420; // Fallback estándar si no está cargada la receta
  const le = Number(claveObj.liner_ext_gramaje) || 0;
  const o1 = (Number(claveObj.onda1_gramaje) || 0) * 1.38;
  const li = Number(claveObj.liner_int_gramaje) || 0;
  const o2 = (Number(claveObj.onda2_gramaje) || 0) * 1.38;
  const ent = Number(claveObj.entretapa_gramaje) || 0;
  const suma = le + o1 + li + o2 + ent;
  return suma > 0 ? suma : (Number(claveObj.gramaje_total_teorico) || 420);
};

// =========================================================================
// 2. ENDPOINTS DE IMPORTACIÓN DE LOS 4 CSV (CLAVES, PAPELES/BOBINAS, PENDIENTES)
// =========================================================================

// A) Importar CLAVES.csv
router.post('/importar-claves', async (req, res) => {
  const { claves = [] } = req.body;
  if (!Array.isArray(claves) || claves.length === 0) {
    return res.status(400).json({ error: 'No se recibieron claves válidas.' });
  }
  try {
    let procesadas = 0;
    for (const c of claves) {
      const clave = normalizarClave(c.clave);
      if (!clave || clave === 'SIN_CLAVE') continue;

      const esDoble = Boolean(c.onda2_ideal || (Number(c.onda2_gramaje) || 0) > 0);
      const gramajeTotal =
        (Number(c.liner_ext_gramaje) || 0) +
        (Number(c.onda1_gramaje) || 0) +
        (Number(c.liner_int_gramaje) || 0) +
        (Number(c.onda2_gramaje) || 0) +
        (Number(c.entretapa_gramaje) || 0);

      await db.query(
        `INSERT INTO public.corrugadora_claves_material (
           clave, onda, es_doble_onda,
           liner_ext_ideal, liner_ext_gramaje, liner_ext_rct,
           medium_ideal, onda1_gramaje, onda1_cct,
           liner_int_ideal, liner_int_gramaje, liner_int_rct,
           onda2_ideal, onda2_gramaje, onda2_cct,
           entretapa_ideal, entretapa_gramaje, entretapa_rct,
           gramaje_total_teorico
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
         )
         ON CONFLICT (clave) DO UPDATE SET
           onda = EXCLUDED.onda,
           es_doble_onda = EXCLUDED.es_doble_onda,
           liner_ext_ideal = EXCLUDED.liner_ext_ideal,
           liner_ext_gramaje = EXCLUDED.liner_ext_gramaje,
           liner_ext_rct = EXCLUDED.liner_ext_rct,
           medium_ideal = EXCLUDED.medium_ideal,
           onda1_gramaje = EXCLUDED.onda1_gramaje,
           onda1_cct = EXCLUDED.onda1_cct,
           liner_int_ideal = EXCLUDED.liner_int_ideal,
           liner_int_gramaje = EXCLUDED.liner_int_gramaje,
           liner_int_rct = EXCLUDED.liner_int_rct,
           onda2_ideal = EXCLUDED.onda2_ideal,
           onda2_gramaje = EXCLUDED.onda2_gramaje,
           onda2_cct = EXCLUDED.onda2_cct,
           entretapa_ideal = EXCLUDED.entretapa_ideal,
           entretapa_gramaje = EXCLUDED.entretapa_gramaje,
           entretapa_rct = EXCLUDED.entretapa_rct,
           gramaje_total_teorico = EXCLUDED.gramaje_total_teorico`,
        [
          clave,
          esDoble ? 'CB' : (clave.includes('B') ? 'B' : 'C'),
          esDoble,
          c.liner_ext_ideal || '', Number(c.liner_ext_gramaje) || 0, Number(c.liner_ext_rct) || 0,
          c.medium_ideal || '', Number(c.onda1_gramaje) || 0, Number(c.onda1_cct) || 0,
          c.liner_int_ideal || '', Number(c.liner_int_gramaje) || 0, Number(c.liner_int_rct) || 0,
          c.onda2_ideal || '', Number(c.onda2_gramaje) || 0, Number(c.onda2_cct) || 0,
          c.entretapa_ideal || '', Number(c.entretapa_gramaje) || 0, Number(c.entretapa_rct) || 0,
          gramajeTotal
        ]
      );
      procesadas++;
    }
    res.json({ status: 'ok', procesadas, mensaje: `Se sincronizaron ${procesadas} claves técnicas (Simple y Doble Onda) con sus RCT/CCT.` });
  } catch (error) {
    res.status(500).json({ error: 'Error importando CLAVES.csv: ' + error.message });
  }
});

// B) Importar REGISTRO DE PAPELES.csv o Bobinas.csv
router.post('/importar-papeles', async (req, res) => {
  const { papeles = [] } = req.body;
  if (!Array.isArray(papeles) || papeles.length === 0) {
    return res.status(400).json({ error: 'No se recibieron registros de papeles válidos.' });
  }
  try {
    let procesados = 0;
    let conStock = 0;
    for (const p of papeles) {
      const cod = String(p.codigo || '').trim();
      if (!cod || cod === '\\--' || cod === '--') continue;

      const stockKg = Number(p.stock_kg) || 0;
      if (stockKg > 0) conStock++;

      await db.query(
        `INSERT INTO public.corrugadora_stock_papeles (
           codigo, nombre, precio_kg, fabricante, proveedor, color, gramaje,
           tipo_papel, punto_pedido_kg, stock_kg, valor_stock, fsc, actualizado_en
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
         ON CONFLICT (codigo) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           precio_kg = EXCLUDED.precio_kg,
           fabricante = EXCLUDED.fabricante,
           proveedor = EXCLUDED.proveedor,
           color = EXCLUDED.color,
           gramaje = EXCLUDED.gramaje,
           tipo_papel = EXCLUDED.tipo_papel,
           punto_pedido_kg = EXCLUDED.punto_pedido_kg,
           stock_kg = EXCLUDED.stock_kg,
           valor_stock = EXCLUDED.valor_stock,
           fsc = EXCLUDED.fsc,
           actualizado_en = NOW()`,
        [
          cod,
          p.nombre || '',
          Number(p.precio_kg) || 0,
          p.fabricante || '',
          p.proveedor || '',
          p.color || '',
          Number(p.gramaje) || 0,
          p.tipo_papel || '',
          Number(p.punto_pedido_kg) || 0,
          stockKg,
          Number(p.valor_stock) || 0,
          p.fsc || ''
        ]
      );
      procesados++;
    }
    res.json({
      status: 'ok',
      procesados,
      conStock,
      mensaje: `Stock de papeles actualizado: ${procesados} papeles procesados (${conStock} con stock disponible > 0 kg).`
    });
  } catch (error) {
    res.status(500).json({ error: 'Error importando papeles/bobinas: ' + error.message });
  }
});

// C) Importar PENDIENTES DE CORRUGADORA.csv
router.post('/importar-pendientes', async (req, res) => {
  const { pendientes = [], reemplazar_cola = true } = req.body;
  if (!Array.isArray(pendientes) || pendientes.length === 0) {
    return res.status(400).json({ error: 'No se recibieron órdenes pendientes válidas.' });
  }
  try {
    if (reemplazar_cola) {
      await db.query('TRUNCATE TABLE public.corrugadora_pendientes');
    }

    let procesados = 0;
    for (const item of pendientes) {
      const numOrden = parseInt(item.numero_orden, 10);
      if (!numOrden || isNaN(numOrden)) continue;

      await db.query(
        `INSERT INTO public.corrugadora_pendientes (
           numero_orden, fecha_pedido, fecha_entrega, clave_material, ancho_pref_mm,
           codigo_producto, cliente, descripcion, largo_mm, ancho_mm,
           cant_pedido, cajas, planchas_necesarias, pendiente, m2_pendientes,
           primer_pedido, progr_siguiente, actualizado_en
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW())
         ON CONFLICT (numero_orden) DO UPDATE SET
           fecha_pedido = EXCLUDED.fecha_pedido,
           fecha_entrega = EXCLUDED.fecha_entrega,
           clave_material = EXCLUDED.clave_material,
           ancho_pref_mm = EXCLUDED.ancho_pref_mm,
           codigo_producto = EXCLUDED.codigo_producto,
           cliente = EXCLUDED.cliente,
           descripcion = EXCLUDED.descripcion,
           largo_mm = EXCLUDED.largo_mm,
           ancho_mm = EXCLUDED.ancho_mm,
           cant_pedido = EXCLUDED.cant_pedido,
           cajas = EXCLUDED.cajas,
           planchas_necesarias = EXCLUDED.planchas_necesarias,
           pendiente = EXCLUDED.pendiente,
           m2_pendientes = EXCLUDED.m2_pendientes,
           primer_pedido = EXCLUDED.primer_pedido,
           progr_siguiente = EXCLUDED.progr_siguiente,
           actualizado_en = NOW()`,
        [
          numOrden,
          parseFechaISO(item.fecha_pedido),
          parseFechaISO(item.fecha_entrega),
          normalizarClave(item.clave_material),
          item.ancho_pref_mm ? parseInt(item.ancho_pref_mm, 10) : null,
          String(item.codigo_producto || '').trim(),
          String(item.cliente || 'Sin cliente').trim(),
          String(item.descripcion || 'Sin descripción').trim(),
          Number(item.largo_mm) || 0,
          Number(item.ancho_mm) || 0,
          Number(item.cant_pedido) || 0,
          Number(item.cajas) || 0,
          Number(item.planchas_necesarias) || 0,
          Number(item.pendiente) || 0,
          Number(item.m2_pendientes) || 0,
          Boolean(item.primer_pedido),
          Number(item.progr_siguiente) || 0
        ]
      );
      procesados++;
    }

    res.json({
      status: 'ok',
      procesados,
      mensaje: `Cola de Corrugadora actualizada: ${procesados} órdenes pendientes reales cargadas.`
    });
  } catch (error) {
    res.status(500).json({ error: 'Error importando PENDIENTES DE CORRUGADORA.csv: ' + error.message });
  }
});

// =========================================================================
// 3. OBTENER CONTEXTO COMPLETO PARA EL PROGRAMADOR DE CORRUGADORA
// =========================================================================
router.get('/contexto', async (req, res) => {
  try {
    const [resAnchos, resClaves, resPapeles, resPendCorr, resProgramas] = await Promise.all([
      db.query('SELECT * FROM public.corrugadora_anchos_bobina ORDER BY ancho_mm ASC'),
      db.query('SELECT * FROM public.corrugadora_claves_material ORDER BY clave ASC'),
      db.query('SELECT * FROM public.corrugadora_stock_papeles WHERE stock_kg > 0 ORDER BY tipo_papel ASC, gramaje ASC'),
      db.query('SELECT * FROM public.corrugadora_pendientes WHERE pendiente > 0 ORDER BY fecha_entrega ASC NULLS LAST, numero_orden ASC'),
      db.query('SELECT * FROM public.corrugadora_programas ORDER BY id DESC LIMIT 40')
    ]);

    let pedidosNormalizados = [];
    let origenPedidos = 'CORRUGADORA_CSV';

    if (resPendCorr.rows.length > 0) {
      pedidosNormalizados = resPendCorr.rows.map(r => ({
        id: r.numero_orden,
        numero_orden: r.numero_orden,
        codigo_producto: r.codigo_producto,
        cliente: r.cliente,
        producto_descripcion: r.descripcion,
        clave_material: normalizarClave(r.clave_material),
        largo_mm: Number(r.largo_mm) || 0,
        ancho_mm: Number(r.ancho_mm) || 0,
        ancho_pref_mm: r.ancho_pref_mm ? Number(r.ancho_pref_mm) : null,
        cantidad_pendiente: Number(r.pendiente) || 0,
        planchas_necesarias: Number(r.pendiente) || 0,
        m2_pendientes: Number(r.m2_pendientes) || 0,
        fecha_entrega: r.fecha_entrega,
        bocas: 1
      }));
    } else {
      origenPedidos = 'ORDENES_PRODUCCION';
      const resOrd = await db.query(`
        SELECT 
          o.numero_orden AS id, o.numero_orden, o.codigo_producto,
          COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
          COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS producto_descripcion,
          GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) AS cantidad_pendiente,
          COALESCE(o.largo, p.largo_mm, 0) AS largo_mm,
          COALESCE(o.ancho, p.ancho_mm, 0) AS ancho_mm,
          COALESCE(p.bocas, 1) AS bocas,
          COALESCE(NULLIF(p.material, ''), NULLIF(o.plancha, ''), 'SIN_CLAVE') AS clave_raw,
          o.fecha_entrega
        FROM ordenes_produccion o
        LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
        WHERE TRIM(LOWER(COALESCE(o.estado, 'pendiente'))) IN ('pendiente', 'habilitada', 'finalizada parcial')
          AND GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) > 0
        ORDER BY o.fecha_entrega ASC NULLS LAST, o.numero_orden ASC
      `);
      pedidosNormalizados = resOrd.rows.map(r => {
        const cant = Number(r.cantidad_pendiente) || 0;
        const bocas = Math.max(1, Number(r.bocas) || 1);
        return {
          ...r,
          clave_material: normalizarClave(r.clave_raw),
          largo_mm: Number(r.largo_mm) || 0,
          ancho_mm: Number(r.ancho_mm) || 0,
          cantidad_pendiente: cant,
          bocas,
          planchas_necesarias: Math.ceil(cant / bocas)
        };
      });
    }

    // Unimos claves de la tabla maestra + claves detectadas en los pendientes
    const clavesMap = new Map();
    resClaves.rows.forEach(c => clavesMap.set(normalizarClave(c.clave), c));
    pedidosNormalizados.forEach(p => {
      if (p.clave_material && p.clave_material !== 'SIN_CLAVE' && !clavesMap.has(p.clave_material)) {
        clavesMap.set(p.clave_material, {
          clave: p.clave_material,
          onda: 'C',
          es_doble_onda: false,
          liner_ext_ideal: 'Sin receta cargada',
          medium_ideal: '',
          liner_int_ideal: '',
          alternativas_aprobadas: []
        });
      }
    });

    res.json({
      origen_pedidos: origenPedidos,
      anchos: resAnchos.rows,
      claves: Array.from(clavesMap.values()).sort((a, b) => a.clave.localeCompare(b.clave)),
      papeles_stock: resPapeles.rows,
      pedidos: pedidosNormalizados,
      programas: resProgramas.rows
    });
  } catch (error) {
    console.error('❌ Error cargando contexto de Corrugadora:', error.message);
    res.status(500).json({ error: 'Error al cargar contexto de corrugadora: ' + error.message });
  }
});

// =========================================================================
// 4. GESTIÓN DE ANCHOS DE BOBINA Y MATRIZ DE EQUIVALENCIAS DE PAPEL
// =========================================================================
router.post('/anchos', async (req, res) => {
  const { ancho_mm, observacion } = req.body;
  const anchoNum = parseInt(ancho_mm, 10);
  if (!anchoNum || anchoNum < 500 || anchoNum > 3500) {
    return res.status(400).json({ error: 'Ingresá un ancho de bobina válido en milímetros.' });
  }
  try {
    const result = await db.query(
      `INSERT INTO public.corrugadora_anchos_bobina (ancho_mm, activo, observacion)
       VALUES ($1, TRUE, $2)
       ON CONFLICT (ancho_mm) DO UPDATE SET activo = TRUE
       RETURNING *`,
      [anchoNum, observacion || 'Agregado por Programación']
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/anchos/:id/toggle', async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE public.corrugadora_anchos_bobina SET activo = NOT activo WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/claves/:clave', async (req, res) => {
  const claveClean = normalizarClave(req.params.clave);
  const { onda, liner_ext_ideal, medium_ideal, liner_int_ideal, gramaje_total_teorico, alternativas_aprobadas } = req.body;
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
        claveClean, onda || 'C', liner_ext_ideal || '', medium_ideal || '', liner_int_ideal || '',
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
// 5. 🧠 MOTOR DE IA: OPTIMIZADOR CON SLITTER (MÁX 5), GUILLOTINA (MÁX 2) Y CONSUMO KG
// =========================================================================
router.post('/optimizar', async (req, res) => {
  const {
    clave_objetivo,
    claves_compatibles = [],
    anchos_disponibles = [],
    trim_minimo_mm = 15,
    trim_maximo_pct = 5.5,
    forzar_ancho_bobina = null,
    forzar_orden_id = null,
    ordenes_seleccionadas = [] // 👈 NUEVO: lista puntual de N° de órdenes a corrugar hoy
  } = req.body;

  try {
    const [resPendCorr, resClaveInfo] = await Promise.all([
      db.query('SELECT * FROM public.corrugadora_pendientes WHERE pendiente > 0 ORDER BY fecha_entrega ASC NULLS LAST, numero_orden ASC'),
      db.query('SELECT * FROM public.corrugadora_claves_material WHERE clave = $1', [normalizarClave(clave_objetivo)])
    ]);

    const claveInfoObj = resClaveInfo.rows[0] || null;
    const gramajeEfectivoM2 = calcularGramajeEfectivoClave(claveInfoObj);

    let candidatosBase = [];
    if (resPendCorr.rows.length > 0) {
      candidatosBase = resPendCorr.rows.map(r => ({
        numero_orden: r.numero_orden,
        cliente: r.cliente,
        producto_descripcion: r.descripcion,
        clave_material: normalizarClave(r.clave_material),
        ancho_mm: Number(r.ancho_mm) || 0,
        largo_mm: Number(r.largo_mm) || 0,
        bocas: 1,
        planchas_necesarias: Number(r.pendiente) || 0,
        fecha_entrega: r.fecha_entrega
      }));
    } else {
      const resOrd = await db.query(`
        SELECT 
          o.numero_orden, COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
          COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS producto_descripcion,
          GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) AS cantidad_pendiente,
          COALESCE(o.largo, p.largo_mm, 0) AS largo_mm, COALESCE(o.ancho, p.ancho_mm, 0) AS ancho_mm,
          COALESCE(p.bocas, 1) AS bocas,
          COALESCE(NULLIF(p.material, ''), NULLIF(o.plancha, ''), 'SIN_CLAVE') AS clave_raw,
          o.fecha_entrega
        FROM ordenes_produccion o
        LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
        WHERE TRIM(LOWER(COALESCE(o.estado, 'pendiente'))) IN ('pendiente', 'habilitada', 'finalizada parcial')
          AND GREATEST(0, COALESCE(o.cantidad_programada, 0) - COALESCE(o.cantidad_fabricada, 0)) > 0
      `);
      candidatosBase = resOrd.rows.map(r => {
        const bocas = Math.max(1, Number(r.bocas) || 1);
        return {
          numero_orden: r.numero_orden,
          cliente: r.cliente,
          producto_descripcion: r.producto_descripcion,
          clave_material: normalizarClave(r.clave_raw),
          ancho_mm: Number(r.ancho_mm) || 0,
          largo_mm: Number(r.largo_mm) || 0,
          bocas,
          planchas_necesarias: Math.ceil((Number(r.cantidad_pendiente) || 0) / bocas),
          fecha_entrega: r.fecha_entrega
        };
      });
    }

    const clavesFiltro = new Set(
      [clave_objetivo, ...(Array.isArray(claves_compatibles) ? claves_compatibles : [])]
        .filter(Boolean)
        .map(normalizarClave)
    );

    const seleccionSet = new Set(
      (Array.isArray(ordenes_seleccionadas) ? ordenes_seleccionadas : []).map(Number)
    );

    const candidatos = candidatosBase
      .filter(p => p.ancho_mm > 100 && p.largo_mm > 100 && p.planchas_necesarias > 0)
      .filter(p => clavesFiltro.size === 0 || clavesFiltro.has(p.clave_material))
      .filter(p => seleccionSet.size === 0 || seleccionSet.has(Number(p.numero_orden))); // 👈 Solo los elegidos

    

    if (candidatos.length === 0) {
      return res.json({ propuestas: [], mensaje: 'No hay pedidos pendientes con medidas válidas para esta clave.' });
    }

    let bobinas = Array.isArray(anchos_disponibles) && anchos_disponibles.length > 0
      ? anchos_disponibles.map(Number).filter(n => n > 0)
      : ANCHOS_BASE_DEFAULT;

    if (forzar_ancho_bobina) bobinas = [Number(forzar_ancho_bobina)];

    const pool = candidatos.slice(0, 28);
    const propuestasCrudas = [];

    const evaluarCombinacion = (bobina, pistas) => {
      // 🛑 RESTRICCIÓN 1: Slitter máx. 5 cajas a lo ancho
      const salidasTotales = pistas.reduce((acc, p) => acc + p.salidas, 0);
      if (salidasTotales < 1 || salidasTotales > 5) return;

      // 🛑 RESTRICCIÓN 2: Guillotina máx. 2 largos diferentes
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
      const consumoEstimadoKg = Math.round((bobina / 1000) * metrosCorrida * (gramajeEfectivoM2 / 1000));

      let desbalanceTotalPct = 0;
      const detallePistas = metrosPorPista.map(p => {
        const planchasAProducir = Math.floor((metrosCorrida * 1000) / p.orden.largo_mm) * p.salidas;
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
          cumplimiento_pct: cumplimientoPct
        };
      });

      const scoreIA = Math.max(
        10,
        Math.min(99, Math.round(100 - (trimPct * 12) - ((desbalanceTotalPct / pistas.length) * 0.25) + 5))
      );

      const firma = `${bobina}|` + detallePistas.map(d => `${d.numero_orden}x${d.salidas}`).sort().join('+');

      propuestasCrudas.push({
        firma,
        score_ia: scoreIA,
        clave_material: pistas[0].orden.clave_material,
        ancho_bobina_mm: bobina,
        ancho_utilizado_mm: anchoUsado,
        trim_mm: trimMm,
        trim_porcentaje: trimPct,
        metros_lineales: metrosCorrida,
        consumo_estimado_kg: consumoEstimadoKg,
        pistas: detallePistas
      });
    };

    for (const bobina of bobinas) {
      for (let i = 0; i < pool.length; i++) {
        const ordA = pool[i];
        if (!forzar_orden_id || Number(ordA.numero_orden) === Number(forzar_orden_id)) {
          for (let sA = 1; sA <= 5; sA++) {
            evaluarCombinacion(bobina, [{ orden: ordA, salidas: sA }]);
          }
        }
        for (let j = i + 1; j < pool.length; j++) {
          const ordB = pool[j];
          if (forzar_orden_id && Number(ordA.numero_orden) !== Number(forzar_orden_id) && Number(ordB.numero_orden) !== Number(forzar_orden_id)) {
            continue;
          }
          for (let sA = 1; sA <= 4; sA++) {
            for (let sB = 1; sB <= 4; sB++) {
              if (sA + sB <= 5) {
                evaluarCombinacion(bobina, [{ orden: ordA, salidas: sA }, { orden: ordB, salidas: sB }]);
              }
            }
          }
        }
      }
    }

    const unicasMap = new Map();
    propuestasCrudas.forEach(prop => {
      if (!unicasMap.has(prop.firma)) unicasMap.set(prop.firma, prop);
    });

    const topPropuestas = Array.from(unicasMap.values())
      .sort((a, b) => b.score_ia - a.score_ia || a.trim_porcentaje - b.trim_porcentaje)
      .slice(0, 15);

    res.json({ propuestas: topPropuestas, total_candidatos: candidatos.length });
  } catch (error) {
    res.status(500).json({ error: 'Error al optimizar combinaciones: ' + error.message });
  }
});

// =========================================================================
// 6. APROBAR TIRADA
// =========================================================================
router.post('/aprobar-tirada', async (req, res) => {
  const {
    clave_material, papel_utilizado, es_alternativa_manual = false, motivo_alternativa = '',
    ancho_bobina_mm, ancho_utilizado_mm, trim_mm, trim_porcentaje,
    metros_lineales, consumo_estimado_kg = 0, pistas = [], habilitar_en_conversion = true
  } = req.body;

  if (!Array.isArray(pistas) || pistas.length === 0) {
    return res.status(400).json({ error: 'La tirada debe incluir al menos una pista.' });
  }

  try {
    const codigoTirada = `CORR-${Date.now().toString().slice(-6)}`;
    const ins = await db.query(
      `INSERT INTO public.corrugadora_programas (
         codigo_tirada, clave_material, papel_utilizado, es_alternativa_manual, motivo_alternativa,
         ancho_bobina_mm, ancho_utilizado_mm, trim_mm, trim_porcentaje, metros_lineales, consumo_estimado_kg, pistas_detalle, estado
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'Programada')
       RETURNING *`,
      [
        codigoTirada, normalizarClave(clave_material), papel_utilizado || 'Papel Estándar',
        Boolean(es_alternativa_manual), motivo_alternativa || '',
        Number(ancho_bobina_mm) || 0, Number(ancho_utilizado_mm) || 0,
        Number(trim_mm) || 0, Number(trim_porcentaje) || 0,
        Number(metros_lineales) || 0, Number(consumo_estimado_kg) || 0,
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
        ).catch(() => {});
      }
    }

    res.json({
      status: 'ok',
      mensaje: `Tirada ${codigoTirada} aprobada (${metros_lineales} mts · ~${consumo_estimado_kg} kg · Trim ${trim_porcentaje}%).`,
      programa: ins.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar tirada: ' + error.message });
  }
});

// =========================================================================
// 7. 🏭 COLA EN VIVO PARA CABINA DEL MAQUINISTA + SECUENCIADOR
// =========================================================================

// Obtener cola activa (En Proceso + Programadas) con receta de portabobinas
router.get('/cola-maquinista', async (req, res) => {
  try {
    const [resCola, resClaves] = await Promise.all([
      db.query(`
        SELECT * FROM public.corrugadora_programas
        WHERE estado IN ('En Proceso', 'Programada')
        ORDER BY
          CASE WHEN estado = 'En Proceso' THEN 0 ELSE 1 END,
          prioridad_secuencia ASC,
          id ASC
      `),
      db.query('SELECT * FROM public.corrugadora_claves_material')
    ]);

    const clavesMap = new Map();
    resClaves.rows.forEach(c => clavesMap.set(normalizarClave(c.clave), c));

    const colaEnriquecida = resCola.rows.map((prog, idx) => ({
      ...prog,
      orden_cola: idx + 1,
      receta: clavesMap.get(normalizarClave(prog.clave_material)) || null
    }));

    res.json({ cola: colaEnriquecida });
  } catch (error) {
    res.status(500).json({ error: 'Error cargando cola de corrugadora: ' + error.message });
  }
});

// Reordenar secuencia de fabricación (recibe array ordenado de IDs)
router.put('/programas/reordenar', async (req, res) => {
  const { ordenIds = [] } = req.body;
  if (!Array.isArray(ordenIds) || ordenIds.length === 0) {
    return res.status(400).json({ error: 'Enviá una lista válida de IDs.' });
  }
  try {
    for (let i = 0; i < ordenIds.length; i++) {
      await db.query(
        'UPDATE public.corrugadora_programas SET prioridad_secuencia = $1 WHERE id = $2',
        [i + 1, Number(ordenIds[i])]
      );
    }
    res.json({ status: 'ok', mensaje: 'Orden de fabricación actualizado.' });
  } catch (error) {
    res.status(500).json({ error: 'Error reordenando cola: ' + error.message });
  }
});

// Editar combinación de una tirada ya programada (sin perder su puesto)
router.put('/programas/:id', async (req, res) => {
  const {
    clave_material, papel_utilizado, es_alternativa_manual = false, motivo_alternativa = '',
    ancho_bobina_mm, ancho_utilizado_mm, trim_mm, trim_porcentaje,
    metros_lineales, consumo_estimado_kg = 0, pistas = []
  } = req.body;
  try {
    const upd = await db.query(
      `UPDATE public.corrugadora_programas
       SET clave_material = $1, papel_utilizado = $2, es_alternativa_manual = $3,
           motivo_alternativa = $4, ancho_bobina_mm = $5, ancho_utilizado_mm = $6,
           trim_mm = $7, trim_porcentaje = $8, metros_lineales = $9,
           consumo_estimado_kg = $10, pistas_detalle = $11::jsonb
       WHERE id = $12 AND estado = 'Programada'
       RETURNING *`,
      [
        normalizarClave(clave_material), papel_utilizado || 'Papel Estándar',
        Boolean(es_alternativa_manual), motivo_alternativa || '',
        Number(ancho_bobina_mm) || 0, Number(ancho_utilizado_mm) || 0,
        Number(trim_mm) || 0, Number(trim_porcentaje) || 0,
        Number(metros_lineales) || 0, Number(consumo_estimado_kg) || 0,
        JSON.stringify(pistas), Number(req.params.id)
      ]
    );
    if (upd.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró la tirada en estado Programada.' });
    }
    res.json({ status: 'ok', mensaje: `Combinación de ${upd.rows[0].codigo_tirada} actualizada.`, programa: upd.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error actualizando combinación: ' + error.message });
  }
});

// Cambiar estado desde Cabina del Maquinista (Iniciar / Finalizar)
router.put('/programas/:id/estado', async (req, res) => {
  const { estado, metros_reales } = req.body;
  try {
    if (estado === 'En Proceso') {
      await db.query(
        `UPDATE public.corrugadora_programas
         SET estado = 'En Proceso', fecha_inicio = COALESCE(fecha_inicio, NOW())
         WHERE id = $1`,
        [Number(req.params.id)]
      );
    } else if (estado === 'Finalizada') {
      await db.query(
        `UPDATE public.corrugadora_programas
         SET estado = 'Finalizada', metros_reales = $1, fecha_fin = NOW()
         WHERE id = $2`,
        [Number(metros_reales) || 0, Number(req.params.id)]
      );
    } else {
      await db.query(
        'UPDATE public.corrugadora_programas SET estado = $1 WHERE id = $2',
        [estado, Number(req.params.id)]
      );
    }
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: 'Error actualizando estado: ' + error.message });
  }
});

// Quitar tirada programada de la cola
router.delete('/programas/:id', async (req, res) => {
  try {
    await db.query(
      "DELETE FROM public.corrugadora_programas WHERE id = $1 AND estado = 'Programada'",
      [Number(req.params.id)]
    );
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;