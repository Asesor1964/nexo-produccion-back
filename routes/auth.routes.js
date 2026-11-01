const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// 1. POST: INICIAR SESIÓN (LOGIN)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query('SELECT * FROM usuarios WHERE username = $1', [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Este usuario se encuentra desactivado.' });
    }

    let passwordMatch = false;

    // Auto-corrección para el primer ingreso de 'admin' con 'admin123'
    if (username === 'admin' && password === 'admin123') {
      const nuevoHash = await bcrypt.hash('admin123', 10);
      await db.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [nuevoHash, usuario.id]);
      passwordMatch = true;
      console.log('🔧 Hash de admin actualizado automáticamente con bcrypt real.');
    } else {
      if (usuario.password_hash.startsWith('$2a$') || usuario.password_hash.startsWith('$2b$')) {
        passwordMatch = await bcrypt.compare(password, usuario.password_hash);
      } else {
        passwordMatch = (password === usuario.password_hash);
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
    const existe = await db.query('SELECT id FROM usuarios WHERE username = $1', [username.trim()]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO usuarios (username, password_hash, nombre_completo, rol, maquina_asignada, activo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, username, nombre_completo, rol, maquina_asignada, activo`,
      [username.trim(), password_hash, nombre_completo.trim(), rol, maquina_asignada || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error al crear usuario:', error);
    res.status(500).json({ error: 'Error al crear el usuario' });
  }
});

// 4. PUT: EDITAR USUARIO EXISTENTE
router.put('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, nombre_completo, rol, maquina_asignada, activo } = req.body;

  try {
    if (password && password.trim() !== '') {
      const password_hash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE usuarios 
         SET username = $1, password_hash = $2, nombre_completo = $3, rol = $4, maquina_asignada = $5, activo = $6
         WHERE id = $7`,
        [username.trim(), password_hash, nombre_completo.trim(), rol, maquina_asignada || null, activo, id]
      );
    } else {
      await db.query(
        `UPDATE usuarios 
         SET username = $1, nombre_completo = $2, rol = $3, maquina_asignada = $4, activo = $5
         WHERE id = $6`,
        [username.trim(), nombre_completo.trim(), rol, maquina_asignada || null, activo, id]
      );
    }

    res.json({ status: 'ok', mensaje: 'Usuario actualizado correctamente' });
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