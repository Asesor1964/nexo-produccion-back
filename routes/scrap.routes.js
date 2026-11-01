const express = require('express');
const router = express.Router();
const db = require('../db');

// Función auxiliar para descubrir automáticamente cómo se llama la tabla de órdenes en PostgreSQL
async function obtenerTablaOrdenes() {
  const posiblesTablas = ['ordenes_produccion', 'ordenes', 'produccion', 'pedidos', 'programacion', 'ot'];
  for (const tabla of posiblesTablas) {
    const res = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [tabla]
    );
    if (res.rows.length > 0) return tabla;
  }
  return null;
}

// 1. POST: Registrar Scrap en Kilogramos con balanza virtual
router.post('/', async (req, res) => {
  const { orden_id, codigo_maquina, zona, cantidad_piezas, peso_kg, motivo, observaciones } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO registro_scrap (orden_id, codigo_maquina, zona, cantidad_piezas, peso_kg, motivo, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [orden_id || null, codigo_maquina, zona, cantidad_piezas, peso_kg, motivo, observaciones || '']
    );
    console.log(`⚖️ [SCRAP REGISTRADO] Máq: ${codigo_maquina} | Zona: ${zona} | Cant: ${cantidad_piezas} | Peso: ${peso_kg} Kg`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error al registrar scrap:', error);
    res.status(500).json({ error: 'Error al registrar el scrap' });
  }
});

// 2. GET: Rutas ESTÁTICAS primero
router.get('/resumen', async (req, res) => {
  try {
    const queryMotivos = `
      SELECT motivo, zona, SUM(peso_kg) as total_kg, COUNT(*) as cantidad_eventos 
      FROM registro_scrap 
      GROUP BY motivo, zona 
      ORDER BY total_kg DESC;
    `;
    const queryMaquinas = `
      SELECT codigo_maquina, zona, SUM(peso_kg) as total_kg 
      FROM registro_scrap 
      GROUP BY codigo_maquina, zona 
      ORDER BY total_kg DESC;
    `;
    
    const resMotivos = await db.query(queryMotivos);
    const resMaquinas = await db.query(queryMaquinas);

    res.json({
      porMotivo: resMotivos.rows,
      porMaquina: resMaquinas.rows
    });
  } catch (error) {
    console.error('❌ Error al obtener resumen de scrap:', error);
    res.status(500).json({ error: 'Error al generar el reporte de scrap' });
  }
});

// GET: Listado detallado de scrap cruzado en memoria sin errores de relación SQL
router.get('/detallado', async (req, res) => {
  try {
    // 1. Traemos todos los registros de scrap
    const resScrap = await db.query('SELECT * FROM registro_scrap ORDER BY fecha_registro DESC');
    const filasScrap = resScrap.rows;

    // 2. Buscamos la tabla real de órdenes en la base de datos
    const tablaOrdenes = await obtenerTablaOrdenes();
    let mapaOrdenes = {};

    if (tablaOrdenes) {
      const resOrd = await db.query(`SELECT * FROM ${tablaOrdenes}`);
      resOrd.rows.forEach(o => {
        const claveNum = String(o.numero_orden || o.nro_orden || o.orden_id || o.id);
        mapaOrdenes[claveNum] = o;
        if (o.id) mapaOrdenes[String(o.id)] = o;
      });
    }

    // 3. Unimos cada evento de scrap con los datos completos de la orden (Cliente, Producto, Maquinista, Operador)
    const resultadoEnriquecido = filasScrap.map(rs => {
      const ord = mapaOrdenes[String(rs.orden_id)] || {};
      return {
        ...rs,
        cliente: ord.cliente || ord.nombre_cliente || rs.cliente || 'Stock / General',
        producto_descripcion: ord.producto || ord.producto_descripcion || ord.descripcion || rs.producto_descripcion || '-',
        maquina_orden: ord.maquina_destino || ord.codigo_maquina || ord.maquina || rs.codigo_maquina || '-',
        maquinista: rs.maquinista || ord.maquinista || ord.nombre_maquinista || ord.operador || ord.nombre_operador || ord.operario || ord.usuario || ord.oficial || '',
        operador: rs.ayudante || ord.ayudante || ord.nombre_ayudante || ord.auxiliar || ''
      };
    });

    res.json(resultadoEnriquecido);
  } catch (error) {
    console.error('❌ Error en /api/scrap/detallado:', error.message);
    res.status(500).json({ error: 'Error al obtener el detalle de scrap' });
  }
});

// NUEVO ENDPOINT: Devuelve las órdenes directamente desde /api/scrap/ordenes-lista (Elimina el 404 de /api/ordenes)
router.get('/ordenes-lista', async (req, res) => {
  try {
    const tablaOrdenes = await obtenerTablaOrdenes();
    if (!tablaOrdenes) {
      return res.json([]);
    }
    const result = await db.query(`SELECT * FROM ${tablaOrdenes} ORDER BY id DESC`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error al listar órdenes para scrap:', error.message);
    res.json([]);
  }
});

// =========================================================================
// GESTIÓN COMPLETA DE PERSONAL (MAQUINISTAS Y SUPERVISORES)
// =========================================================================

// A. Obtener todos los operadores (con su columna 'rol' incluida)
router.get('/operadores-lista', async (req, res) => {
  try {
    await db.query(`ALTER TABLE operadores ADD COLUMN IF NOT EXISTS rol VARCHAR(30) DEFAULT 'Maquinista'`);
    const result = await db.query(`SELECT * FROM operadores ORDER BY id ASC`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error al listar operadores:', error.message);
    res.status(500).json({ error: 'Error al listar operadores' });
  }
});

// B. Crear nuevo operador guardando directamente su rol (Maquinista o Supervisor)
router.post('/operadores', async (req, res) => {
  const { nombre, rol } = req.body;
  try {
    await db.query(`ALTER TABLE operadores ADD COLUMN IF NOT EXISTS rol VARCHAR(30) DEFAULT 'Maquinista'`);
    const rolFinal = rol || 'Maquinista';
    const result = await db.query(
      `INSERT INTO operadores (nombre, rol, estado) VALUES ($1, $2, 'Activo') RETURNING *`,
      [nombre, rolFinal]
    );
    console.log(`👤 [PERSONAL CREADO] ${nombre} | Rol: ${rolFinal}`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error al crear operador:', error.message);
    res.status(500).json({ error: 'Error al crear el operador' });
  }
});

// C. Actualizar el rol de un operador existente (Maquinista <-> Supervisor)
router.put('/operadores/:id/rol', async (req, res) => {
  const { id } = req.params;
  const { rol } = req.body;
  try {
    await db.query(`ALTER TABLE operadores ADD COLUMN IF NOT EXISTS rol VARCHAR(30) DEFAULT 'Maquinista'`);
    const result = await db.query(
      `UPDATE operadores SET rol = $1 WHERE id = $2 RETURNING *`,
      [rol, id]
    );
    console.log(`👔 [ROL ACTUALIZADO] ID: ${id} -> Nuevo Rol: ${rol}`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error al actualizar rol de operador:', error.message);
    res.status(500).json({ error: 'Error al actualizar el rol' });
  }
});

// D. Eliminar definitivamente un operador de prueba
router.delete('/operadores/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`DELETE FROM operadores WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error al eliminar operador:', error.message);
    res.status(500).json({ error: 'Error al eliminar el registro' });
  }
});

// 3. GET: Rutas DINÁMICAS siempre al final del archivo
router.get('/:ordenId', async (req, res) => {
  const { ordenId } = req.params;
  try {
    const result = await db.query('SELECT * FROM registro_scrap WHERE orden_id = $1 ORDER BY id DESC', [ordenId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener registros de scrap' });
  }
});

module.exports = router;
