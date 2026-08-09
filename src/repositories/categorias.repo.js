'use strict';

const { run } = require('./base');

async function listar({ apenasAtivas = false } = {}, conn) {
  const sql = `SELECT id, nome, cor, ordem, ativo
               FROM categorias
               ${apenasAtivas ? 'WHERE ativo = 1' : ''}
               ORDER BY ordem ASC, nome ASC`;
  return run(conn).query(sql);
}

async function porId(id, conn) {
  const rows = await run(conn).query('SELECT * FROM categorias WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function criar({ nome, cor, ordem, ativo }, conn) {
  const res = await run(conn).query(
    'INSERT INTO categorias (nome, cor, ordem, ativo) VALUES (?, ?, ?, ?)',
    [nome, cor, ordem, ativo ? 1 : 0]
  );
  return res.insertId;
}

async function atualizar(id, { nome, cor, ordem, ativo }, conn) {
  await run(conn).query(
    'UPDATE categorias SET nome = ?, cor = ?, ordem = ?, ativo = ? WHERE id = ?',
    [nome, cor, ordem, ativo ? 1 : 0, id]
  );
}

async function remover(id, conn) {
  await run(conn).query('DELETE FROM categorias WHERE id = ?', [id]);
}

async function contarArtigos(id, conn) {
  const rows = await run(conn).query('SELECT COUNT(*) AS total FROM artigos WHERE categoria_id = ?', [id]);
  return Number(rows[0].total);
}

module.exports = { listar, porId, criar, atualizar, remover, contarArtigos };
