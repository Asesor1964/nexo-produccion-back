const express = require('express');
const router = express.Router();
const db = require('../db');

// Variable global asegurada para todo el backend
if (!global.estadoVivoMaquinas) {
  global.estadoVivoMaquinas = {};
}

// Función auxiliar blindada según las rutas reales de Maestro_Productos.csv
const extraerNucleoMaquina = (cod) => {
  if (!cod) return '';
  const texto = cod.toUpperCase().trim();

  // 1. Mapeo directo de alias críticos de planta -> código real en CSV
  if (texto.includes('WAR')) return 'WAR'; // Convierte "WARD", "WARD-TROQ", "COR-WARx2" -> "WAR"
  if (texto.includes('JS'))  return 'JS';  // Convierte "COR-JS", "IMP-JS", "COR-JSx2" -> "JS"
  if (texto.includes('SS'))  return 'SS';  // Convierte "COR-SS", "IMP-SS", "COR-SSx2" -> "SS"
  if (texto.includes('PBO')) return 'PBO'; // Bobst / Pegadora PBO
  if (texto.includes('PLM')) return 'PLM'; // Pegadora PLM
  if (texto.includes('PEG')) return 'PEG'; // Pegado general
  if (texto.includes('DIV')) return 'DIV'; // Divisora (DIV, COR-DIVx2)
  if (texto.includes('TPL')) return 'TPL'; // Troqueladora Plana (TPLx2, TPLx4)
  if (texto.includes('TER')) return 'TER'; // Termo / COR-TER
  if (texto.includes('PLO')) return 'PLO'; // Plotter (COR-PLO)
  if (texto.includes('TRA')) return 'TRA'; // Guillotina / Tramo (TRA)
  if (texto.includes('DYF')) return 'DYF'; // DYF
  if (texto.includes('CHI')) return 'CHI'; // CHI

  // 2. Limpieza general para futuras máquinas
  return texto
    .replace(/^(IMP-|COR-|TROQ-|TRO-|PEG-)/, '')
    .replace(/(-TROQ|-IMP|-COR|-PEG)$/, '')
    .replace(/X[0-9]+$/i, '')
    .trim();
};

// =========================================================================
// 🚨 PRIORIDAD MÁXIMA: ESTADO EN VIVO Y CONFIGURACIÓN DE MÁQUINAS (DESARROLLADOR)
// =========================================================================

// 1. PUT: Guardar configuración desde PantallaDesarrollador (Rutas explícitas sin asteriscos)
router.put([
  '/maquinas/:maquina',
  '/maquinas/:maquina/config',
  '/maquinas/:maquina/configuracion',
  '/recursos/maquinas/:maquina',
  '/recursos/maquinas/:maquina/config',
  '/recursos/maquinas/:maquina/configuracion'
], async (req, res, next) => {
  if (req.path.includes('estado-vivo')) {
    return next();
  }

  const { maquina } = req.params;
  const { 
    modo_captura, 
    modo, 
    modoAdquisicion,
    velocidad_estandar, 
    velocidad, 
    velocidadEstandar,
    tiempo_setup_min, 
    tiempo_limite_setup, 
    tiempoSetup 
  } = req.body;

  const codMaq = String(maquina || '').trim().toUpperCase();
  const modoFinal = modo_captura || modo || modoAdquisicion || 'MANUAL';
  const velFinal = Number(velocidad_estandar ?? velocidad ?? velocidadEstandar) || 120;
  const setupFinal = Number(tiempo_setup_min ?? tiempo_limite_setup ?? tiempoSetup) || 25;

  try {
    const updateRes = await db.query(
      `UPDATE maquinas 
       SET modo_captura = $1, 
           velocidad_estandar = $2, 
           tiempo_setup_min = $3
       WHERE TRIM(UPPER(codigo_maquina)) = $4
       RETURNING *`,
      [modoFinal, velFinal, setupFinal, codMaq]
    );

    if (updateRes.rows.length > 0) {
      console.log(`⚙️ [DESARROLLADOR] Actualizado: ${codMaq} | Vel: ${velFinal} | SetUp: ${setupFinal}m | Modo: ${modoFinal}`);
      return res.json({ status: 'ok', maquina: updateRes.rows[0] });
    }

    const insertRes = await db.query(
      `INSERT INTO maquinas (codigo_maquina, nombre, descripcion, tipo, estado, modo_captura, velocidad_estandar, tiempo_setup_min)
       VALUES ($1, $2, $2, 'Principal', 'Activa', $3, $4, $5)
       RETURNING *`,
      [codMaq, `Línea ${codMaq}`, modoFinal, velFinal, setupFinal]
    );

    console.log(`⚙️ [DESARROLLADOR] Creado: ${codMaq} | Vel: ${velFinal} | SetUp: ${setupFinal}m`);
    res.json({ status: 'ok', maquina: insertRes.rows[0] });
  } catch (error) {
    console.error('❌ Error en config de máquina:', error.message);
    res.status(500).json({ error: 'Error al guardar configuración en BD: ' + error.message });
  }
});

// PUT: Guardar configuración de ingeniería y modo desde PantallaDesarrollador (/config-modo)
router.put('/maquinas/:maquina/config-modo', async (req, res) => {
  const { maquina } = req.params;
  const { 
    modo_captura, 
    velocidad_estandar, 
    tiempo_setup_estandar,
    tiempo_setup_min,
    tiempo_limite_setup 
  } = req.body;

  const codMaq = String(maquina || '').trim().toUpperCase();
  const modoFinal = modo_captura || 'MANUAL';
  const velFinal = Number(velocidad_estandar) || 120;
  const setupFinal = Number(tiempo_setup_estandar ?? tiempo_setup_min ?? tiempo_limite_setup) || 15;

  try {
    const updateRes = await db.query(
      `UPDATE maquinas 
       SET modo_captura = $1, 
           velocidad_estandar = $2, 
           tiempo_setup_min = $3
       WHERE TRIM(UPPER(codigo_maquina)) = $4
       RETURNING *`,
      [modoFinal, velFinal, setupFinal, codMaq]
    );

    if (updateRes.rows.length > 0) {
      console.log(`⚙️ [CONFIG GUARDADA] Máquina: ${codMaq} | Vel: ${velFinal} | SetUp: ${setupFinal}m | Modo: ${modoFinal}`);
      return res.json({ status: 'ok', mensaje: 'Actualizado con éxito', maquina: updateRes.rows[0] });
    }

    const insertRes = await db.query(
      `INSERT INTO maquinas (codigo_maquina, nombre, descripcion, tipo, estado, modo_captura, velocidad_estandar, tiempo_setup_min)
       VALUES ($1, $2, $2, 'Principal', 'Activa', $3, $4, $5)
       RETURNING *`,
      [codMaq, `Línea ${codMaq}`, modoFinal, velFinal, setupFinal]
    );

    res.json({ status: 'ok', mensaje: 'Creado con éxito', maquina: insertRes.rows[0] });
  } catch (error) {
    console.error('❌ Error en config-modo:', error.message);
    res.status(500).json({ error: 'Error al guardar configuración en BD' });
  }
});

// 2. PUT: Estado en vivo desde PantallaMaquinista hacia PantallaMonitorTV
router.put('/maquinas/:maquina/estado-vivo', async (req, res) => {
  const { maquina } = req.params;
  const { estado, orden, operador, cajas, velocidad } = req.body;
  
  if (!global.estadoVivoMaquinas) global.estadoVivoMaquinas = {};
  const claveMaq = String(maquina || '').trim().toUpperCase();

  global.estadoVivoMaquinas[claveMaq] = {
    estado: estado || 'ESPERA',
    orden: orden || '',
    operador: operador || '',
    cajas: Number(cajas) || 0,
    velocidad: Number(velocidad) || 0,
    actualizado: new Date()
  };

  console.log(`📡 [ESTADO VIVO] Máquina: ${claveMaq} -> Estado: ${estado} | Operador: ${operador || 'N/D'}`);
  res.json({ status: 'ok', estadoVivo: global.estadoVivoMaquinas[claveMaq] });
});

// 3. GET: Consultar estado en vivo (PantallaMonitorTV)
router.get('/maquinas/:maquina/estado-vivo', async (req, res) => {
  const { maquina } = req.params;
  if (!global.estadoVivoMaquinas) global.estadoVivoMaquinas = {};
  const claveMaq = String(maquina || '').trim().toUpperCase();
  
  const vivo = global.estadoVivoMaquinas[claveMaq] || {
    estado: 'ESPERA',
    orden: '',
    operador: '',
    cajas: 0,
    velocidad: 0
  };
  res.json(vivo);
});

// =========================================================================
// 1. GESTIÓN DE OPERADORES
// =========================================================================

router.get(['/recursos/operadores/todos', '/recursos/operadores', '/operadores'], async (req, res) => {
  try {
    const esTodos = req.path.includes('/todos');
    const query = esTodos
      ? `SELECT id, nombre, legajo, turno, COALESCE(estado, 'Activo') AS estado, COALESCE(activo, TRUE) AS activo FROM operadores ORDER BY id DESC`
      : `SELECT id, nombre, legajo, turno, COALESCE(estado, 'Activo') AS estado, COALESCE(activo, TRUE) AS activo FROM operadores WHERE COALESCE(activo, TRUE) = TRUE AND COALESCE(estado, 'Activo') = 'Activo' ORDER BY id DESC`;

    const result = await db.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error GET operadores:', error.message);
    res.json([]);
  }
});

router.post('/recursos/operadores', async (req, res) => {
  const { nombre, rol } = req.body;
  try {
    const rolFinal = rol || 'Maquinista';
    await db.query(`ALTER TABLE operadores ADD COLUMN IF NOT EXISTS rol VARCHAR(30) DEFAULT 'Maquinista'`);
    
    const result = await db.query(
      `INSERT INTO operadores (nombre, rol, estado) VALUES ($1, $2, 'Activo') RETURNING *`,
      [nombre, rolFinal]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error al agregar operador:', error.message);
    res.status(500).json({ error: 'Error al agregar el operador' });
  }
});

router.put('/recursos/operadores/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  try {
    const activo = estado === 'Activo';
    const result = await db.query(
      'UPDATE operadores SET estado = $1, activo = $2 WHERE id = $3 RETURNING *',
      [estado, activo, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error PUT estado operador:', error.message);
    res.status(500).json({ error: 'Error al actualizar estado del operador' });
  }
});

// =========================================================================
// 2. GESTIÓN DE MÁQUINAS
// =========================================================================

router.get(['/recursos/maquinas/todas', '/recursos/maquinas', '/maquinas'], async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, codigo_maquina, 
             COALESCE(descripcion, nombre, codigo_maquina) AS descripcion,
             COALESCE(nombre, descripcion, codigo_maquina) AS nombre,
             COALESCE(tipo, 'Principal') AS tipo,
             COALESCE(estado, 'Activa') AS estado,
             COALESCE(velocidad_estandar, 120) AS velocidad_estandar,
             COALESCE(modo_captura, 'MANUAL') AS modo_captura,
             COALESCE(tiempo_setup_min, 15) AS tiempo_setup_min,
             COALESCE(tiempo_setup_min, 15) AS tiempo_limite_setup,
             COALESCE(tiempo_setup_min, 15) AS tiempo_setup_estandar
      FROM maquinas 
      ORDER BY id ASC
    `);
    if (result.rows.length > 0) return res.json(result.rows);
    
    const fallback = await db.query(`
      SELECT DISTINCT TRIM(UPPER(maquina_asignada)) AS codigo_maquina 
      FROM ordenes_produccion 
      WHERE maquina_asignada IS NOT NULL AND maquina_asignada <> ''
      ORDER BY codigo_maquina ASC
    `);
    const maquinasRespaldo = fallback.rows
      .filter(r => isNaN(r.codigo_maquina) && !r.codigo_maquina.includes(','))
      .map((r, idx) => ({
        id: idx + 1,
        codigo_maquina: r.codigo_maquina,
        nombre: `Línea ${r.codigo_maquina}`,
        descripcion: `Línea ${r.codigo_maquina}`,
        tipo: 'Principal',
        estado: 'Activa',
        velocidad_estandar: 120,
        modo_captura: 'MANUAL',
        tiempo_setup_min: 25
      }));
    res.json(maquinasRespaldo);
  } catch (error) {
    console.error('Error GET maquinas:', error.message);
    res.json([]);
  }
});

router.post(['/recursos/maquinas', '/maquinas'], async (req, res) => {
  const { codigo_maquina, descripcion, nombre, tipo, velocidad_estandar } = req.body;
  if (!codigo_maquina || !codigo_maquina.trim()) {
    return res.status(400).json({ error: 'El código de máquina es obligatorio' });
  }
  const descFinal = descripcion || nombre || codigo_maquina.trim().toUpperCase();
  try {
    const result = await db.query(
      `INSERT INTO maquinas (codigo_maquina, nombre, descripcion, tipo, estado, velocidad_estandar)
       VALUES ($1, $2, $2, $3, 'Activa', $4)
       ON CONFLICT (codigo_maquina) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         descripcion = EXCLUDED.descripcion,
         tipo = EXCLUDED.tipo,
         velocidad_estandar = EXCLUDED.velocidad_estandar
       RETURNING *`,
      [codigo_maquina.trim().toUpperCase(), descFinal, tipo || 'Principal', Number(velocidad_estandar) || 120]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error POST maquinas:', error.message);
    res.status(500).json({ error: 'Error al guardar máquina' });
  }
});

router.put('/recursos/maquinas/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  try {
    const result = await db.query('UPDATE maquinas SET estado = $1 WHERE id = $2 RETURNING *', [estado, id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error PUT estado maquina:', error.message);
    res.status(500).json({ error: 'Error al actualizar estado de máquina' });
  }
});

// =========================================================================
// 3. RUTAS Y CÓDIGOS DE PARADA
// =========================================================================

router.get(['/recursos/rutas/todas', '/recursos/rutas'], async (req, res) => {
  try {
    const soloActivas = !req.path.endsWith('/todas');
    const query = soloActivas
      ? 'SELECT * FROM rutas_produccion WHERE COALESCE(activo, TRUE) = TRUE ORDER BY id ASC'
      : 'SELECT * FROM rutas_produccion ORDER BY id ASC';
    const result = await db.query(query);
    if (result.rows.length > 0) return res.json(result.rows);
  } catch (error) {}
  res.json([
    { id: 1, codigo_ruta: 'COR-JS', descripcion: 'Corrugadora JS', activo: true },
    { id: 2, codigo_ruta: 'IMP-JS', descripcion: 'Impresora JS', activo: true }
  ]);
});

router.get('/recursos/paradas', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM codigos_parada ORDER BY id ASC');
    if (result.rows.length > 0) return res.json(result.rows);
  } catch (error) {}
  res.json([
    { id: 1, codigo: 'SET-UP', descripcion: 'Set-Up / Cambio de Orden y Clisé' },
    { id: 2, codigo: 'MEC', descripcion: 'Falla Mecánica' }
  ]);
});

// =========================================================================
// 4. TIEMPOS MUERTOS E HISTORIAL
// =========================================================================

router.get(['/tiempos-muertos/todos', '/tiempos-muertos'], async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tiempos_muertos ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) { res.json([]); }
});

router.post('/tiempos-muertos', async (req, res) => {
  const { maquina, codigo_parada, motivo, minutos_duracion, numero_orden } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO tiempos_muertos (maquina, codigo_parada, motivo, minutos_duracion, numero_orden, fecha_registro)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [maquina, codigo_parada || motivo || 'PARADA', motivo || codigo_parada || 'Sin detalle', Number(minutos_duracion) || 0, numero_orden || null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar tiempo muerto' });
  }
});

router.get('/historial', async (req, res) => {
  try {
    const query = `
      SELECT o.numero_orden AS id, o.*,
        COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
        COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS producto_descripcion
      FROM ordenes_produccion o
      LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
      WHERE TRIM(LOWER(o.estado)) IN ('finalizada', 'completada', 'terminada', 'cerrada')
      ORDER BY o.numero_orden DESC;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) { res.json([]); }
});

// =========================================================================
// 5. COLA Y MONITOREO (Solo órdenes Habilitadas o En Producción)
// =========================================================================

router.get('/cola/:maquina', async (req, res) => {
  const { maquina } = req.params;
  const nucleo = extraerNucleoMaquina(maquina);
  try {
    const query = `
      SELECT 
        o.numero_orden AS id, 
        o.*, 
        COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
        COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS producto_descripcion,
        COALESCE(o.largo, p.largo_mm, 800) AS largo_lamina_mm,
        COALESCE(o.ancho, p.ancho_mm, 600) AS ancho_lamina_mm,
        COALESCE(o.m2_tot, 0) AS m2_totales_orden
      FROM ordenes_produccion o
      LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
      WHERE 
        (
          TRIM(UPPER(o.maquina_asignada)) LIKE '%' || TRIM(UPPER($1)) || '%' 
          OR TRIM(UPPER($1)) LIKE '%' || TRIM(UPPER(NULLIF(o.maquina_asignada, ''))) || '%'
          OR ($2 <> '' AND TRIM(UPPER(o.maquina_asignada)) LIKE '%' || $2 || '%')
        )
        AND TRIM(LOWER(COALESCE(o.estado, ''))) IN ('habilitada', 'en produccion', 'en producción')
      ORDER BY 
        CASE 
          WHEN TRIM(LOWER(o.estado)) IN ('en produccion', 'en producción') THEN 0 
          WHEN TRIM(LOWER(o.estado)) = 'habilitada' THEN 1 
          ELSE 2 
        END,
        COALESCE(o.prioridad_secuencia, 9999) ASC, 
        o.numero_orden ASC;
    `;
    const { rows } = await db.query(query, [maquina, nucleo]);
    res.json(rows);
  } catch (error) {
    console.error('Error en /cola/:maquina:', error.message);
    res.status(500).json({ error: 'Error al obtener la cola de producción' });
  }
});

// =========================================================================
// 6. LISTADO GENERAL Y SINCRONIZACIÓN
// =========================================================================

router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT o.numero_orden AS id, o.numero_orden, o.codigo_producto, o.cantidad_programada, o.fecha_entrega, o.fecha_pedido, o.rubro, o.largo, o.ancho, o.plancha, o.m2_tot, o.m2_pend, o.peso, o.estado, o.prioridad_secuencia,
        COALESCE(NULLIF(o.cliente, ''), p.cliente, 'Sin cliente') AS cliente,
        COALESCE(NULLIF(o.descripcion_producto, ''), p.descripcion, 'Sin descripción') AS producto_descripcion,
        COALESCE(NULLIF(TRIM(o.maquina_asignada), ''), TRIM(UPPER(p.ruta_sugerida)), 'COR-JS') AS maquina_asignada
      FROM ordenes_produccion o
      LEFT JOIN maestro_productos p ON TRIM(o.codigo_producto) = TRIM(p.codigo_producto)
      ORDER BY COALESCE(o.prioridad_secuencia, 9999) ASC, o.numero_orden DESC;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

router.put('/reordenar', async (req, res) => {
  const { nuevoOrden } = req.body; 
  if (!Array.isArray(nuevoOrden)) return res.status(400).json({ error: 'Formato incorrecto.' });
  try {
    const promesas = nuevoOrden.map((orden) => db.query('UPDATE ordenes_produccion SET prioridad_secuencia = $1 WHERE numero_orden = $2', [orden.prioridad, orden.id]));
    await Promise.all(promesas);
    res.json({ status: 'ok', mensaje: 'Cola reordenada' });
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// =========================================================================
// 7. RUTAS DINÁMICAS CON PARÁMETRO /:id (Estrictamente al final)
// =========================================================================

router.put('/:id/produccion', async (req, res) => {
  const { id } = req.params;
  const { cantidad_fabricada, estado, paradas, maquina, operador } = req.body;
  try {
    const numOrden = parseInt(id, 10);
    const cantFab = parseFloat(cantidad_fabricada) || 0;
    const estadoFinal = estado || 'Finalizada';

    await db.query(
      `UPDATE ordenes_produccion SET estado = $1, cantidad_fabricada = $2::numeric, operador = $3 WHERE numero_orden = $4::int`,
      [estadoFinal, cantFab, operador || 'General', numOrden]
    );

    if (Array.isArray(paradas) && paradas.length > 0) {
      for (const p of paradas) {
        await db.query(
          `INSERT INTO tiempos_muertos (maquina, codigo_parada, motivo, minutos_duracion, numero_orden, fecha_registro)
           VALUES ($1, $2, $3, $4::numeric, $5::int, NOW())`,
          [String(maquina || 'SIN_MAQUINA').substring(0, 50), String(p.codigo || 'PARADA').substring(0, 140), String(p.codigo || 'Sin detalle').substring(0, 240), parseFloat(p.minutos) || 0, numOrden]
        );
      }
    }

    if (maquina && global.estadoVivoMaquinas) {
      global.estadoVivoMaquinas[maquina.toUpperCase()] = {
        estado: 'ESPERA', orden: '', operador: operador || '', cajas: 0, velocidad: 0, actualizado: new Date()
      };
    }

    res.json({ status: 'ok', mensaje: 'Orden finalizada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al finalizar la orden en BD: ' + error.message });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { maquina_asignada, estado } = req.body;
  try {
    if (maquina_asignada !== undefined) await db.query('UPDATE ordenes_produccion SET maquina_asignada = $1 WHERE numero_orden = $2', [maquina_asignada, id]);
    if (estado !== undefined) await db.query('UPDATE ordenes_produccion SET estado = $1 WHERE numero_orden = $2', [estado, id]);
    res.json({ status: 'ok', mensaje: 'Orden actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar orden' });
  }
});

module.exports = router;