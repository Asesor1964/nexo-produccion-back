const express = require('express');
const router = express.Router();
const db = require('../db');

// POST: Sincronizar / Importar lotes de Maestro de Productos
router.post('/sincronizar', async (req, res) => {
  const { productos } = req.body;

  if (!Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'No se recibieron productos para procesar' });
  }

  try {
    let insertados = 0;
    let omitidos = 0;

    for (const prod of productos) {
      const {
        codigo_producto, cliente, descripcion, material,
        largo_mm, ancho_mm, superficie_m2, herramientas, ruta_sugerida
      } = prod;

      const query = `
        INSERT INTO maestro_productos 
          (codigo_producto, cliente, descripcion, material, largo_mm, ancho_mm, superficie_m2, herramientas, ruta_sugerida)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (codigo_producto) DO UPDATE SET
          cliente = EXCLUDED.cliente,
          descripcion = EXCLUDED.descripcion,
          material = EXCLUDED.material,
          largo_mm = EXCLUDED.largo_mm,
          ancho_mm = EXCLUDED.ancho_mm,
          superficie_m2 = EXCLUDED.superficie_m2,
          herramientas = EXCLUDED.herramientas,
          ruta_sugerida = EXCLUDED.ruta_sugerida,
          fecha_actualizacion = CURRENT_TIMESTAMP;
      `;

      const values = [
        codigo_producto, cliente, descripcion, material || null,
        largo_mm || null, ancho_mm || null, superficie_m2 || null,
        herramientas || null, ruta_sugerida ? ruta_sugerida.trim() : null
      ];

      try {
        await db.query(query, values);
        insertados++;
      } catch (rowError) {
        console.error(`Error en producto ${codigo_producto}:`, rowError.message);
        omitidos++;
      }
    }

    // =========================================================================
    // 🚀 PASO 3: AUTO-DESCUBRIMIENTO DE RUTAS DESDE EL MAESTRO DE PRODUCTOS
    // Extrae cualquier ruta nueva del CSV recién importado y la activa en el catálogo
    // =========================================================================
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

    res.json({ 
      status: 'ok', 
      mensaje: `Sincronización completada.\n✅ Productos procesados: ${insertados}\n🛣️ Nuevas rutas detectadas y agregadas: ${nuevasRutas}\n⚠️ Omitidos: ${omitidos}` 
    });
  } catch (error) {
    console.error('Error al sincronizar productos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET: Obtener todos los productos
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM maestro_productos ORDER BY codigo_producto ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar la base de datos' });
  }
});

module.exports = router;