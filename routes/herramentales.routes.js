const express = require('express');
const router = express.Router();
const db = require('../db');

// Códigos de parada que disparan alerta automática en el herramental
const PARADAS_ALERTA_TROQUEL = ['23', '28', '65', '82'];
const PARADAS_ALERTA_CLISE = ['18', '25', '29', '50', '60'];

// 🛠️ Inicialización automática de tablas en PostgreSQL
const asegurarTablasHerramentales = async () => {
  await db.query(`
    ALTER TABLE maestro_productos
      ADD COLUMN IF NOT EXISTS plano VARCHAR(100),
      ADD COLUMN IF NOT EXISTS troquel VARCHAR(150),
      ADD COLUMN IF NOT EXISTS ubic_troquel VARCHAR(150),
      ADD COLUMN IF NOT EXISTS clise VARCHAR(150),
      ADD COLUMN IF NOT EXISTS ubic_clise VARCHAR(150),
      ADD COLUMN IF NOT EXISTS bocas INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS colores TEXT,
      ADD COLUMN IF NOT EXISTS color_1 VARCHAR(80),
      ADD COLUMN IF NOT EXISTS color_2 VARCHAR(80),
      ADD COLUMN IF NOT EXISTS color_3 VARCHAR(80),
      ADD COLUMN IF NOT EXISTS color_4 VARCHAR(80),
      ADD COLUMN IF NOT EXISTS color_5 VARCHAR(80),
      ADD COLUMN IF NOT EXISTS color_6 VARCHAR(80);
  `);

  await db.query(`
    ALTER TABLE ordenes_produccion
      ADD COLUMN IF NOT EXISTS estado_alistamiento_clise VARCHAR(40) DEFAULT 'Pendiente',
      ADD COLUMN IF NOT EXISTS estado_alistamiento_troquel VARCHAR(40) DEFAULT 'Pendiente',
      ADD COLUMN IF NOT EXISTS obs_alistamiento TEXT;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventario_troqueles (
      id SERIAL PRIMARY KEY,
      codigo_troquel VARCHAR(120) UNIQUE NOT NULL,
      plano VARCHAR(100),
      ubicacion VARCHAR(150) DEFAULT 'SIN UBICACIÓN',
      ubicacion_editada_manual BOOLEAN DEFAULT FALSE,
      bocas INTEGER DEFAULT 1,
      estado VARCHAR(40) DEFAULT 'Disponible',
      golpes_actuales INTEGER DEFAULT 0,
      golpes_totales INTEGER DEFAULT 0,
      limite_golpes INTEGER DEFAULT 300000,
      productos_asociados TEXT,
      clientes_asociados TEXT,
      version_actual INTEGER DEFAULT 1,
      reemplazado_por VARCHAR(120),
      motivo_baja TEXT,
      fecha_ultimo_mantenimiento TIMESTAMP,
      observaciones TEXT,
      actualizado_en TIMESTAMP DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventario_clises (
      id SERIAL PRIMARY KEY,
      codigo_clise VARCHAR(120) UNIQUE NOT NULL,
      ubicacion VARCHAR(150) DEFAULT 'SIN UBICACIÓN',
      ubicacion_editada_manual BOOLEAN DEFAULT FALSE,
      bocas INTEGER DEFAULT 1,
      estado VARCHAR(40) DEFAULT 'Disponible',
      giros_actuales INTEGER DEFAULT 0,
      giros_totales INTEGER DEFAULT 0,
      limite_giros INTEGER DEFAULT 250000,
      cantidad_colores INTEGER DEFAULT 1,
      colores_resumen TEXT,
      cuerpos_json JSONB DEFAULT '[]'::jsonb,
      productos_asociados TEXT,
      clientes_asociados TEXT,
      version_actual INTEGER DEFAULT 1,
      reemplazado_por VARCHAR(120),
      motivo_baja TEXT,
      fecha_ultimo_mantenimiento TIMESTAMP,
      observaciones TEXT,
      actualizado_en TIMESTAMP DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS herramentales_historial (
      id SERIAL PRIMARY KEY,
      tipo VARCHAR(20) NOT NULL,
      codigo VARCHAR(120) NOT NULL,
      accion VARCHAR(80) NOT NULL,
      detalle TEXT,
      usuario VARCHAR(100),
      fecha TIMESTAMP DEFAULT NOW()
    );
  `);
};

asegurarTablasHerramentales().catch(err =>
  console.error('Error inicializando tablas de herramentales:', err.message)
);

// Helper para armar el array de polímeros (1 a 6 colores) de un Clisé
const construirCuerposColores = (coloresTexto, cuerposExistentes = [], girosBase = 0) => {
  const listaColores = String(coloresTexto || '')
    .split(/[,;/]/)
    .map(c => c.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (listaColores.length === 0) {
    return cuerposExistentes.length > 0
      ? cuerposExistentes
      : [{ cuerpo: 1, color: '1° COLOR ESTÁNDAR', giros_actuales: girosBase, giros_totales: girosBase, estado: 'OK' }];
  }

  return listaColores.map((colNombre, idx) => {
    const numCuerpo = idx + 1;
    const previo = Array.isArray(cuerposExistentes)
      ? cuerposExistentes.find(c => Number(c.cuerpo) === numCuerpo)
      : null;

    return {
      cuerpo: numCuerpo,
      color: colNombre.toUpperCase(),
      giros_actuales: previo ? Number(previo.giros_actuales) || 0 : girosBase,
      giros_totales: previo ? Number(previo.giros_totales) || 0 : girosBase,
      estado: previo?.estado || 'OK',
      fecha_reemplazo: previo?.fecha_reemplazo || null
    };
  });
};

// 🔄 Función interna y exportable para poblar inventario desde maestro_productos
const poblarInventarioDesdeMaestro = async () => {
  await asegurarTablasHerramentales();
  const { rows: productos } = await db.query(`SELECT * FROM maestro_productos`);

  const mapaTroqueles = new Map();
  const mapaClises = new Map();

  for (const p of productos) {
    const codProd = String(p.codigo_producto || '').trim();
    const cliente = String(p.cliente || '').trim();
    const bocas = Math.max(1, parseInt(p.bocas, 10) || 1);

    // 1. Procesar Troqueles (puede venir "JP-002 / SP-007")
    const rawTroquel = String(p.troquel || '').trim();
    if (rawTroquel && rawTroquel !== '-' && rawTroquel.toUpperCase() !== 'NO') {
      const codigosTroq = rawTroquel.split('/').map(t => t.trim().toUpperCase()).filter(Boolean);
      for (const codT of codigosTroq) {
        if (!mapaTroqueles.has(codT)) {
          mapaTroqueles.set(codT, {
            codigo_troquel: codT,
            plano: p.plano || null,
            ubicacion: p.ubic_troquel ? String(p.ubic_troquel).trim().toUpperCase() : 'SIN UBICACIÓN',
            bocas,
            productos: new Set(),
            clientes: new Set()
          });
        }
        const entryT = mapaTroqueles.get(codT);
        if (!entryT.plano && p.plano) entryT.plano = p.plano;
        if (entryT.ubicacion === 'SIN UBICACIÓN' && p.ubic_troquel) {
          entryT.ubicacion = String(p.ubic_troquel).trim().toUpperCase();
        }
        if (codProd) entryT.productos.add(codProd);
        if (cliente) entryT.clientes.add(cliente);
      }
    }

    // 2. Procesar Clisés (Diseño)
    const rawClise = String(p.clise || '').trim();
    if (
      rawClise &&
      rawClise !== '-' &&
      rawClise !== '0' &&
      !rawClise.toUpperCase().includes('SIN IMPRESION') &&
      !rawClise.toUpperCase().includes('S/IMP')
    ) {
      const codC = rawClise.toUpperCase();
      const coloresConcat =
        p.colores ||
        [p.color_1, p.color_2, p.color_3, p.color_4, p.color_5, p.color_6].filter(Boolean).join(', ');

      if (!mapaClises.has(codC)) {
        mapaClises.set(codC, {
          codigo_clise: codC,
          ubicacion: p.ubic_clise ? String(p.ubic_clise).trim().toUpperCase() : 'SIN UBICACIÓN',
          bocas,
          colores_resumen: coloresConcat || '',
          productos: new Set(),
          clientes: new Set()
        });
      }
      const entryC = mapaClises.get(codC);
      if (entryC.ubicacion === 'SIN UBICACIÓN' && p.ubic_clise) {
        entryC.ubicacion = String(p.ubic_clise).trim().toUpperCase();
      }
      if (!entryC.colores_resumen && coloresConcat) {
        entryC.colores_resumen = coloresConcat;
      }
      if (codProd) entryC.productos.add(codProd);
      if (cliente) entryC.clientes.add(cliente);
    }
  }

  let troquelesSinc = 0;
  for (const t of mapaTroqueles.values()) {
    const prodStr = Array.from(t.productos).slice(0, 15).join(', ');
    const cliStr = Array.from(t.clientes).slice(0, 8).join(', ');

    await db.query(
      `INSERT INTO inventario_troqueles (
        codigo_troquel, plano, ubicacion, bocas, productos_asociados, clientes_asociados
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (codigo_troquel) DO UPDATE SET
        plano = COALESCE(NULLIF(EXCLUDED.plano, ''), inventario_troqueles.plano),
        ubicacion = CASE
          WHEN inventario_troqueles.ubicacion_editada_manual = TRUE THEN inventario_troqueles.ubicacion
          WHEN EXCLUDED.ubicacion <> 'SIN UBICACIÓN' THEN EXCLUDED.ubicacion
          ELSE inventario_troqueles.ubicacion
        END,
        bocas = COALESCE(EXCLUDED.bocas, inventario_troqueles.bocas),
        productos_asociados = EXCLUDED.productos_asociados,
        clientes_asociados = EXCLUDED.clientes_asociados;`,
      [t.codigo_troquel, t.plano, t.ubicacion, t.bocas, prodStr, cliStr]
    );
    troquelesSinc++;
  }

  let clisesSinc = 0;
  for (const c of mapaClises.values()) {
    const prodStr = Array.from(c.productos).slice(0, 15).join(', ');
    const cliStr = Array.from(c.clientes).slice(0, 8).join(', ');

    const existenteRes = await db.query(
      `SELECT cuerpos_json, giros_actuales FROM inventario_clises WHERE codigo_clise = $1`,
      [c.codigo_clise]
    );
    const cuerposPrevios = existenteRes.rows[0]?.cuerpos_json || [];
    const girosBase = existenteRes.rows[0]?.giros_actuales || 0;
    const nuevosCuerpos = construirCuerposColores(c.colores_resumen, cuerposPrevios, girosBase);

    await db.query(
      `INSERT INTO inventario_clises (
        codigo_clise, ubicacion, bocas, cantidad_colores, colores_resumen, cuerpos_json, productos_asociados, clientes_asociados
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      ON CONFLICT (codigo_clise) DO UPDATE SET
        ubicacion = CASE
          WHEN inventario_clises.ubicacion_editada_manual = TRUE THEN inventario_clises.ubicacion
          WHEN EXCLUDED.ubicacion <> 'SIN UBICACIÓN' THEN EXCLUDED.ubicacion
          ELSE inventario_clises.ubicacion
        END,
        bocas = COALESCE(EXCLUDED.bocas, inventario_clises.bocas),
        cantidad_colores = EXCLUDED.cantidad_colores,
        colores_resumen = COALESCE(NULLIF(EXCLUDED.colores_resumen, ''), inventario_clises.colores_resumen),
        cuerpos_json = EXCLUDED.cuerpos_json,
        productos_asociados = EXCLUDED.productos_asociados,
        clientes_asociados = EXCLUDED.clientes_asociados;`,
      [
        c.codigo_clise,
        c.ubicacion,
        c.bocas,
        nuevosCuerpos.length,
        c.colores_resumen,
        JSON.stringify(nuevosCuerpos),
        prodStr,
        cliStr
      ]
    );
    clisesSinc++;
  }

  return { troquelesSinc, clisesSinc };
};

// ⚡ FUNCIÓN AUTOMÁTICA DE DESCUENTO DE GIROS Y GOLPES AL CERRAR UNA ORDEN
const registrarUsoPorOrden = async (numeroOrden, cantidadFabricada, paradas = []) => {
  try {
    await asegurarTablasHerramentales();
    const cant = parseFloat(cantidadFabricada) || 0;
    if (cant <= 0) return;

    const ordRes = await db.query(
      `SELECT o.numero_orden, o.codigo_producto, o.maquina_asignada,
              p.troquel, p.ubic_troquel, p.plano, p.clise, p.ubic_clise, p.bocas, p.colores,
              p.color_1, p.color_2, p.color_3, p.color_4, p.color_5, p.color_6
       FROM ordenes_produccion o
       LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
       WHERE o.numero_orden = $1`,
      [numeroOrden]
    );

    if (ordRes.rows.length === 0) return;
    const info = ordRes.rows[0];

    // Calcular bocas por golpe (de maestro_productos o de sufijo de ruta ej. COR-JSx2)
    let bocas = parseInt(info.bocas, 10) || 1;
    const matchRutaX = String(info.maquina_asignada || '').match(/X(\d+)$/i);
    if (matchRutaX && parseInt(matchRutaX[1], 10) > bocas) {
      bocas = parseInt(matchRutaX[1], 10);
    }

    const ciclos = Math.max(1, Math.round(cant / Math.max(1, bocas)));

    // Detectar si alguna parada reportó falla de troquel o clisé
    let alertaTroquel = false;
    let alertaClise = false;
    if (Array.isArray(paradas)) {
      for (const par of paradas) {
        const textoParada = String(par.codigo || par.motivo || '').toUpperCase();
        if (PARADAS_ALERTA_TROQUEL.some(cod => textoParada.startsWith(cod) || textoParada.includes('TROQUEL'))) {
          alertaTroquel = true;
        }
        if (PARADAS_ALERTA_CLISE.some(cod => textoParada.startsWith(cod) || textoParada.includes('CLIS'))) {
          alertaClise = true;
        }
      }
    }

    // 1. Sumar golpes al Troquel
    const rawTroq = String(info.troquel || '').trim();
    if (rawTroq && rawTroq !== '-') {
      const codsT = rawTroq.split('/').map(t => t.trim().toUpperCase()).filter(Boolean);
      const codPrincipalT = codsT[0];
      if (codPrincipalT) {
        await db.query(
          `INSERT INTO inventario_troqueles (codigo_troquel, plano, ubicacion, bocas, golpes_actuales, golpes_totales, estado)
           VALUES ($1, $2, COALESCE($3, 'SIN UBICACIÓN'), $4, $5, $5, $6)
           ON CONFLICT (codigo_troquel) DO UPDATE SET
             golpes_actuales = COALESCE(inventario_troqueles.golpes_actuales, 0) + $5,
             golpes_totales = COALESCE(inventario_troqueles.golpes_totales, 0) + $5,
             estado = CASE WHEN $7 = TRUE THEN 'Requiere Revisión' ELSE 'Disponible' END,
             actualizado_en = NOW()`,
          [
            codPrincipalT,
            info.plano || null,
            info.ubic_troquel || 'SIN UBICACIÓN',
            bocas,
            ciclos,
            alertaTroquel ? 'Requiere Revisión' : 'Disponible',
            alertaTroquel
          ]
        );

        await db.query(
          `INSERT INTO herramentales_historial (tipo, codigo, accion, detalle, usuario)
           VALUES ('TROQUEL', $1, 'PRODUCCIÓN ORDEN', $2, 'SISTEMA AUTOMÁTICO')`,
          [codPrincipalT, `Orden #${numeroOrden}: +${ciclos} golpes (${cant} cajas / ${bocas} bocas)${alertaTroquel ? ' ⚠️ ALERTA PARADA TROQUEL' : ''}`]
        );
      }
    }

    // 2. Sumar giros al Clisé y a cada uno de sus cuerpos de color
    const rawClise = String(info.clise || '').trim();
    if (
      rawClise &&
      rawClise !== '-' &&
      rawClise !== '0' &&
      !rawClise.toUpperCase().includes('SIN IMPRESION')
    ) {
      const codC = rawClise.toUpperCase();
      const cliseRes = await db.query(`SELECT * FROM inventario_clises WHERE codigo_clise = $1`, [codC]);

      const coloresTexto =
        info.colores ||
        [info.color_1, info.color_2, info.color_3, info.color_4, info.color_5, info.color_6].filter(Boolean).join(', ');

      let cuerpos = construirCuerposColores(coloresTexto, cliseRes.rows[0]?.cuerpos_json || [], 0);
      cuerpos = cuerpos.map(c => ({
        ...c,
        giros_actuales: (Number(c.giros_actuales) || 0) + ciclos,
        giros_totales: (Number(c.giros_totales) || 0) + ciclos,
        estado: alertaClise ? 'Revisar' : (c.estado || 'OK')
      }));

      await db.query(
        `INSERT INTO inventario_clises (
          codigo_clise, ubicacion, bocas, cantidad_colores, colores_resumen,
          cuerpos_json, giros_actuales, giros_totales, estado
        ) VALUES ($1, COALESCE($2, 'SIN UBICACIÓN'), $3, $4, $5, $6::jsonb, $7, $7, $8)
        ON CONFLICT (codigo_clise) DO UPDATE SET
          giros_actuales = COALESCE(inventario_clises.giros_actuales, 0) + $7,
          giros_totales = COALESCE(inventario_clises.giros_totales, 0) + $7,
          cuerpos_json = $6::jsonb,
          estado = CASE WHEN $9 = TRUE THEN 'Requiere Revisión' ELSE 'Disponible' END,
          actualizado_en = NOW()`,
        [
          codC,
          info.ubic_clise || 'SIN UBICACIÓN',
          bocas,
          cuerpos.length,
          coloresTexto,
          JSON.stringify(cuerpos),
          ciclos,
          alertaClise ? 'Requiere Revisión' : 'Disponible',
          alertaClise
        ]
      );

      await db.query(
        `INSERT INTO herramentales_historial (tipo, codigo, accion, detalle, usuario)
         VALUES ('CLISE', $1, 'PRODUCCIÓN ORDEN', $2, 'SISTEMA AUTOMÁTICO')`,
        [codC, `Orden #${numeroOrden}: +${ciclos} giros en ${cuerpos.length} color(es) (${cant} cajas / ${bocas} bocas)${alertaClise ? ' ⚠️ ALERTA PARADA CLISÉ' : ''}`]
      );
    }
  } catch (error) {
    console.error('Error en odómetro automático de herramentales:', error.message);
  }
};

// =========================================================================
// ENDPOINTS DE LA API DE HERRAMENTALES (/api/herramentales/...)
// =========================================================================

// 1. RADAR DE COLA ACTIVA PARA ALISTAMIENTO
router.get('/radar-cola', async (req, res) => {
  try {
    await asegurarTablasHerramentales();
    const query = `
      SELECT 
        o.numero_orden AS id, o.numero_orden, o.codigo_producto, o.cantidad_programada,
        o.estado, o.prioridad_secuencia, o.fecha_entrega,
        COALESCE(o.estado_alistamiento_clise, 'Pendiente') AS estado_alistamiento_clise,
        COALESCE(o.estado_alistamiento_troquel, 'Pendiente') AS estado_alistamiento_troquel,
        COALESCE(o.obs_alistamiento, '') AS obs_alistamiento,
        COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
        COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS descripcion,
        COALESCE(NULLIF(TRIM(o.maquina_asignada), ''), TRIM(UPPER(p.ruta_sugerida)), 'COR-JS') AS maquina,
        COALESCE(p.plano, '') AS plano,
        COALESCE(p.troquel, '') AS codigo_troquel,
        COALESCE(it.ubicacion, p.ubic_troquel, 'SIN UBICACIÓN') AS ubic_troquel,
        COALESCE(it.estado, 'Disponible') AS estado_troquel,
        COALESCE(it.golpes_actuales, 0) AS golpes_actuales,
        COALESCE(it.limite_golpes, 300000) AS limite_golpes,
        COALESCE(p.clise, '') AS codigo_clise,
        COALESCE(ic.ubicacion, p.ubic_clise, 'SIN UBICACIÓN') AS ubic_clise,
        COALESCE(ic.estado, 'Disponible') AS estado_clise,
        COALESCE(ic.giros_actuales, 0) AS giros_actuales,
        COALESCE(ic.limite_giros, 250000) AS limite_giros,
        COALESCE(ic.cantidad_colores, 1) AS cantidad_colores,
        COALESCE(ic.cuerpos_json, '[]'::jsonb) AS cuerpos_json,
        COALESCE(p.colores, '') AS colores,
        COALESCE(p.bocas, 1) AS bocas
      FROM ordenes_produccion o
      LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
      LEFT JOIN inventario_troqueles it ON UPPER(TRIM(SPLIT_PART(p.troquel, '/', 1))) = it.codigo_troquel
      LEFT JOIN inventario_clises ic ON UPPER(TRIM(p.clise)) = ic.codigo_clise
      WHERE UPPER(TRIM(COALESCE(o.estado, 'Pendiente'))) NOT IN ('FINALIZADA', 'CERRADO POR ACUERDO', 'CUMPLIDA', 'COMPLETADA', 'CERRADA')
      ORDER BY COALESCE(o.prioridad_secuencia, 9999) ASC, o.numero_orden ASC;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener radar de alistamiento: ' + error.message });
  }
});

// Actualizar checklist de alistamiento de una orden (En Perchero / Listo en Máquina / Faltante)
router.put('/radar-cola/:numero_orden/alistamiento', async (req, res) => {
  const { numero_orden } = req.params;
  const { estado_alistamiento_clise, estado_alistamiento_troquel, obs_alistamiento } = req.body;
  try {
    const result = await db.query(
      `UPDATE ordenes_produccion
       SET estado_alistamiento_clise = COALESCE($1, estado_alistamiento_clise),
           estado_alistamiento_troquel = COALESCE($2, estado_alistamiento_troquel),
           obs_alistamiento = COALESCE($3, obs_alistamiento)
       WHERE numero_orden = $4
       RETURNING *`,
      [estado_alistamiento_clise, estado_alistamiento_troquel, obs_alistamiento, parseInt(numero_orden, 10)]
    );
    res.json({ status: 'ok', orden: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar alistamiento: ' + error.message });
  }
});

// 2. SINCRONIZAR INVENTARIO DESDE MAESTRO DE PRODUCTOS
router.post('/sincronizar-desde-maestro', async (req, res) => {
  try {
    const { troquelesSinc, clisesSinc } = await poblarInventarioDesdeMaestro();
    res.json({
      status: 'ok',
      mensaje: `Inventario sincronizado desde Maestro de Productos.\n🔪 Troqueles procesados: ${troquelesSinc}\n🎨 Diseños de Clisé procesados: ${clisesSinc}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al sincronizar inventario: ' + error.message });
  }
});

// 3. LISTAR CLISÉS Y TROQUELES
router.get('/clises', async (req, res) => {
  try {
    await asegurarTablasHerramentales();
    const { rows } = await db.query(`SELECT * FROM inventario_clises ORDER BY codigo_clise ASC`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/troqueles', async (req, res) => {
  try {
    await asegurarTablasHerramentales();
    const { rows } = await db.query(`SELECT * FROM inventario_troqueles ORDER BY codigo_troquel ASC`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/historial', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM herramentales_historial ORDER BY id DESC LIMIT 150`);
    res.json(rows);
  } catch (error) {
    res.json([]);
  }
});

// 4. CRUD DE CLISÉS (ALTA, EDICIÓN DE UBICACIÓN PROTEGIDA, MANTENIMIENTO POR COLOR Y BAJA/NUEVA VERSIÓN)
router.post('/clises', async (req, res) => {
  const { codigo_clise, ubicacion, bocas, colores_resumen, limite_giros, productos_asociados, clientes_asociados, observaciones } = req.body;
  if (!codigo_clise) return res.status(400).json({ error: 'El código de clisé es obligatorio' });

  try {
    const cod = String(codigo_clise).trim().toUpperCase();
    const cuerpos = construirCuerposColores(colores_resumen, [], 0);
    const result = await db.query(
      `INSERT INTO inventario_clises (
        codigo_clise, ubicacion, ubicacion_editada_manual, bocas, cantidad_colores,
        colores_resumen, cuerpos_json, limite_giros, productos_asociados, clientes_asociados, observaciones
      ) VALUES ($1, $2, TRUE, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
      ON CONFLICT (codigo_clise) DO UPDATE SET
        ubicacion = EXCLUDED.ubicacion,
        ubicacion_editada_manual = TRUE,
        bocas = EXCLUDED.bocas,
        cantidad_colores = EXCLUDED.cantidad_colores,
        colores_resumen = EXCLUDED.colores_resumen,
        cuerpos_json = EXCLUDED.cuerpos_json,
        limite_giros = EXCLUDED.limite_giros,
        observaciones = EXCLUDED.observaciones,
        actualizado_en = NOW()
      RETURNING *`,
      [
        cod,
        String(ubicacion || 'SIN UBICACIÓN').trim().toUpperCase(),
        parseInt(bocas, 10) || 1,
        cuerpos.length,
        colores_resumen || '',
        JSON.stringify(cuerpos),
        parseInt(limite_giros, 10) || 250000,
        productos_asociados || '',
        clientes_asociados || '',
        observaciones || ''
      ]
    );
    res.json({ status: 'ok', clise: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar clisé: ' + error.message });
  }
});

router.put('/clises/:id', async (req, res) => {
  const { id } = req.params;
  const { ubicacion, estado, bocas, limite_giros, colores_resumen, cuerpos_json, observaciones } = req.body;
  try {
    const actualRes = await db.query(`SELECT * FROM inventario_clises WHERE id = $1`, [id]);
    if (actualRes.rows.length === 0) return res.status(404).json({ error: 'Clisé no encontrado' });
    const actual = actualRes.rows[0];

    const nuevaUbic = ubicacion !== undefined ? String(ubicacion).trim().toUpperCase() : actual.ubicacion;
    const cambioUbic = nuevaUbic !== actual.ubicacion;

    let nuevosCuerpos = cuerpos_json || actual.cuerpos_json;
    if (colores_resumen !== undefined && colores_resumen !== actual.colores_resumen && !cuerpos_json) {
      nuevosCuerpos = construirCuerposColores(colores_resumen, actual.cuerpos_json, actual.giros_actuales);
    }

    const result = await db.query(
      `UPDATE inventario_clises
       SET ubicacion = $1,
           ubicacion_editada_manual = CASE WHEN $2 = TRUE THEN TRUE ELSE ubicacion_editada_manual END,
           estado = COALESCE($3, estado),
           bocas = COALESCE($4, bocas),
           limite_giros = COALESCE($5, limite_giros),
           colores_resumen = COALESCE($6, colores_resumen),
           cuerpos_json = $7::jsonb,
           cantidad_colores = $8,
           observaciones = COALESCE($9, observaciones),
           actualizado_en = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        nuevaUbic,
        cambioUbic,
        estado,
        bocas ? parseInt(bocas, 10) : null,
        limite_giros ? parseInt(limite_giros, 10) : null,
        colores_resumen,
        JSON.stringify(nuevosCuerpos),
        Array.isArray(nuevosCuerpos) ? nuevosCuerpos.length : actual.cantidad_colores,
        observaciones,
        id
      ]
    );

    // Sincronizar también en maestro_productos si cambió la ubicación
    if (cambioUbic) {
      await db.query(`UPDATE maestro_productos SET ubic_clise = $1 WHERE UPPER(TRIM(clise)) = $2`, [nuevaUbic, actual.codigo_clise]);
    }

    res.json({ status: 'ok', clise: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar clisé: ' + error.message });
  }
});

// Reiniciar giros de 1 color específico o de todo el juego de clisés (Mantenimiento / Reposición de Polímero)
router.post('/clises/:id/mantenimiento', async (req, res) => {
  const { id } = req.params;
  const { cuerpo_numero, detalle, usuario } = req.body; // cuerpo_numero = null -> reinicia todos los colores
  try {
    const actualRes = await db.query(`SELECT * FROM inventario_clises WHERE id = $1`, [id]);
    if (actualRes.rows.length === 0) return res.status(404).json({ error: 'Clisé no encontrado' });
    const actual = actualRes.rows[0];

    let cuerpos = Array.isArray(actual.cuerpos_json) ? [...actual.cuerpos_json] : [];
    const hoyStr = new Date().toISOString().split('T')[0];

    let nuevosGirosCabecera = actual.giros_actuales;

    if (cuerpo_numero) {
      cuerpos = cuerpos.map(c =>
        Number(c.cuerpo) === Number(cuerpo_numero)
          ? { ...c, giros_actuales: 0, estado: 'OK', fecha_reemplazo: hoyStr }
          : c
      );
    } else {
      nuevosGirosCabecera = 0;
      cuerpos = cuerpos.map(c => ({ ...c, giros_actuales: 0, estado: 'OK', fecha_reemplazo: hoyStr }));
    }

    const result = await db.query(
      `UPDATE inventario_clises
       SET giros_actuales = $1,
           cuerpos_json = $2::jsonb,
           estado = 'Disponible',
           fecha_ultimo_mantenimiento = NOW(),
           actualizado_en = NOW()
       WHERE id = $3
       RETURNING *`,
      [nuevosGirosCabecera, JSON.stringify(cuerpos), id]
    );

    await db.query(
      `INSERT INTO herramentales_historial (tipo, codigo, accion, detalle, usuario)
       VALUES ('CLISE', $1, $2, $3, $4)`,
      [
        actual.codigo_clise,
        cuerpo_numero ? `REPOSICIÓN POLÍMERO COLOR ${cuerpo_numero}` : 'MANTENIMIENTO / REPOSICIÓN COMPLETA',
        detalle || 'Reinicio de contador de giros',
        usuario || 'ALISTAMIENTO'
      ]
    );

    res.json({ status: 'ok', clise: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error en mantenimiento de clisé: ' + error.message });
  }
});

// 5. CRUD DE TROQUELES (ALTA, EDICIÓN DE UBICACIÓN PROTEGIDA, ENGOMADO/CUCHILLAS)
router.post('/troqueles', async (req, res) => {
  const { codigo_troquel, plano, ubicacion, bocas, limite_golpes, productos_asociados, clientes_asociados, observaciones } = req.body;
  if (!codigo_troquel) return res.status(400).json({ error: 'El código de troquel es obligatorio' });

  try {
    const cod = String(codigo_troquel).trim().toUpperCase();
    const result = await db.query(
      `INSERT INTO inventario_troqueles (
        codigo_troquel, plano, ubicacion, ubicacion_editada_manual, bocas,
        limite_golpes, productos_asociados, clientes_asociados, observaciones
      ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8)
      ON CONFLICT (codigo_troquel) DO UPDATE SET
        plano = EXCLUDED.plano,
        ubicacion = EXCLUDED.ubicacion,
        ubicacion_editada_manual = TRUE,
        bocas = EXCLUDED.bocas,
        limite_golpes = EXCLUDED.limite_golpes,
        observaciones = EXCLUDED.observaciones,
        actualizado_en = NOW()
      RETURNING *`,
      [
        cod,
        plano || '',
        String(ubicacion || 'SIN UBICACIÓN').trim().toUpperCase(),
        parseInt(bocas, 10) || 1,
        parseInt(limite_golpes, 10) || 300000,
        productos_asociados || '',
        clientes_asociados || '',
        observaciones || ''
      ]
    );
    res.json({ status: 'ok', troquel: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar troquel: ' + error.message });
  }
});

router.put('/troqueles/:id', async (req, res) => {
  const { id } = req.params;
  const { plano, ubicacion, estado, bocas, limite_golpes, observaciones } = req.body;
  try {
    const actualRes = await db.query(`SELECT * FROM inventario_troqueles WHERE id = $1`, [id]);
    if (actualRes.rows.length === 0) return res.status(404).json({ error: 'Troquel no encontrado' });
    const actual = actualRes.rows[0];

    const nuevaUbic = ubicacion !== undefined ? String(ubicacion).trim().toUpperCase() : actual.ubicacion;
    const cambioUbic = nuevaUbic !== actual.ubicacion;

    const result = await db.query(
      `UPDATE inventario_troqueles
       SET plano = COALESCE($1, plano),
           ubicacion = $2,
           ubicacion_editada_manual = CASE WHEN $3 = TRUE THEN TRUE ELSE ubicacion_editada_manual END,
           estado = COALESCE($4, estado),
           bocas = COALESCE($5, bocas),
           limite_golpes = COALESCE($6, limite_golpes),
           observaciones = COALESCE($7, observaciones),
           actualizado_en = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        plano,
        nuevaUbic,
        cambioUbic,
        estado,
        bocas ? parseInt(bocas, 10) : null,
        limite_golpes ? parseInt(limite_golpes, 10) : null,
        observaciones,
        id
      ]
    );

    if (cambioUbic) {
      await db.query(`UPDATE maestro_productos SET ubic_troquel = $1 WHERE UPPER(TRIM(troquel)) LIKE '%' || $2 || '%'`, [nuevaUbic, actual.codigo_troquel]);
    }

    res.json({ status: 'ok', troquel: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar troquel: ' + error.message });
  }
});

router.post('/troqueles/:id/mantenimiento', async (req, res) => {
  const { id } = req.params;
  const { accion, detalle, reiniciar_golpes, usuario } = req.body;
  try {
    const actualRes = await db.query(`SELECT * FROM inventario_troqueles WHERE id = $1`, [id]);
    if (actualRes.rows.length === 0) return res.status(404).json({ error: 'Troquel no encontrado' });
    const actual = actualRes.rows[0];

    const result = await db.query(
      `UPDATE inventario_troqueles
       SET golpes_actuales = CASE WHEN $1 = TRUE THEN 0 ELSE golpes_actuales END,
           estado = 'Disponible',
           fecha_ultimo_mantenimiento = NOW(),
           actualizado_en = NOW()
       WHERE id = $2
       RETURNING *`,
      [reiniciar_golpes !== false, id]
    );

    await db.query(
      `INSERT INTO herramentales_historial (tipo, codigo, accion, detalle, usuario)
       VALUES ('TROQUEL', $1, $2, $3, $4)`,
      [
        actual.codigo_troquel,
        accion || 'CAMBIO DE GOMAS / CUCHILLAS',
        detalle || 'Mantenimiento preventivo/correctivo y puesta a cero de golpes parciales',
        usuario || 'TALLER ALISTAMIENTO'
      ]
    );

    res.json({ status: 'ok', troquel: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error en mantenimiento de troquel: ' + error.message });
  }
});

// 6. SACAR DE CIRCULACIÓN / REEMPLAZAR POR NUEVA VERSIÓN (CLISÉ O TROQUEL)
router.post('/:tipo/:id/reemplazar-baja', async (req, res) => {
  const { tipo, id } = req.params; // tipo: 'clises' o 'troqueles'
  const { motivo_baja, nuevo_codigo, nueva_ubicacion, usuario } = req.body;

  try {
    if (tipo === 'clises') {
      const actualRes = await db.query(`SELECT * FROM inventario_clises WHERE id = $1`, [id]);
      if (actualRes.rows.length === 0) return res.status(404).json({ error: 'Clisé no encontrado' });
      const actual = actualRes.rows[0];
      const codNuevo = nuevo_codigo ? String(nuevo_codigo).trim().toUpperCase() : null;

      await db.query(
        `UPDATE inventario_clises
         SET estado = 'Fuera de Circulación',
             motivo_baja = $1,
             reemplazado_por = $2,
             actualizado_en = NOW()
         WHERE id = $3`,
        [motivo_baja || 'Baja / Modificación de versión', codNuevo, id]
      );

      if (codNuevo) {
        const cuerposNuevos = construirCuerposColores(actual.colores_resumen, [], 0);
        const ubicFinal = nueva_ubicacion ? String(nueva_ubicacion).trim().toUpperCase() : actual.ubicacion;

        await db.query(
          `INSERT INTO inventario_clises (
            codigo_clise, ubicacion, ubicacion_editada_manual, bocas, cantidad_colores,
            colores_resumen, cuerpos_json, limite_giros, productos_asociados, clientes_asociados, version_actual
          ) VALUES ($1, $2, TRUE, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
          ON CONFLICT (codigo_clise) DO UPDATE SET
            estado = 'Disponible',
            ubicacion = EXCLUDED.ubicacion`,
          [
            codNuevo,
            ubicFinal,
            actual.bocas,
            cuerposNuevos.length,
            actual.colores_resumen,
            JSON.stringify(cuerposNuevos),
            actual.limite_giros,
            actual.productos_asociados,
            actual.clientes_asociados,
            (actual.version_actual || 1) + 1
          ]
        );

        // Actualizar maestro_productos para que apunte a la nueva versión del clisé
        await db.query(
          `UPDATE maestro_productos SET clise = $1, ubic_clise = $2 WHERE UPPER(TRIM(clise)) = $3`,
          [codNuevo, ubicFinal, actual.codigo_clise]
        );
      }

      await db.query(
        `INSERT INTO herramentales_historial (tipo, codigo, accion, detalle, usuario)
         VALUES ('CLISE', $1, 'BAJA / NUEVA VERSIÓN', $2, $3)`,
        [
          actual.codigo_clise,
          `Motivo: ${motivo_baja || 'Modificación'}${codNuevo ? ` -> Reemplazado por ${codNuevo}` : ''}`,
          usuario || 'ALISTAMIENTO'
        ]
      );

      return res.json({ status: 'ok', mensaje: `Clisé ${actual.codigo_clise} dado de baja${codNuevo ? ` y reemplazado por ${codNuevo}` : ''}.` });
    } else {
      const actualRes = await db.query(`SELECT * FROM inventario_troqueles WHERE id = $1`, [id]);
      if (actualRes.rows.length === 0) return res.status(404).json({ error: 'Troquel no encontrado' });
      const actual = actualRes.rows[0];
      const codNuevo = nuevo_codigo ? String(nuevo_codigo).trim().toUpperCase() : null;

      await db.query(
        `UPDATE inventario_troqueles
         SET estado = 'Fuera de Circulación',
             motivo_baja = $1,
             reemplazado_por = $2,
             actualizado_en = NOW()
         WHERE id = $3`,
        [motivo_baja || 'Baja / Modificación de versión', codNuevo, id]
      );

      if (codNuevo) {
        const ubicFinal = nueva_ubicacion ? String(nueva_ubicacion).trim().toUpperCase() : actual.ubicacion;

        await db.query(
          `INSERT INTO inventario_troqueles (
            codigo_troquel, plano, ubicacion, ubicacion_editada_manual, bocas,
            limite_golpes, productos_asociados, clientes_asociados, version_actual
          ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8)
          ON CONFLICT (codigo_troquel) DO UPDATE SET
            estado = 'Disponible',
            ubicacion = EXCLUDED.ubicacion`,
          [
            codNuevo,
            actual.plano,
            ubicFinal,
            actual.bocas,
            actual.limite_golpes,
            actual.productos_asociados,
            actual.clientes_asociados,
            (actual.version_actual || 1) + 1
          ]
        );

        await db.query(
          `UPDATE maestro_productos SET troquel = $1, ubic_troquel = $2 WHERE UPPER(TRIM(troquel)) = $3`,
          [codNuevo, ubicFinal, actual.codigo_troquel]
        );
      }

      await db.query(
        `INSERT INTO herramentales_historial (tipo, codigo, accion, detalle, usuario)
         VALUES ('TROQUEL', $1, 'BAJA / NUEVA VERSIÓN', $2, $3)`,
        [
          actual.codigo_troquel,
          `Motivo: ${motivo_baja || 'Modificación'}${codNuevo ? ` -> Reemplazado por ${codNuevo}` : ''}`,
          usuario || 'ALISTAMIENTO'
        ]
      );

      return res.json({ status: 'ok', mensaje: `Troquel ${actual.codigo_troquel} dado de baja${codNuevo ? ` y reemplazado por ${codNuevo}` : ''}.` });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al procesar baja/reemplazo: ' + error.message });
  }
});

module.exports = router;
module.exports.registrarUsoPorOrden = registrarUsoPorOrden;
module.exports.poblarInventarioDesdeMaestro = poblarInventarioDesdeMaestro;