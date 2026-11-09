const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');

// 1. INICIALIZAR EXPRESS PRIMERO QUE TODO
const app = express();
const PORT = process.env.PORT || 5000;

// 🛡️ 2. MIDDLEWARES GLOBALES (¡DEBEN IR ANTES DE LAS RUTAS!)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 🚀 3. IMPORTAR Y REGISTRAR RUTAS (Ahora 'app' ya existe)
const authRoutes = require('./routes/auth.routes');
const productosRoutes = require('./routes/productos.routes');
const pedidosRoutes = require('./routes/pedidos.routes');
const cipRoutes = require('./routes/cip.routes');
const scrapRoutes = require('./routes/scrap.routes');
const iotRoutes = require('./routes/iot.routes'); // 🤖 NUEVO: Cerebro independiente de Telemetría e IoT
const expedicionRoutes = require('./routes/expedicion.routes');


app.use('/api/auth', authRoutes);
app.use('/api/cip', cipRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api', pedidosRoutes); 
app.use('/api/scrap', scrapRoutes);
app.use('/api/iot', iotRoutes);     // 🤖 NUEVO: Montado en su propio espacio seguro (/api/iot/...)
app.use('/api/expedicion', expedicionRoutes);

// Ruta de salud
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.json({ status: 'ok', serverTime: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: 'Error de conexión a la BD' });
  }
});

// 🔍 RADAR DE URLS 404
app.use((req, res, next) => {
  console.log(`❌ Ruta no encontrada (404): ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: `Ruta ${req.originalUrl} no encontrada en el backend` });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en http://localhost:${PORT}`);
});