const { Pool } = require('pg');
require('dotenv').config();

// Si existe DATABASE_URL (en Railway), la usa; si no, usa las variables locales de tu .env
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
      }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
      }
);

pool.on('connect', () => {
  console.log('✅ Conectado exitosamente a PostgreSQL');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};