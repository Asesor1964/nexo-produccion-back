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
// Variable global temporal o guardada en memoria para el estado vivo de máquinas
if (!global.estadoVivoMaquinas) {
  global.estadoVivoMaquinas = {};
}

router.put('/maquinas/:maquina/estado-vivo', async (req, res) => {
  const { maquina } = req.params;
  const { estado, orden, operador, cajas, velocidad, segundos_fase } = req.body;
  
  const claveMaq = String(maquina || '').trim().toUpperCase();

  // Guardamos incluyendo los segundos reales de la fase actual
  global.estadoVivoMaquinas[claveMaq] = {
    estado: estado || 'ESPERA',
    orden: orden || '',
    operador: operador || '',
    cajas: Number(cajas) || 0,
    velocidad: Number(velocidad) || 0,
    segundos_fase: Number(segundos_fase) || 0, // 👈 CRUCIAL: Captura el cronómetro al segundo
    actualizado: new Date()
  };

  res.json({ status: 'ok', estadoVivo: global.estadoVivoMaquinas[claveMaq] });
});

router.get('/maquinas/:maquina/estado-vivo', async (req, res) => {
  const { maquina } = req.params;
  const claveMaq = String(maquina || '').trim().toUpperCase();
  
  const estadoVivo = global.estadoVivoMaquinas[claveMaq] || { 
    estado: 'ESPERA', 
    orden: '', 
    operador: '', 
    cajas: 0, 
    velocidad: 0, 
    segundos_fase: 0 
  };

  res.json(estadoVivo);
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
// 4. TIEMPOS MUERTOS E HISTORIAL (CRUD COMPLETO)
// =========================================================================

router.get(['/tiempos-muertos/todos', '/tiempos-muertos'], async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tiempos_muertos ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.json([]);
  }
});

router.post('/tiempos-muertos', async (req, res) => {
  const { maquina, codigo_parada, motivo, minutos_duracion, numero_orden, operador } = req.body;
  try {
    await db.query(`ALTER TABLE tiempos_muertos ADD COLUMN IF NOT EXISTS operador VARCHAR(100)`);
    
    const result = await db.query(
      `INSERT INTO tiempos_muertos (maquina, codigo_parada, motivo, minutos_duracion, numero_orden, operador, fecha_registro)
       VALUES ($1, $2, $3, $4::numeric, $5::int, $6, NOW()) RETURNING *`,
      [
        String(maquina || 'SIN_MAQUINA').substring(0, 50),
        String(codigo_parada || motivo || 'PARADA').substring(0, 140),
        String(motivo || codigo_parada || 'Sin detalle').substring(0, 240),
        parseFloat(minutos_duracion) || 0,
        numero_orden ? parseInt(numero_orden, 10) : null,
        operador || 'Sin Operador'
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error POST /tiempos-muertos:', error.message);
    res.status(500).json({ error: 'Error al registrar tiempo muerto: ' + error.message });
  }
});

// ✏️ EDITAR TIEMPO MUERTO (Minutos y Motivo/Código de Parada)
router.put('/tiempos-muertos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { minutos_duracion, minutos, duracion, codigo_parada, motivo } = req.body;

    // Acepta cualquiera de los nombres de propiedad que envíe el frontend
    const nuevosMinutos = parseFloat(minutos_duracion ?? minutos ?? duracion) || 0;
    const nuevoMotivo = String(motivo || codigo_parada || 'Sin detalle').substring(0, 240);
    const nuevoCodigo = String(codigo_parada || motivo || 'PARADA').substring(0, 140);

    const result = await db.query(
      `UPDATE tiempos_muertos 
       SET minutos_duracion = $1::numeric,
           codigo_parada = $2,
           motivo = $3
       WHERE id = $4
       RETURNING *`,
      [nuevosMinutos, nuevoCodigo, nuevoMotivo, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error PUT /tiempos-muertos/:id:', error.message);
    res.status(500).json({ error: 'Error al actualizar tiempo muerto: ' + error.message });
  }
});

// 🗑️ ELIMINAR TIEMPO MUERTO (Para el botón rojo del tachito en Auditoría)
router.delete('/tiempos-muertos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM tiempos_muertos WHERE id = $1', [id]);
    res.json({ ok: true, mensaje: 'Registro eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error DELETE /tiempos-muertos/:id:', error.message);
    res.status(500).json({ error: 'Error al eliminar tiempo muerto: ' + error.message });
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
      WHERE TRIM(LOWER(o.estado)) IN ('finalizada', 'completada', 'terminada', 'cerrada', 'finalizada parcial', 'parcial')
      ORDER BY o.numero_orden DESC;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) { 
    console.error('Error al obtener historial:', error.message);
    res.json([]); 
  }
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

// Funciones auxiliares para limpiar datos crudos de Procusto
const formatearFechaParaPG = (fechaStr) => {
  if (!fechaStr) return null;
  const limpia = String(fechaStr).trim();
  if (!limpia) return null;
  const partes = limpia.split(/[\/\-]/);
  if (partes.length === 3) {
    if (partes[0].length === 4) return limpia; // Ya es YYYY-MM-DD
    const dia = partes[0].padStart(2, '0');
    const mes = partes[1].padStart(2, '0');
    const anio = partes[2].length === 2 ? `20${partes[2]}` : partes[2];
    const fechaISO = `${anio}-${mes}-${dia}`;
    return isNaN(Date.parse(fechaISO)) ? null : fechaISO;
  }
  return null;
};

const parsearNumeroCSV = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const limpio = String(val).replace(/\./g, '').replace(',', '.').trim();
  const num = parseFloat(limpio);
  return isNaN(num) ? null : num;
};

router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT o.numero_orden AS id, o.numero_orden, o.codigo_producto, o.cantidad_programada, o.fecha_entrega, o.fecha_pedido, o.rubro, o.largo, o.ancho, o.plancha, o.m2_tot, o.m2_pend, o.peso, o.estado, o.prioridad_secuencia, COALESCE(o.cantidad_faltante, 0) AS cantidad_faltante,
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
    console.error('❌ Error en GET /api/pedidos:', error.message);
    res.status(500).json({ error: 'Error al obtener pedidos: ' + error.message });
  }
});

router.post(['/sincronizar', '/importar', '/cargar-csv'], async (req, res) => {
  const listaPedidos = req.body.pedidos || req.body.ordenes || (Array.isArray(req.body) ? req.body : []);

  if (!Array.isArray(listaPedidos) || listaPedidos.length === 0) {
    return res.status(400).json({ error: 'No se recibieron pedidos válidos para sincronizar.' });
  }

  try {
    // 1. Blindaje preventivo de columnas en la tabla
    await db.query(`
      ALTER TABLE ordenes_produccion 
        ADD COLUMN IF NOT EXISTS cliente VARCHAR(150),
        ADD COLUMN IF NOT EXISTS descripcion_producto TEXT,
        ADD COLUMN IF NOT EXISTS fecha_pedido DATE,
        ADD COLUMN IF NOT EXISTS rubro VARCHAR(100),
        ADD COLUMN IF NOT EXISTS largo NUMERIC,
        ADD COLUMN IF NOT EXISTS ancho NUMERIC,
        ADD COLUMN IF NOT EXISTS plancha VARCHAR(50),
        ADD COLUMN IF NOT EXISTS m2_tot NUMERIC,
        ADD COLUMN IF NOT EXISTS m2_pend NUMERIC,
        ADD COLUMN IF NOT EXISTS peso NUMERIC,
        ADD COLUMN IF NOT EXISTS prioridad_secuencia INTEGER DEFAULT 999,
        ADD COLUMN IF NOT EXISTS cantidad_fabricada NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cantidad_faltante NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS operador VARCHAR(100);
    `);

    // 2. Cargamos el maestro de productos en memoria para cruce instantáneo
    const maestroRes = await db.query(
      'SELECT codigo_producto, cliente, descripcion, largo_mm, ancho_mm, ruta_sugerida FROM maestro_productos'
    );
    const maestroMap = new Map();
    maestroRes.rows.forEach((m) => {
      if (m.codigo_producto) {
        maestroMap.set(String(m.codigo_producto).trim().toUpperCase(), m);
      }
    });

    let procesados = 0;
    let omitidos = 0;

    // 3. Procesamos cada pedido individualmente con upsert seguro
    for (const item of listaPedidos) {
      const rawNum = item.numero_orden ?? item.numero ?? item.id;
      const numOrden = parseInt(String(rawNum || '').replace(/\./g, '').trim(), 10);

      // Filtro estricto: N° de orden válido de planta (1 a 999999)
      if (!numOrden || isNaN(numOrden) || numOrden <= 0 || numOrden > 999999) {
        omitidos++;
        continue;
      }

      const cantProg = Math.round(parsearNumeroCSV(item.cantidad_programada ?? item.cantidad ?? 0) || 0);
      
      // Filtro anti-basura: si la cantidad programada es 0 o menor, se omite
      if (cantProg <= 0) {
        omitidos++;
        continue;
      }

      const codProd = String(item.codigo_producto ?? item.codigo ?? 'SIN_CODIGO').trim();
      const maestroMatch = maestroMap.get(codProd.toUpperCase()) || {};

      const clienteFinal = String(item.cliente || '').trim() || maestroMatch.cliente || 'Sin cliente';
      const descFinal = String(item.descripcion_producto || item.descripcion || '').trim() || maestroMatch.descripcion || 'Sin descripción';
      const fechaPed = formatearFechaParaPG(item.fecha_pedido);
      const fechaEnt = formatearFechaParaPG(item.fecha_entrega);
      const rubro = item.rubro ? String(item.rubro).trim() : null;

      const largoFinal = parsearNumeroCSV(item.largo) ?? maestroMatch.largo_mm ?? null;
      const anchoFinal = parsearNumeroCSV(item.ancho) ?? maestroMatch.ancho_mm ?? null;
      const plancha = item.plancha ? String(item.plancha).trim() : null;
      const m2Tot = parsearNumeroCSV(item.m2_tot);
      const m2Pend = parsearNumeroCSV(item.m2_pend);
      const peso = parsearNumeroCSV(item.peso);

      const rutaCandidata = String(item.maquina_asignada ?? item.ruta ?? '').trim().toUpperCase();
      const rutaEsValida = rutaCandidata && isNaN(rutaCandidata) && !rutaCandidata.includes(',');
      const rutaFinal = rutaEsValida
        ? rutaCandidata
        : (maestroMatch.ruta_sugerida ? String(maestroMatch.ruta_sugerida).trim().toUpperCase() : 'COR-JS');

      await db.query(
        `INSERT INTO ordenes_produccion (
          numero_orden, codigo_producto, cliente, descripcion_producto,
          cantidad_programada, fecha_pedido, fecha_entrega, rubro,
          largo, ancho, plancha, m2_tot, m2_pend, peso,
          maquina_asignada, estado
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'Pendiente')
        ON CONFLICT (numero_orden) DO UPDATE SET
          codigo_producto = EXCLUDED.codigo_producto,
          cliente = COALESCE(NULLIF(EXCLUDED.cliente, 'Sin cliente'), ordenes_produccion.cliente),
          descripcion_producto = COALESCE(NULLIF(EXCLUDED.descripcion_producto, 'Sin descripción'), ordenes_produccion.descripcion_producto),
          cantidad_programada = EXCLUDED.cantidad_programada,
          fecha_pedido = COALESCE(EXCLUDED.fecha_pedido, ordenes_produccion.fecha_pedido),
          fecha_entrega = COALESCE(EXCLUDED.fecha_entrega, ordenes_produccion.fecha_entrega),
          rubro = COALESCE(EXCLUDED.rubro, ordenes_produccion.rubro),
          largo = COALESCE(EXCLUDED.largo, ordenes_produccion.largo),
          ancho = COALESCE(EXCLUDED.ancho, ordenes_produccion.ancho),
          plancha = COALESCE(EXCLUDED.plancha, ordenes_produccion.plancha),
          m2_tot = COALESCE(EXCLUDED.m2_tot, ordenes_produccion.m2_tot),
          m2_pend = COALESCE(EXCLUDED.m2_pend, ordenes_produccion.m2_pend),
          peso = COALESCE(EXCLUDED.peso, ordenes_produccion.peso),
          maquina_asignada = COALESCE(NULLIF(EXCLUDED.maquina_asignada, ''), ordenes_produccion.maquina_asignada);`,
        [
          numOrden, codProd, clienteFinal, descFinal,
          cantProg, fechaPed, fechaEnt, rubro,
          largoFinal, anchoFinal, plancha, m2Tot, m2Pend, peso,
          rutaFinal
        ]
      );
      procesados++;
    }

    res.json({
      status: 'ok',
      procesados,
      omitidos,
      mensaje: `Sincronización completada con éxito.\n✅ Órdenes procesadas: ${procesados}\n⚠️ Filas omitidas: ${omitidos}`
    });
  } catch (error) {
    console.error('❌ Error en POST /api/pedidos/sincronizar:', error.message);
    res.status(500).json({ error: 'Error al sincronizar pedidos: ' + error.message });
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

router.post('/:id/reprogramar-faltante', async (req, res) => {
  const { id } = req.params;
  const { cantidad_faltante } = req.body;
  try {
    const numOrden = parseInt(id, 10);
    const saldo = Math.round(parseFloat(cantidad_faltante) || 0);
    await db.query(
      `UPDATE ordenes_produccion 
       SET cantidad_programada = $1, 
           cantidad_faltante = 0, 
           estado = 'Pendiente' 
       WHERE numero_orden = $2`,
      [saldo, numOrden]
    );
    res.json({ status: 'ok', mensaje: 'Saldo pendiente reprogramado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al reprogramar faltante: ' + error.message });
  }
});

router.put('/:id/produccion', async (req, res) => {
  const { id } = req.params;
  const { cantidad_fabricada, estado, paradas, maquina, operador } = req.body;
  try {
    const numOrden = parseInt(id, 10);
    const cantFab = parseFloat(cantidad_fabricada) || 0;

    // 1. Consultar la orden original para comparar con la meta programada
    const ordenOrigRes = await db.query('SELECT * FROM ordenes_produccion WHERE numero_orden = $1', [numOrden]);
    if (ordenOrigRes.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    const ordenOriginal = ordenOrigRes.rows[0];
    const metaProgramada = parseFloat(ordenOriginal.cantidad_programada) || 0;

    // 2. Evaluar si hubo faltante
    const hayFaltante = cantFab < metaProgramada;
    const unidadesFaltantes = hayFaltante ? (metaProgramada - cantFab) : 0;
    const estadoFinal = hayFaltante ? 'Finalizada Parcial' : 'Finalizada';

    // 3. Actualizar la orden en la BD guardando la cantidad fabricada y el faltante
    await db.query(
      `UPDATE ordenes_produccion 
       SET estado = $1, 
           cantidad_fabricada = $2::numeric, 
           operador = $3,
           cantidad_faltante = $4::numeric 
       WHERE numero_orden = $5::int`,
      [estadoFinal, cantFab, operador || 'General', unidadesFaltantes, numOrden]
    );

    // 4. Registrar tiempos muertos si los hubo
    // 4. Registrar tiempos muertos pendientes (solo los que no se hayan guardado ya en vivo)
    if (Array.isArray(paradas) && paradas.length > 0) {
      await db.query(`ALTER TABLE tiempos_muertos ADD COLUMN IF NOT EXISTS operador VARCHAR(100)`);
      for (const p of paradas) {
        if (p.guardadaEnBD) continue; // Evita duplicar si ya se envió en vivo
        await db.query(
          `INSERT INTO tiempos_muertos (maquina, codigo_parada, motivo, minutos_duracion, numero_orden, operador, fecha_registro)
           VALUES ($1, $2, $3, $4::numeric, $5::int, $6, NOW())`,
          [
            String(maquina || 'SIN_MAQUINA').substring(0, 50),
            String(p.codigo || 'PARADA').substring(0, 140),
            String(p.codigo || 'Sin detalle').substring(0, 240),
            parseFloat(p.minutos ?? p.minutos_duracion) || 0,
            numOrden,
            p.operador || operador || 'General'
          ]
        );
      }
    }

    if (maquina && global.estadoVivoMaquinas) {
      global.estadoVivoMaquinas[maquina.toUpperCase()] = {
        estado: 'ESPERA', orden: '', operador: operador || '', cajas: 0, velocidad: 0, actualizado: new Date()
      };
    }

    res.json({ 
      status: 'ok', 
      mensaje: hayFaltante 
        ? `Orden cerrada parcialmente. Faltante registrado: ${unidadesFaltantes} cajas pendientes.` 
        : 'Orden finalizada correctamente' 
    });
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