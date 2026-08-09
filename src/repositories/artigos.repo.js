'use strict';

const { run } = require('./base');

const SELECT_BASE = `
  SELECT a.id, a.categoria_id, a.nome, a.preco, a.imagem, a.ativo, a.ordem, a.criado_em,
         c.nome AS categoria_nome, c.cor AS categoria_cor,
         s.quantidade, s.stock_minimo, s.unidade
  FROM artigos a
  LEFT JOIN categorias c ON c.id = a.categoria_id
  LEFT JOIN stocks s ON s.artigo_id = a.id
`;

async function listar({ apenasAtivos = false, categoriaId = null } = {}, conn) {
  const where = [];
  const params = [];
  if (apenasAtivos) where.push('a.ativo = 1');
  if (categoriaId) {
    where.push('a.categoria_id = ?');
    params.push(categoriaId);
  }
  const sql = `${SELECT_BASE}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY c.ordem ASC, a.ordem ASC, a.nome ASC`;
  return run(conn).query(sql, params);
}

async function porId(id, conn) {
  const rows = await run(conn).query(`${SELECT_BASE} WHERE a.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function criar({ categoria_id, nome, preco, imagem, ativo, ordem }, conn) {
  const res = await run(conn).query(
    'INSERT INTO artigos (categoria_id, nome, preco, imagem, ativo, ordem) VALUES (?, ?, ?, ?, ?, ?)',
    [categoria_id || null, nome, preco, imagem || null, ativo ? 1 : 0, ordem]
  );
  return res.insertId;
}

async function atualizar(id, { categoria_id, nome, preco, imagem, ativo, ordem }, conn) {
  await run(conn).query(
    `UPDATE artigos
     SET categoria_id = ?, nome = ?, preco = ?, imagem = ?, ativo = ?, ordem = ?
     WHERE id = ?`,
    [categoria_id || null, nome, preco, imagem || null, ativo ? 1 : 0, ordem, id]
  );
}

async function remover(id, conn) {
  await run(conn).query('DELETE FROM artigos WHERE id = ?', [id]);
}

async function desativar(id, conn) {
  await run(conn).query('UPDATE artigos SET ativo = 0 WHERE id = ?', [id]);
}

async function temVendas(id, conn) {
  const rows = await run(conn).query('SELECT COUNT(*) AS total FROM venda_itens WHERE artigo_id = ?', [id]);
  return Number(rows[0].total) > 0;
}

module.exports = { listar, porId, criar, atualizar, remover, desativar, temVendas };
