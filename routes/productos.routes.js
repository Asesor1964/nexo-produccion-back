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

router.post('/sincronizar', async (req, res) => {
  const { productos } = req.body;

  if (!Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'No se recibieron productos para procesar' });
  }

  try {
    await asegurarColumnasMaestro();

    let insertados = 0;
    let omitidos = 0;

    for (const prod of productos) {
      const {
        codigo_producto, cliente, descripcion, material,
        largo_mm, ancho_mm, superficie_m2, herramientas, ruta_sugerida,
        plano, troquel, ubic_troquel, clise, ubic_clise, bocas
      } = prod;

      if (!codigo_producto) continue;

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

      const resumenColores = textoColores || [c1, c2, c3, c4, c5, c6].filter(Boolean).join(', ') || null;
      const bocasNum = bocas !== undefined && bocas !== null && bocas !== '' ? parseInt(bocas, 10) : null;

      // 🛡️ BLINDAJE TOTAL: COALESCE evita que una actualización parcial borre datos ya existentes
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
        cliente || null,
        descripcion || null,
        material || null,
        largo_mm || null,
        ancho_mm || null,
        superficie_m2 || null,
        herramientas || null,
        ruta_sugerida ? ruta_sugerida.trim() : null,
        resumenColores, c1, c2, c3, c4, c5, c6,
        plano || null,
        troquel || null,
        ubic_troquel || null,
        clise || null,
        ubic_clise || null,
        bocasNum
      ];

      try {
        await db.query(query, values);
        insertados++;
      } catch (rowError) {
        console.error(`Error en producto ${codigo_producto}:`, rowError.message);
        omitidos++;
      }
    }

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

    const nuevasRutas = rutasRes.rowCount || 0;

    // Sincronizamos el inventario de Clisés y Troqueles
    let resumenHerramentales = '';
    try {
      const { troquelesSinc, clisesSinc } = await poblarInventarioDesdeMaestro();
      resumenHerramentales = `\n🔪 Troqueles actualizados: ${troquelesSinc}\n🎨 Clisés actualizados: ${clisesSinc}`;
    } catch (e) {
      console.error('Aviso sincronizando herramentales:', e.message);
    }

    res.json({ 
      status: 'ok', 
      mensaje: `Sincronización completada.\n✅ Productos procesados: ${insertados}\n🛣️ Nuevas rutas detectadas: ${nuevasRutas}${resumenHerramentales}\n⚠️ Omitidos: ${omitidos}` 
    });
  } catch (error) {
    console.error('Error al sincronizar productos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
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