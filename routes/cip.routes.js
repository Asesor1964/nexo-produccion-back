const express = require('express');
const router = express.Router();
const db = require('../db'); // Asegúrate de que esta sea la ruta correcta a tu conexión de base de datos

// POST: Guardar un nuevo protocolo CIP (RE-PRO 009)
router.post('/', async (req, res) => {
  const {
    numero_orden,
    operador,
    supervisor,
    turno,
    maquina,
    tipo_onda,
    tipo_chapeton,
    hendido_desplazado,
    liner_externo,
    tipo_cierre,
    tinta_1_color,
    tinta_1_lote,
    tinta_2_color,
    tinta_2_lote,
    observaciones
  } = req.body;

  try {
    const query = `
      INSERT INTO control_proceso_conversion (
        numero_orden, operador, supervisor, turno, maquina, 
        tipo_onda, tipo_chapeton, hendido_desplazado, liner_externo, 
        tipo_cierre, tinta_1_color, tinta_1_lote, tinta_2_color, 
        tinta_2_lote, observaciones
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    const values = [
      numero_orden, operador, supervisor, turno, maquina,
      tipo_onda, tipo_chapeton, hendido_desplazado, liner_externo,
      tipo_cierre, tinta_1_color, tinta_1_lote, tinta_2_color,
      tinta_2_lote, observaciones
    ];

    const result = await db.query(query, values);
    console.log(`📋 [CIP RE-PRO 009] Protocolo guardado para Orden N°: ${numero_orden}`);
    res.status(201).json({ status: 'ok', protocolo: result.rows[0] });

  } catch (error) {
    console.error('❌ Error al guardar protocolo CIP:', error.message);
    res.status(500).json({ error: 'Error al guardar el protocolo en la base de datos: ' + error.message });
  }
});

// GET: Consultar protocolos CIP por número de orden (para auditorías o reclamos)
router.get('/orden/:numero_orden', async (req, res) => {
  const { numero_orden } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM control_proceso_conversion WHERE numero_orden = $1 ORDER BY id DESC',
      [numero_orden]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al consultar protocolos CIP:', error.message);
    res.status(500).json({ error: 'Error al consultar protocolos' });
  }
});

module.exports = router;