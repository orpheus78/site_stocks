'use strict';

const mariadb = require('mariadb');
const env = require('./env');

const pool = mariadb.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  acquireTimeout: 10000,
  connectTimeout: 10000,
  // Valores monetarios DECIMAL(10,2) chegam como Number em vez de string,
  // e IDs BIGINT/insertId como Number, para simplificar a camada de negocio.
  decimalAsNumber: true,
  bigIntAsNumber: true,
  insertIdAsNumber: true,
  timezone: 'auto',
  allowPublicKeyRetrieval: true
});

pool.on('error', (err) => {
  console.error('[db] erro no pool:', err.message);
});

/**
 * Executa uma query com parametros posicionais (?). Nunca concatenar SQL.
 */
async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function queryOne(sql, params = []) {
  const rows = await pool.query(sql, params);
  return rows && rows.length ? rows[0] : null;
}

/**
 * Executa `fn(conn)` dentro de uma transacao, com commit/rollback automatico.
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[db] falha no rollback:', rollbackErr.message);
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Testa a ligacao sem rebentar o arranque da aplicacao.
 * A app deve arrancar mesmo sem MariaDB disponivel (apenas avisa).
 */
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('SELECT 1');
    console.log(`[db] ligado a ${env.db.host}:${env.db.port}/${env.db.database}`);
    return true;
  } catch (err) {
    console.warn('[db] AVISO: nao foi possivel ligar a MariaDB ->', err.message);
    console.warn('[db] A aplicacao arranca na mesma. Ver README (seccao Setup da base de dados).');
    return false;
  } finally {
    if (conn) conn.release();
  }
}

async function close() {
  try {
    await pool.end();
  } catch (err) {
    console.error('[db] erro ao fechar pool:', err.message);
  }
}

module.exports = { pool, query, queryOne, transaction, testConnection, close };
