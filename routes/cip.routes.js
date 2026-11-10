const express = require('express');
const router = express.Router();
const db = require('../db');

// =========================================================================
// 1. POST: Guardar un nuevo protocolo CIP (RE-PRO 009) con las 6 tintas y JSONB
// =========================================================================
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
    tintas_detalle,
    verificacion_items,
    inspeccion_paquetes,
    tinta_1_color, tinta_1_lote,
    tinta_2_color, tinta_2_lote,
    tinta_3_color, tinta_3_lote,
    tinta_4_color, tinta_4_lote,
    tinta_5_color, tinta_5_lote,
    tinta_6_color, tinta_6_lote,
    observaciones
  } = req.body;

  try {
    const td = tintas_detalle || {};
    const c1 = tinta_1_color ?? td?.tinta1?.color ?? '';
    const l1 = tinta_1_lote  ?? td?.tinta1?.lote  ?? '';
    const c2 = tinta_2_color ?? td?.tinta2?.color ?? '';
    const l2 = tinta_2_lote  ?? td?.tinta2?.lote  ?? '';
    const c3 = tinta_3_color ?? td?.tinta3?.color ?? '';
    const l3 = tinta_3_lote  ?? td?.tinta3?.lote  ?? '';
    const c4 = tinta_4_color ?? td?.tinta4?.color ?? '';
    const l4 = tinta_4_lote  ?? td?.tinta4?.lote  ?? '';
    const c5 = tinta_5_color ?? td?.tinta5?.color ?? '';
    const l5 = tinta_5_lote  ?? td?.tinta5?.lote  ?? '';
    const c6 = tinta_6_color ?? td?.tinta6?.color ?? '';
    const l6 = tinta_6_lote  ?? td?.tinta6?.lote  ?? '';

    const hendidoBool =
      hendido_desplazado === true ||
      String(hendido_desplazado).toUpperCase() === 'SI' ||
      String(hendido_desplazado).toUpperCase() === 'TRUE';

    const query = `
      INSERT INTO public.control_proceso_conversion (
        numero_orden, operador, supervisor, turno, maquina, 
        tipo_onda, tipo_chapeton, hendido_desplazado, liner_externo, tipo_cierre,
        tintas_detalle, verificacion_items, inspeccion_paquetes,
        tinta_1_color, tinta_1_lote,
        tinta_2_color, tinta_2_lote,
        tinta_3_color, tinta_3_lote,
        tinta_4_color, tinta_4_lote,
        tinta_5_color, tinta_5_lote,
        tinta_6_color, tinta_6_lote,
        observaciones
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11::jsonb, $12::jsonb, $13::jsonb,
        $14, $15,
        $16, $17,
        $18, $19,
        $20, $21,
        $22, $23,
        $24, $25,
        $26
      )
      RETURNING *;
    `;

    const values = [
      numero_orden,
      operador || 'Operador Planta',
      supervisor || '',
      turno || 'M',
      maquina || 'SIN_MAQUINA',
      tipo_onda || 'CB',
      tipo_chapeton || 'Normal',
      hendidoBool,
      liner_externo || 'Kraft',
      tipo_cierre || 'Pegado',
      JSON.stringify(td),
      JSON.stringify(verificacion_items || {}),
      JSON.stringify(inspeccion_paquetes || []),
      c1, l1,
      c2, l2,
      c3, l3,
      c4, l4,
      c5, l5,
      c6, l6,
      observaciones || ''
    ];

    const result = await db.query(query, values);
    console.log(`📋 [CIP RE-PRO 009] Protocolo completo guardado para Orden N°: ${numero_orden}`);
    res.status(201).json({ status: 'ok', protocolo: result.rows[0] });

  } catch (error) {
    console.error('❌ Error al guardar protocolo CIP:', error.message);
    res.status(500).json({ error: 'Error al guardar el protocolo en la base de datos: ' + error.message });
  }
});

// =========================================================================
// 2. GET: Autocompletar colores y receta desde la BD al abrir la Planilla CIP
// =========================================================================
router.get('/receta/:numero_orden', async (req, res) => {
  try {
    const { numero_orden } = req.params;

    const ordRes = await db.query(
      'SELECT * FROM public.ordenes_produccion WHERE numero_orden = $1 LIMIT 1',
      [numero_orden]
    );
    const orden = ordRes.rows[0] || {};
    const codProd = orden.codigo_producto || '';
    const descProd = orden.descripcion_producto || orden.producto_descripcion || '';

    let respuestaColores = {
      numero_orden,
      codigo_producto: codProd,
      descripcion_producto: descProd,
      colores_texto: orden.colores || '',
      tinta1Color: orden.tinta_1_color || orden.color_1 || '',
      tinta2Color: orden.tinta_2_color || orden.color_2 || '',
      tinta3Color: orden.tinta_3_color || orden.color_3 || '',
      tinta4Color: orden.tinta_4_color || orden.color_4 || '',
      tinta5Color: orden.tinta_5_color || orden.color_5 || '',
      tinta6Color: orden.tinta_6_color || orden.color_6 || '',
      tinta1Lote: '', tinta2Lote: '', tinta3Lote: '',
      tinta4Lote: '', tinta5Lote: '', tinta6Lote: ''
    };

    if (respuestaColores.colores_texto && !respuestaColores.tinta1Color) {
      const partes = String(respuestaColores.colores_texto).split(/[,;/]/).map(s => s.trim()).filter(Boolean);
      partes.forEach((col, i) => {
        if (i < 6) respuestaColores[`tinta${i + 1}Color`] = col;
      });
    }

    const tablasMaestro = ['maestro_productos', 'productos', 'catalogo_productos', 'articulos'];
    for (const tabla of tablasMaestro) {
      try {
        const checkTabla = await db.query(`SELECT to_regclass('public.${tabla}') AS existe`);
        if (checkTabla.rows[0]?.existe) {
          const prodQuery = await db.query(
            `SELECT * FROM public.${tabla} 
             WHERE ($1 <> '' AND (CAST(codigo_producto AS TEXT) = $1 OR CAST(codigo AS TEXT) = $1))
                OR ($2 <> '' AND UPPER(TRIM(COALESCE(descripcion, ''))) = UPPER(TRIM($2)))
             LIMIT 1`,
            [String(codProd), String(descProd)]
          );
          if (prodQuery.rows.length > 0) {
            const mp = prodQuery.rows[0];
            const recetaStr = mp.colores || mp.tintas || mp.receta_colores || '';
            if (recetaStr) respuestaColores.colores_texto = recetaStr;

            const listaDesdeTexto = recetaStr ? String(recetaStr).split(/[,;/]/).map(s => s.trim()).filter(Boolean) : [];

            respuestaColores.tinta1Color = mp.tinta_1_color || mp.color_1 || mp.color1 || mp.tinta1 || listaDesdeTexto[0] || respuestaColores.tinta1Color;
            respuestaColores.tinta2Color = mp.tinta_2_color || mp.color_2 || mp.color2 || mp.tinta2 || listaDesdeTexto[1] || respuestaColores.tinta2Color;
            respuestaColores.tinta3Color = mp.tinta_3_color || mp.color_3 || mp.color3 || mp.tinta3 || listaDesdeTexto[2] || respuestaColores.tinta3Color;
            respuestaColores.tinta4Color = mp.tinta_4_color || mp.color_4 || mp.color4 || mp.tinta4 || listaDesdeTexto[3] || respuestaColores.tinta4Color;
            respuestaColores.tinta5Color = mp.tinta_5_color || mp.color_5 || mp.color5 || mp.tinta5 || listaDesdeTexto[4] || respuestaColores.tinta5Color;
            respuestaColores.tinta6Color = mp.tinta_6_color || mp.color_6 || mp.color6 || mp.tinta6 || listaDesdeTexto[5] || respuestaColores.tinta6Color;
            break;
          }
        }
      } catch (e) {
        // Continúa si alguna columna difiere
      }
    }

    try {
      const cipPrevio = await db.query(
        `SELECT c.* 
         FROM public.control_proceso_conversion c
         LEFT JOIN public.ordenes_produccion o ON o.numero_orden = c.numero_orden
         WHERE c.numero_orden = $1 
            OR ($2 <> '' AND o.codigo_producto = $2)
         ORDER BY (c.numero_orden = $1) DESC, c.id DESC
         LIMIT 1`,
        [numero_orden, String(codProd)]
      );

      if (cipPrevio.rows.length > 0) {
        const cp = cipPrevio.rows[0];
        const td = cp.tintas_detalle || {};
        respuestaColores.tinta1Color = cp.tinta_1_color || td?.tinta1?.color || respuestaColores.tinta1Color;
        respuestaColores.tinta2Color = cp.tinta_2_color || td?.tinta2?.color || respuestaColores.tinta2Color;
        respuestaColores.tinta3Color = cp.tinta_3_color || td?.tinta3?.color || respuestaColores.tinta3Color;
        respuestaColores.tinta4Color = cp.tinta_4_color || td?.tinta4?.color || respuestaColores.tinta4Color;
        respuestaColores.tinta5Color = cp.tinta_5_color || td?.tinta5?.color || respuestaColores.tinta5Color;
        respuestaColores.tinta6Color = cp.tinta_6_color || td?.tinta6?.color || respuestaColores.tinta6Color;

        if (String(cp.numero_orden) === String(numero_orden)) {
          respuestaColores.tinta1Lote = cp.tinta_1_lote || td?.tinta1?.lote || '';
          respuestaColores.tinta2Lote = cp.tinta_2_lote || td?.tinta2?.lote || '';
          respuestaColores.tinta3Lote = cp.tinta_3_lote || td?.tinta3?.lote || '';
          respuestaColores.tinta4Lote = cp.tinta_4_lote || td?.tinta4?.lote || '';
          respuestaColores.tinta5Lote = cp.tinta_5_lote || td?.tinta5?.lote || '';
          respuestaColores.tinta6Lote = cp.tinta_6_lote || td?.tinta6?.lote || '';
        }
      }
    } catch (e) {
      console.error('Aviso al consultar historial CIP:', e.message);
    }

    if (!respuestaColores.colores_texto) {
      const lista = [
        respuestaColores.tinta1Color,
        respuestaColores.tinta2Color,
        respuestaColores.tinta3Color,
        respuestaColores.tinta4Color,
        respuestaColores.tinta5Color,
        respuestaColores.tinta6Color
      ].filter(c => c && c !== 'SIN IMPRESION / VACIO');
      respuestaColores.colores_texto = lista.join(', ');
    }

    res.json(respuestaColores);
  } catch (error) {
    console.error('Error en GET /api/cip/receta/:numero_orden:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =========================================================================
// 3. GET: Consultar protocolos CIP por número de orden (Auditorías / Reclamos)
// =========================================================================
router.get('/orden/:numero_orden', async (req, res) => {
  const { numero_orden } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM public.control_proceso_conversion WHERE numero_orden = $1 ORDER BY id DESC',
      [numero_orden]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al consultar protocolos CIP:', error.message);
    res.status(500).json({ error: 'Error al consultar protocolos' });
  }
});

module.exports = router;