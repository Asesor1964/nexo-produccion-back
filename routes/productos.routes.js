const express = require('express');
const router = express.Router();
const db = require('../db');
const { poblarInventarioDesdeMaestro } = require('./herramentales.routes');

const asegurarColumnasMaestro = async () => {
  const columnas = [
    'colores TEXT',
    'color_1 VARCHAR(100)',
    'color_2 VARCHAR(100)',
    'color_3 VARCHAR(100)',
    'color_4 VARCHAR(100)',
    'color_5 VARCHAR(100)',
    'color_6 VARCHAR(100)',
    'plano VARCHAR(100)',
    'troquel VARCHAR(150)',
    'ubic_troquel VARCHAR(150)',
    'clise VARCHAR(150)',
    'ubic_clise VARCHAR(150)',
    'bocas INTEGER DEFAULT 1'
  ];
  for (const col of columnas) {
    try {
      await db.query(`ALTER TABLE public.maestro_productos ADD COLUMN IF NOT EXISTS ${col}`);
    } catch (err) {
      console.error(`Aviso al verificar columna ${col}:`, err.message);
    }
  }
};
asegurarColumnasMaestro();

// Helpers para evitar que "NaN" o textos sucios rompan PostgreSQL
const limpiarEntero = (val, def = null) => {
  if (val === undefined || val === null || val === '') return def;
  const num = parseInt(String(val).replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(num) ? def : num;
};

const limpiarDecimal = (val, def = null) => {
  if (val === undefined || val === null || val === '') return def;
  const normalizado = String(val).replace(',', '.').replace(/[^\d.-]/g, '');
  const num = parseFloat(normalizado);
  return Number.isNaN(num) ? def : num;
};

router.post('/sincronizar', async (req, res) => {
  let client = null;
  let liberarCliente = false;

  try {
    const { productos, omitir_herramentales } = req.body || {};

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: 'No se recibieron productos para procesar' });
    }

    // 1. Obtener cliente de forma segura (soporta pool.connect() o db.pool.connect() o fallback a db)
    if (typeof db.connect === 'function') {
      client = await db.connect();
      liberarCliente = true;
    } else if (db.pool && typeof db.pool.connect === 'function') {
      client = await db.pool.connect();
      liberarCliente = true;
    } else {
      client = db; // Fallback si db.js solo exporta { query }
    }

    let insertados = 0;
    let omitidos = 0;

    // Si tenemos cliente dedicado, usamos transacción con SAVEPOINT
    if (liberarCliente) {
      await client.query('BEGIN');
    }

    for (const prod of productos) {
      if (!prod || !prod.codigo_producto) continue;

      const {
        codigo_producto, cliente, descripcion, material,
        largo_mm, ancho_mm, superficie_m2, herramientas, ruta_sugerida,
        plano, troquel, ubic_troquel, clise, ubic_clise, bocas
      } = prod;

      const textoColores = prod.colores || prod.tintas || prod.receta_colores || '';
      const listaColores = textoColores
        ? String(textoColores).split(/[,;/]/).map(c => c.trim()).filter(Boolean)
        : [];

      const c1 = prod.color_1 || prod.color1 || prod.tinta_1 || prod.tinta1 || listaColores[0] || null;
      const c2 = prod.color_2 || prod.color2 || prod.tinta_2 || prod.tinta2 || listaColores[1] || null;
      const c3 = prod.color_3 || prod.color3 || prod.tinta_3 || prod.tinta3 || listaColores[2] || null;
      const c4 = prod.color_4 || prod.color4 || prod.tinta_4 || prod.tinta4 || listaColores[3] || null;
      const c5 = prod.color_5 || prod.color5 || prod.tinta_5 || prod.tinta5 || listaColores[4] || null;
      const c6 = prod.color_6 || prod.color6 || prod.tinta_6 || prod.tinta6 || listaColores[5] || null;

      const resumenColores = textoColores ? String(textoColores) : ([c1, c2, c3, c4, c5, c6].filter(Boolean).join(', ') || null);
      const bocasNum = limpiarEntero(bocas, null);

      const query = `
        INSERT INTO maestro_productos (
          codigo_producto, cliente, descripcion, material,
          largo_mm, ancho_mm, superficie_m2, herramientas, ruta_sugerida,
          colores, color_1, color_2, color_3, color_4, color_5, color_6,
          plano, troquel, ubic_troquel, clise, ubic_clise, bocas
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, COALESCE($22, 1))
        ON CONFLICT (codigo_producto) DO UPDATE SET
          cliente = COALESCE(NULLIF(EXCLUDED.cliente, ''), maestro_productos.cliente),
          descripcion = COALESCE(NULLIF(EXCLUDED.descripcion, ''), maestro_productos.descripcion),
          material = COALESCE(NULLIF(EXCLUDED.material, ''), maestro_productos.material),
          largo_mm = COALESCE(EXCLUDED.largo_mm, maestro_productos.largo_mm),
          ancho_mm = COALESCE(EXCLUDED.ancho_mm, maestro_productos.ancho_mm),
          superficie_m2 = COALESCE(EXCLUDED.superficie_m2, maestro_productos.superficie_m2),
          herramientas = COALESCE(NULLIF(EXCLUDED.herramientas, ''), maestro_productos.herramientas),
          ruta_sugerida = COALESCE(NULLIF(EXCLUDED.ruta_sugerida, ''), maestro_productos.ruta_sugerida),
          colores = COALESCE(NULLIF(EXCLUDED.colores, ''), maestro_productos.colores),
          color_1 = COALESCE(NULLIF(EXCLUDED.color_1, ''), maestro_productos.color_1),
          color_2 = COALESCE(NULLIF(EXCLUDED.color_2, ''), maestro_productos.color_2),
          color_3 = COALESCE(NULLIF(EXCLUDED.color_3, ''), maestro_productos.color_3),
          color_4 = COALESCE(NULLIF(EXCLUDED.color_4, ''), maestro_productos.color_4),
          color_5 = COALESCE(NULLIF(EXCLUDED.color_5, ''), maestro_productos.color_5),
          color_6 = COALESCE(NULLIF(EXCLUDED.color_6, ''), maestro_productos.color_6),
          plano = COALESCE(NULLIF(EXCLUDED.plano, ''), maestro_productos.plano),
          troquel = COALESCE(NULLIF(EXCLUDED.troquel, ''), maestro_productos.troquel),
          ubic_troquel = COALESCE(NULLIF(EXCLUDED.ubic_troquel, ''), maestro_productos.ubic_troquel),
          clise = COALESCE(NULLIF(EXCLUDED.clise, ''), maestro_productos.clise),
          ubic_clise = COALESCE(NULLIF(EXCLUDED.ubic_clise, ''), maestro_productos.ubic_clise),
          bocas = COALESCE($22, maestro_productos.bocas, 1),
          fecha_actualizacion = CURRENT_TIMESTAMP;
      `;

      const values = [
        String(codigo_producto).trim(),
        cliente ? String(cliente).trim() : null,
        descripcion ? String(descripcion).trim() : null,
        material ? String(material).trim() : null,
        limpiarDecimal(largo_mm),
        limpiarDecimal(ancho_mm),
        limpiarDecimal(superficie_m2),
        herramientas ? String(herramientas).trim() : null,
        ruta_sugerida ? String(ruta_sugerida).trim() : null,
        resumenColores,
        c1 ? String(c1).trim() : null,
        c2 ? String(c2).trim() : null,
        c3 ? String(c3).trim() : null,
        c4 ? String(c4).trim() : null,
        c5 ? String(c5).trim() : null,
        c6 ? String(c6).trim() : null,
        plano ? String(plano).trim() : null,
        troquel ? String(troquel).trim() : null,
        ubic_troquel ? String(ubic_troquel).trim() : null,
        clise ? String(clise).trim() : null,
        ubic_clise ? String(ubic_clise).trim() : null,
        bocasNum
      ];

      try {
        if (liberarCliente) await client.query('SAVEPOINT sp_prod');
        await client.query(query, values);
        if (liberarCliente) await client.query('RELEASE SAVEPOINT sp_prod');
        insertados++;
      } catch (rowError) {
        if (liberarCliente) await client.query('ROLLBACK TO SAVEPOINT sp_prod');
        console.error(`Error en producto ${codigo_producto}:`, rowError.message);
        omitidos++;
      }
    }

    if (liberarCliente) {
      await client.query('COMMIT');
      // Liberamos el cliente ANTES de llamar a poblarInventarioDesdeMaestro para no agotar el pool
      client.release();
      liberarCliente = false;
    }

    let nuevasRutas = 0;
    let resumenHerramentales = '';

    // Solo sincronizamos rutas y herramentales al finalizar el último lote
    if (!omitir_herramentales) {
      try {
        const rutasRes = await db.query(`
          INSERT INTO rutas_produccion (codigo_ruta, descripcion, activo)
          SELECT DISTINCT 
            TRIM(UPPER(ruta_sugerida)) AS codigo_ruta, 
            TRIM(ruta_sugerida) AS descripcion, 
            TRUE AS activo
          FROM maestro_productos
          WHERE ruta_sugerida IS NOT NULL 
            AND TRIM(ruta_sugerida) <> ''
          ON CONFLICT (codigo_ruta) DO NOTHING
          RETURNING *;
        `);
        nuevasRutas = rutasRes.rowCount || 0;
      } catch (errRutas) {
        console.error('Aviso sincronizando rutas:', errRutas.message);
      }

      try {
        if (typeof poblarInventarioDesdeMaestro === 'function') {
          const { troquelesSinc, clisesSinc } = await poblarInventarioDesdeMaestro();
          resumenHerramentales = `\n🔪 Troqueles actualizados: ${troquelesSinc}\n🎨 Clisés actualizados: ${clisesSinc}`;
        }
      } catch (e) {
        console.error('Aviso sincronizando herramentales:', e.message);
      }
    }

    return res.json({ 
      status: 'ok',
      insertados,
      omitidos,
      nuevasRutas,
      resumenHerramentales,
      mensaje: `Sincronización completada.\n✅ Productos procesados: ${insertados}\n🛣️ Nuevas rutas detectadas: ${nuevasRutas}${resumenHerramentales}\n⚠️ Omitidos: ${omitidos}` 
    });

  } catch (error) {
    if (liberarCliente && client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('🔥 Error crítico al sincronizar productos:', error);
    return res.status(500).json({ 
      error: error.message || 'Error interno del servidor',
      detalle: error.detail || null
    });
  } finally {
    if (liberarCliente && client) {
      try { client.release(); } catch (e) {}
    }
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM maestro_productos ORDER BY codigo_producto ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar la base de datos' });
  }
});

router.get('/:codigo_producto', async (req, res) => {
  try {
    const { codigo_producto } = req.params;
    const result = await db.query(
      'SELECT * FROM maestro_productos WHERE TRIM(CAST(codigo_producto AS TEXT)) = TRIM($1) LIMIT 1',
      [String(codigo_producto)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar producto' });
  }
});

module.exports = router;