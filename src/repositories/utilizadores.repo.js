'use strict';

const { run } = require('./base');

const CAMPOS = 'id, nome, username, password_hash, pin_hash, role, ativo, criado_em';

async function porUsername(username, conn) {
  const rows = await run(conn).query(
    `SELECT ${CAMPOS} FROM utilizadores WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function porId(id, conn) {
  const rows = await run(conn).query(`SELECT ${CAMPOS} FROM utilizadores WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/** Utilizadores ativos com PIN definido (para login rapido no POS). */
async function ativosComPin(conn) {
  return run(conn).query(
    `SELECT ${CAMPOS} FROM utilizadores WHERE ativo = 1 AND pin_hash IS NOT NULL ORDER BY nome`
  );
}

async function listar(conn) {
  return run(conn).query(
    'SELECT id, nome, username, role, ativo, criado_em FROM utilizadores ORDER BY nome'
  );
}

module.exports = { porUsername, porId, ativosComPin, listar };
