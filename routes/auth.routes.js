const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// 1. POST: INICIAR SESIÓN (LOGIN)
router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();

  try {
    const result = await db.query(
      'SELECT * FROM usuarios WHERE LOWER(TRIM(username)) = LOWER($1)',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Este usuario se encuentra desactivado.' });
    }

    let passwordMatch = false;
    const hashActual = String(usuario.password_hash || '');

    // Comparación segura: respeta siempre la contraseña actual guardada en la BD
    if (hashActual.startsWith('$2a$') || hashActual.startsWith('$2b$')) {
      passwordMatch = await bcrypt.compare(password, hashActual);
    } else {
      // Si alguna vez se cargó en texto plano directo en la BD, valida y la encripta sin pisar claves nuevas
      passwordMatch = (password === hashActual);
      if (passwordMatch && password) {
        const nuevoHash = await bcrypt.hash(password, 10);
        await db.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [nuevoHash, usuario.id]);
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const token = jwt.sign(
      { 
        id: usuario.id, 
        username: usuario.username, 
        rol: usuario.rol, 
        nombre: usuario.nombre_completo,
        maquina: usuario.maquina_asignada 
      },
      process.env.JWT_SECRET || 'nexo_produccion_clave_secreta_2026',
      { expiresIn: '12h' }
    );

    console.log(`✅ [LOGIN EXITOSO] ${usuario.nombre_completo} (${usuario.rol})`);
    res.json({
      status: 'ok',
      token,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        nombre: usuario.nombre_completo,
        rol: usuario.rol,
        maquina: usuario.maquina_asignada
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 2. GET: LISTAR TODOS LOS USUARIOS
router.get('/usuarios', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, nombre_completo, rol, maquina_asignada, activo, fecha_creacion FROM usuarios ORDER BY id ASC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error al obtener la lista de usuarios' });
  }
});

// 3. POST: CREAR NUEVO USUARIO
router.post('/usuarios', async (req, res) => {
  const { username, password, nombre_completo, rol, maquina_asignada } = req.body;

  try {
    const userLimpio = String(username || '').trim();
    const passLimpia = String(password || '').trim();

    if (!userLimpio || !passLimpia) {
      return res.status(400).json({ error: 'Usuario y contraseña obligatorios.' });
    }

    const existe = await db.query(
      'SELECT id FROM usuarios WHERE LOWER(TRIM(username)) = LOWER($1)',
      [userLimpio]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
    }

    const password_hash = await bcrypt.hash(passLimpia, 10);

    const result = await db.query(
      `INSERT INTO usuarios (username, password_hash, nombre_completo, rol, maquina_asignada, activo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, username, nombre_completo, rol, maquina_asignada, activo`,
      [userLimpio, password_hash, String(nombre_completo || '').trim(), rol, maquina_asignada || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error al crear usuario:', error);
    res.status(500).json({ error: 'Error al crear el usuario' });
  }
});

// 4. PUT: EDITAR USUARIO EXISTENTE (INCLUYE CAMBIO DE CONTRASEÑA)
router.put('/usuarios/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username, password, nombre_completo, rol, maquina_asignada, activo } = req.body;

  try {
    const userLimpio = String(username || '').trim();
    const nombreLimpio = String(nombre_completo || '').trim();
    const passLimpia = password ? String(password).trim() : '';
    const estadoActivo = activo !== undefined ? Boolean(activo) : true;

    let cambioClave = false;

    if (passLimpia !== '') {
      const password_hash = await bcrypt.hash(passLimpia, 10);
      await db.query(
        `UPDATE usuarios 
         SET username = $1, password_hash = $2, nombre_completo = $3, rol = $4, maquina_asignada = $5, activo = $6
         WHERE id = $7`,
        [userLimpio, password_hash, nombreLimpio, rol, maquina_asignada || null, estadoActivo, id]
      );
      cambioClave = true;
    } else {
      await db.query(
        `UPDATE usuarios 
         SET username = $1, nombre_completo = $2, rol = $3, maquina_asignada = $4, activo = $5
         WHERE id = $6`,
        [userLimpio, nombreLimpio, rol, maquina_asignada || null, estadoActivo, id]
      );
    }

    res.json({
      status: 'ok',
      cambio_clave: cambioClave,
      mensaje: cambioClave
        ? `✅ Usuario "${userLimpio}" y su NUEVA CONTRASEÑA actualizados correctamente.`
        : `✅ Datos de "${userLimpio}" actualizados (sin cambio de contraseña).`
    });
  } catch (error) {
    console.error('❌ Error al actualizar usuario:', error);
    res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
});

// 5. DELETE: ELIMINAR USUARIO
router.delete('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ status: 'ok', mensaje: 'Usuario eliminado' });
  } catch (error) {
    console.error('❌ Error al eliminar usuario:', error);
    res.status(500).json({ error: 'Error al eliminar el usuario' });
  }
});

module.exports = router;