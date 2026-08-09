'use strict';

const path = require('path');
require('dotenv').config();

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  port: num(process.env.PORT, 3001),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bar_campo',
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, 10)
  },

  session: {
    // Em producao o segredo tem de vir do ambiente; ver validacao abaixo.
    secret: process.env.SESSION_SECRET || 'dev-secret-inseguro-mudar',
    cookieSecure: bool(process.env.SESSION_COOKIE_SECURE, false)
  },

  uploads: {
    dir: path.join(__dirname, '..', '..', 'public', 'uploads'),
    publicPath: '/uploads',
    maxBytes: num(process.env.UPLOAD_MAX_BYTES, 2 * 1024 * 1024),
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp']
  },

  paths: {
    root: path.join(__dirname, '..', '..'),
    views: path.join(__dirname, '..', '..', 'views'),
    public: path.join(__dirname, '..', '..', 'public')
  }
};

if (env.isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET e obrigatorio em producao.');
}

module.exports = env;
