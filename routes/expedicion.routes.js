const express = require('express');
const router = express.Router();
const db = require('../db');

// AUTO-INICIALIZACIÓN: Crea las tablas en la BD exacta a la que apunta Node.js
const inicializarTablasExpedicion = async () => {
  try {
    const infoDB = await db.query('SELECT current_database(), inet_server_addr(), current_schema()');
    console.log('📌 Backend conectado a BD:', infoDB.rows[0]);

    await db.query(`
      CREATE TABLE IF NOT EXISTS public.pallets_produccion (
          id SERIAL PRIMARY KEY,
          numero_orden INT NOT NULL,
          maquina VARCHAR(50) NOT NULL,
          operador VARCHAR(100),
          cliente VARCHAR(150),
          codigo_producto VARCHAR(100),
          producto_descripcion TEXT,
          es_generico BOOLEAN DEFAULT FALSE,
          unidades_iniciales NUMERIC NOT NULL,
          cantidad_unidades NUMERIC NOT NULL,
          m2_unitario NUMERIC(10, 4) DEFAULT 0,
          es_parcial BOOLEAN DEFAULT FALSE,
          estado VARCHAR(30) DEFAULT 'En Galpón',
          orden_origen INT,
          observaciones TEXT,
          fecha_registro TIMESTAMP DEFAULT NOW(),
          fecha_actualizacion TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS operador VARCHAR(100);
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS cliente VARCHAR(150);
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS codigo_producto VARCHAR(100);
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS producto_descripcion TEXT;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS es_generico BOOLEAN DEFAULT FALSE;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS unidades_iniciales NUMERIC DEFAULT 0;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS cantidad_unidades NUMERIC DEFAULT 0;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS m2_unitario NUMERIC(10, 4) DEFAULT 0;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS es_parcial BOOLEAN DEFAULT FALSE;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS estado VARCHAR(30) DEFAULT 'En Galpón';
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS orden_origen INT;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS observaciones TEXT;
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS fecha_registro TIMESTAMP DEFAULT NOW();
      ALTER TABLE public.pallets_produccion ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP DEFAULT NOW();
    `);
    console.log('✅ Tablas pallets_produccion y movimientos_expedicion listas y migradas en la BD activa.');
  } catch (err) {
    console.error('❌ Error al verificar/crear tablas de expedición:', err.message);
  }
};

inicializarTablasExpedicion();

// 1. OBTENER STOCK RESUMIDO BASADO EN LAS UNIDADES INICIALES REALES DEL PALLET
router.get('/stock', async (req, res) => {
  try {
    const query = `
      SELECT 
        MIN(id) as id,
        numero_orden,
        MAX(cliente) as cliente,
        MAX(producto_descripcion) as producto_descripcion,
        SUM(cantidad_unidades) as stock_total_cajas,
        SUM(CASE WHEN m2_unitario > 0 THEN cantidad_unidades * m2_unitario ELSE 0 END) as m2_stock_total,
        COUNT(*) as total_pallets_fisicos,
        SUM(CASE WHEN es_parcial = FALSE THEN 1 ELSE 0 END) as pallets_completos,
        SUM(CASE WHEN es_parcial = TRUE THEN 1 ELSE 0 END) as pallets_parciales,
        STRING_AGG(CONCAT('P#', id, ' (', cantidad_unidades, 'u.)'), ' | ') as detalle_pallets
      FROM public.pallets_produccion
      WHERE estado != 'Despachado' AND cantidad_unidades > 0
      GROUP BY numero_orden
      ORDER BY numero_orden DESC
    `;
    const resultado = await db.query(query);
    res.json(resultado.rows);
  } catch (error) {
    console.error('Error al obtener stock resumido:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 1.2. OBTENER PALLETS FÍSICOS INDIVIDUALES (Para el selector de despachos y traspasos)
router.get('/stock-fisico', async (req, res) => {
  try {
    const query = `SELECT * FROM public.pallets_produccion WHERE estado != 'Despachado' AND cantidad_unidades > 0 ORDER BY id DESC`;
    const resultado = await db.query(query);
    res.json(resultado.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1.3. OBTENER ÓRDENES PRODUCIDAS (Incluye parciales, en curso o con unidades fabricadas)
router.get('/ordenes-producidas', async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM public.ordenes_produccion o
      WHERE (
        COALESCE(NULLIF(REGEXP_REPLACE(o.cantidad_fabricada::text, '[^0-9.]', '', 'g'), ''), '0')::numeric > 0
        OR LOWER(TRIM(o.estado)) LIKE '%finalizada%'
        OR LOWER(TRIM(o.estado)) LIKE '%parcial%'
        OR LOWER(TRIM(o.estado)) LIKE '%producci%'
        OR LOWER(TRIM(o.estado)) LIKE '%pausa%'
        OR LOWER(TRIM(o.estado)) LIKE '%proceso%'
      )
      AND NOT EXISTS (
        SELECT 1 
        FROM public.pallets_produccion p
        WHERE p.numero_orden = o.numero_orden 
          AND p.estado != 'Despachado'
          AND p.cantidad_unidades > 0
      )
      ORDER BY o.numero_orden DESC
      LIMIT 150
    `;
    const resultado = await db.query(query);
    res.json(resultado.rows);
  } catch (error) {
    console.error('Error al obtener órdenes producidas:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 1.3.1. BUSCAR DATOS DE ORDEN PARA AUTOCOMPLETAR EN EXPEDICIÓN (Ubicada de forma óptima)
// BUSCAR DATOS DE ORDEN PARA AUTOCOMPLETAR (Con la columna real detectada)
router.get('/ordenes/buscar/:numero_orden', async (req, res) => {
  try {
    const { numero_orden } = req.params;
    const query = `SELECT * FROM public.ordenes_produccion WHERE numero_orden = $1`;
    const resultado = await db.query(query, [numero_orden]);
    
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada en producción' });
    }
    
    const o = resultado.rows[0];

    // 🎯 Columna real obtenida de la base de datos: descripcion_producto
    const productoDesc = o.descripcion_producto || o.producto_descripcion || o.descripcion || o.producto || 'Producto sin descripción';
    const cliente = o.cliente || 'Sin Cliente';
    const codigoProd = o.codigo_producto || o.codigo || '';
    const m2Totales = Number(o.m2_tot || o.m2_totales || 0);
    const cantProg = Number(o.cantidad_programada || o.cantidad || 1);
    const m2Unitario = m2Totales > 0 && cantProg > 0 ? m2Totales / cantProg : 0;

    res.json({
      numero_orden: o.numero_orden,
      cliente: cliente,
      producto_descripcion: productoDesc,
      codigo_producto: codigoProd,
      m2_unitario: m2Unitario
    });
  } catch (error) {
    console.error('Error al buscar orden para autocompletar:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 1.4. REGISTRO AUTOMÁTICO DE PALLETS DESDE PLANTA (Con limpieza anti-duplicados)
router.post('/pallets', async (req, res) => {
  const { numero_orden, maquina, operador, cliente, producto_descripcion, cantidad_unidades, capacidad_standard } = req.body;
  try {
    await db.query(
      "DELETE FROM public.pallets_produccion WHERE numero_orden = $1 AND estado = 'En Galpón'",
      [numero_orden]
    );

    const ordRes = await db.query('SELECT * FROM public.ordenes_produccion WHERE numero_orden = $1', [numero_orden]);
    const orden = ordRes.rows[0] || {};
    
    const m2Tot = Number(orden.m2_tot || orden.m2_totales || 0);
    const cantProg = Number(orden.cantidad_programada || orden.cantidad || 1);
    const m2Unitario = m2Tot > 0 ? m2Tot / cantProg : 0;

    const totalUnidades = Number(cantidad_unidades) || 0;
    const capStd = Number(capacidad_standard) || 1000;

    let unidadesRestantes = totalUnidades;
    let palletsCreados = [];

    while (unidadesRestantes > 0) {
      const cantPallet = unidadesRestantes >= capStd ? capStd : unidadesRestantes;
      const esParcial = cantPallet < capStd;

      const query = `
        INSERT INTO public.pallets_produccion 
        (numero_orden, maquina, operador, cliente, producto_descripcion, es_generico, unidades_iniciales, cantidad_unidades, m2_unitario, es_parcial, estado)
        VALUES ($1, $2, $3, $4, $5, FALSE, $6, $6, $7, $8, 'En Galpón')
        RETURNING *
      `;
      const values = [
        numero_orden, 
        maquina || 'PLANTA', 
        operador || 'Operador', 
        cliente || orden.cliente || 'Cliente', 
        producto_descripcion || orden.producto_descripcion || 'Producto', 
        cantPallet, 
        m2Unitario,
        esParcial
      ];

      const resultado = await db.query(query, values);
      palletsCreados.push(resultado.rows[0]);

      unidadesRestantes -= cantPallet;
    }

    res.json({ status: 'ok', pallets: palletsCreados });
  } catch (error) {
    console.error('Error al registrar pallets:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. CREAR O EDITAR PALLET (CRUD Manual)
router.post('/pallets/crud', async (req, res) => {
  const { id, numero_orden, maquina, operador, cliente, codigo_producto, producto_descripcion, es_generico, unidades, m2_unitario, estado, es_parcial } = req.body;
  try {
    if (id) {
      const query = `
        UPDATE public.pallets_produccion 
        SET numero_orden = $1, maquina = $2, operador = $3, cliente = $4, codigo_producto = $5, 
            producto_descripcion = $6, es_generico = $7, cantidad_unidades = $8, m2_unitario = $9, estado = $10, fecha_actualizacion = NOW()
        WHERE id = $11 RETURNING *
      `;
      const values = [numero_orden, maquina, operador, cliente, codigo_producto, producto_descripcion, es_generico, unidades, m2_unitario, estado, id];
      const resultado = await db.query(query, values);
      res.json({ status: 'ok', pallet: resultado.rows[0] });
    } else {
      const query = `
        INSERT INTO public.pallets_produccion (numero_orden, maquina, operador, cliente, codigo_producto, producto_descripcion, es_generico, unidades_iniciales, cantidad_unidades, m2_unitario, estado, es_parcial)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11) RETURNING *
      `;
      const values = [
        numero_orden, 
        maquina || 'MANUAL', 
        operador || 'Expedición', 
        cliente, 
        codigo_producto, 
        producto_descripcion, 
        es_generico || false, 
        unidades, 
        m2_unitario || 0, 
        estado || 'En Galpón',
        es_parcial || false
      ];
      const resultado = await db.query(query, values);
      res.json({ status: 'ok', pallet: resultado.rows[0] });
    }
  } catch (error) {
    console.error('Error en CRUD de pallets:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. ELIMINAR PALLET INDIVIDUAL
router.delete('/pallets/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM public.pallets_produccion WHERE id = $1', [req.params.id]);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error al eliminar pallet:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3.1. ELIMINAR TODOS LOS PALLETS ACTIVOS DE UNA ORDEN
router.delete('/orden/:numero_orden', async (req, res) => {
  try {
    await db.query("DELETE FROM public.pallets_produccion WHERE numero_orden = $1 AND estado != 'Despachado'", [req.params.numero_orden]);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. TRASPASO
router.post('/traspaso', async (req, res) => {
  const { pallet_origen_id, orden_destino, unidades_a_traspasar, usuario } = req.body;
  try {
    const origenRes = await db.query('SELECT * FROM public.pallets_produccion WHERE id = $1', [pallet_origen_id]);
    if (origenRes.rows.length === 0) return res.status(404).json({ error: 'Pallet origen no encontrado' });
    const origen = origenRes.rows[0];

    if (Number(unidades_a_traspasar) > Number(origen.cantidad_unidades)) {
      return res.status(400).json({ error: 'No hay suficientes unidades en este pallet' });
    }

    const nuevoStockOrigen = Number(origen.cantidad_unidades) - Number(unidades_a_traspasar);
    await db.query('UPDATE public.pallets_produccion SET cantidad_unidades = $1, fecha_actualizacion = NOW() WHERE id = $2', [nuevoStockOrigen, pallet_origen_id]);

    const destOrdenRes = await db.query('SELECT * FROM public.ordenes_produccion WHERE numero_orden = $1', [orden_destino]);
    const destRow = destOrdenRes.rows[0] || {};
    const clienteDestino = destRow.cliente || 'Cliente Destino';
    const descDestino = destRow.producto_descripcion || destRow.descripcion || destRow.producto || origen.producto_descripcion;
    const codDestino = destRow.codigo_producto || origen.codigo_producto;

    const nuevoPalletRes = await db.query(`
      INSERT INTO public.pallets_produccion (numero_orden, maquina, operador, cliente, codigo_producto, producto_descripcion, es_generico, unidades_iniciales, cantidad_unidades, m2_unitario, estado, orden_origen, observaciones, es_parcial)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $7, $8, 'En Galpón', $9, $10, TRUE) RETURNING *
    `, [
      orden_destino, origen.maquina, origen.operador, clienteDestino, codDestino, descDestino, 
      unidades_a_traspasar, origen.m2_unitario, origen.numero_orden, `Traspasado desde Orden #${origen.numero_orden}`
    ]);

    const m2Totales = Number(unidades_a_traspasar) * Number(origen.m2_unitario);
    await db.query(`
      INSERT INTO public.movimientos_expedicion (pallet_id, tipo_movimiento, numero_orden, orden_destino, cliente, producto_descripcion, unidades_afectadas, m2_totales, usuario, detalle)
      VALUES ($1, 'TRASPASO', $2, $3, $4, $5, $6, $7, $8, $9)
    `, [pallet_origen_id, origen.numero_orden, orden_destino, clienteDestino, descDestino, unidades_a_traspasar, m2Totales, usuario || 'Expedición', `Traspaso de genérico de Orden #${origen.numero_orden} a #${orden_destino}`]);

    res.json({ status: 'ok', mensaje: 'Traspaso realizado con éxito', nuevoPallet: nuevoPalletRes.rows[0] });
  } catch (error) {
    console.error('Error en traspaso:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 5. DESPACHO
router.post('/despachar', async (req, res) => {
  const { pallet_id, unidades_despachadas, remito, usuario } = req.body;
  try {
    const palletRes = await db.query('SELECT * FROM public.pallets_produccion WHERE id = $1', [pallet_id]);
    if (palletRes.rows.length === 0) return res.status(404).json({ error: 'Pallet no encontrado' });
    const pallet = palletRes.rows[0];

    const cantDespachar = Number(unidades_despachadas);
    const stockActual = Number(pallet.cantidad_unidades);

    if (cantDespachar > stockActual) {
      return res.status(400).json({ error: 'La cantidad a despachar supera el stock del pallet' });
    }

    const nuevoStock = stockActual - cantDespachar;
    const nuevoEstado = nuevoStock === 0 ? 'Despachado' : 'En Galpón';
    const tipoMov = nuevoStock === 0 ? 'DESPACHO_TOTAL' : 'DESPACHO_PARCIAL';

    await db.query('UPDATE public.pallets_produccion SET cantidad_unidades = $1, estado = $2, fecha_actualizacion = NOW() WHERE id = $3', [nuevoStock, nuevoEstado, pallet_id]);

    const m2Totales = cantDespachar * Number(pallet.m2_unitario);

    await db.query(`
      INSERT INTO public.movimientos_expedicion (pallet_id, tipo_movimiento, numero_orden, cliente, producto_descripcion, unidades_afectadas, m2_totales, remito_transporte, usuario, detalle)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [pallet_id, tipoMov, pallet.numero_orden, pallet.cliente, pallet.producto_descripcion, cantDespachar, m2Totales, remito || 'S/N', usuario || 'Expedición', `Despacho de ${cantDespachar} unidades (Remito: ${remito || 'S/N'})`]);

    res.json({ status: 'ok', mensaje: 'Despacho registrado con éxito', m2_despachados: m2Totales });
  } catch (error) {
    console.error('Error al despachar:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 6. INFORMES
router.get('/informes', async (req, res) => {
  const { periodo, fecha, mes, anio } = req.query;
  try {
    let query = '';
    let values = [];

    if (periodo === 'dia') {
      query = `
        SELECT DATE(fecha_movimiento) as fecha, numero_orden, cliente, producto_descripcion, 
               SUM(unidades_afectadas) as total_unidades, SUM(m2_totales) as total_m2
        FROM public.movimientos_expedicion
        WHERE tipo_movimiento LIKE 'DESPACHO%' AND DATE(fecha_movimiento) = $1
        GROUP BY DATE(fecha_movimiento), numero_orden, cliente, producto_descripcion
        ORDER BY fecha DESC
      `;
      values = [fecha || new Date().toISOString().split('T')[0]];
    } else {
      query = `
        SELECT TO_CHAR(fecha_movimiento, 'YYYY-MM') as periodo, numero_orden, cliente, 
               SUM(unidades_afectadas) as total_unidades, SUM(m2_totales) as total_m2
        FROM public.movimientos_expedicion
        WHERE tipo_movimiento LIKE 'DESPACHO%' AND EXTRACT(MONTH FROM fecha_movimiento) = $1 AND EXTRACT(YEAR FROM fecha_movimiento) = $2
        GROUP BY periodo, numero_orden, cliente
        ORDER BY periodo DESC
      `;
      values = [mes || new Date().getMonth() + 1, anio || new Date().getFullYear()];
    }

    const resultado = await db.query(query, values);
    res.json(resultado.rows);
  } catch (error) {
    console.error('Error al generar informe:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;