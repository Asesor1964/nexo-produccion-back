const express = require('express');
const router = express.Router();
const db = require('../db');

// ==========================================
// 1. RECIBIR PULSO DEL SENSOR (ESP32 / PLC)
// ==========================================
router.post('/pulso/:codigo', async (req, res) => {
  const { codigo } = req.params;
  const { orden_id, piezas_incremento, peso_incremento, maquinista, supervisor } = req.body;

  try {
    // 1. Validar que la máquina exista en la base de datos
    const maqCheck = await db.query(
      'SELECT modo_captura FROM maquinas WHERE codigo_maquina = $1',
      [codigo]
    );

    if (maqCheck.rows.length === 0) {
      console.warn(`⚠️ [IoT] Intento de pulso para una máquina no registrada: ${codigo}`);
      return res.status(404).json({ error: `La máquina ${codigo} no está registrada en el sistema.` });
    }

    // 2. Verificar si la máquina está en modo AUTOMATICO
    const maquina = maqCheck.rows[0];
    if (maquina.modo_captura !== 'AUTOMATICO') {
      return res.status(400).json({ 
        error: `La máquina ${codigo} se encuentra en modo MANUAL. El sensor está deshabilitado.` 
      });
    }

    // 3. Registrar el pulso automático en la tabla de producción / scrap
    const result = await db.query(
      `INSERT INTO registro_scrap 
       (orden_id, maquina_real, maquinista_real, supervisor_real, piezas, peso_kg, observaciones, origen, fecha_hora) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'AUTOMATICO_IOT', NOW()) RETURNING *`,
      [
        orden_id || null, 
        codigo, 
        maquinista || 'SISTEMA AUTOMÁTICO', 
        supervisor || 'MARTINEZ ELVIO', 
        piezas_incremento || 1, 
        peso_incremento || 0.00, 
        `Pulso automático recibido de dispositivo IoT (${codigo})`
      ]
    );

    console.log(`🤖 [IoT / TELEMETRÍA] Pulso registrado en máquina ${codigo} | +${piezas_incremento || 1} piezas`);
    res.status(201).json({ ok: true, evento: result.rows[0] });
  } catch (error) {
    console.error('❌ Error al procesar pulso IoT:', error.message);
    res.status(500).json({ error: 'Error interno al procesar telemetría' });
  }
});

module.exports = router;