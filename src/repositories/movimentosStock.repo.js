'use strict';

const { run } = require('./base');

async function registar({ artigo_id, tipo, quantidade, quantidade_apos, motivo, utilizador_id }, conn) {
  const res = await run(conn).query(
    `INSERT INTO movimentos_stock
       (artigo_id, tipo, quantidade, quantidade_apos, motivo, utilizador_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [artigo_id, tipo, quantidade, quantidade_apos, motivo || null, utilizador_id || null]
  );
  return res.insertId;
}

async function listar({ artigoId, tipo, de, ate, limite = 300 } = {}, conn) {
  const where = [];
  const params = [];
  if (artigoId) {
    where.push('m.artigo_id = ?');
    params.push(artigoId);
  }
  if (tipo) {
    where.push('m.tipo = ?');
    params.push(tipo);
  }
  if (de) {
    where.push('m.criado_em >= ?');
    params.push(`${de} 00:00:00`);
  }
  if (ate) {
    where.push('m.criado_em <= ?');
    params.push(`${ate} 23:59:59`);
  }
  params.push(Number(limite));

  return run(conn).query(
    `SELECT m.*, a.nome AS artigo_nome, u.nome AS utilizador_nome
     FROM movimentos_stock m
     JOIN artigos a ON a.id = m.artigo_id
     LEFT JOIN utilizadores u ON u.id = m.utilizador_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.criado_em DESC, m.id DESC
     LIMIT ?`,
    params
  );
}

module.exports = { registar, listar };
