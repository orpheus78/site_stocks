'use strict';

const { run } = require('./base');

const SELECT_BASE = `
  SELECT s.id, s.artigo_id, s.quantidade, s.stock_minimo, s.unidade, s.atualizado_em,
         a.nome AS artigo_nome, a.ativo AS artigo_ativo, a.preco,
         c.nome AS categoria_nome, c.cor AS categoria_cor
  FROM stocks s
  JOIN artigos a ON a.id = s.artigo_id
  LEFT JOIN categorias c ON c.id = a.categoria_id
`;

async function listar({ apenasBaixo = false, termo = null } = {}, conn) {
  const where = [];
  const params = [];
  if (apenasBaixo) where.push('s.quantidade <= s.stock_minimo');
  if (termo) {
    where.push('a.nome LIKE ?');
    params.push(`%${termo}%`);
  }
  const sql = `${SELECT_BASE}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (s.quantidade <= s.stock_minimo) DESC, a.nome ASC`;
  return run(conn).query(sql, params);
}

async function porArtigo(artigoId, conn) {
  const rows = await run(conn).query(`${SELECT_BASE} WHERE s.artigo_id = ? LIMIT 1`, [artigoId]);
  return rows[0] || null;
}

/** Bloqueia a linha de stock para leitura/escrita consistente dentro de transacao. */
async function porArtigoParaAtualizar(artigoId, conn) {
  const rows = await conn.query(
    'SELECT id, artigo_id, quantidade, stock_minimo, unidade FROM stocks WHERE artigo_id = ? FOR UPDATE',
    [artigoId]
  );
  return rows[0] || null;
}

async function garantirLinha(artigoId, { unidade = 'un', stock_minimo = 0 } = {}, conn) {
  await run(conn).query(
    `INSERT INTO stocks (artigo_id, quantidade, stock_minimo, unidade)
     VALUES (?, 0, ?, ?)
     ON DUPLICATE KEY UPDATE artigo_id = VALUES(artigo_id)`,
    [artigoId, stock_minimo, unidade]
  );
}

async function definirQuantidade(artigoId, quantidade, conn) {
  await run(conn).query('UPDATE stocks SET quantidade = ? WHERE artigo_id = ?', [quantidade, artigoId]);
}

async function atualizarParametros(artigoId, { stock_minimo, unidade }, conn) {
  await run(conn).query('UPDATE stocks SET stock_minimo = ?, unidade = ? WHERE artigo_id = ?', [
    stock_minimo,
    unidade,
    artigoId
  ]);
}

async function alertasStockBaixo(conn) {
  return run(conn).query(`${SELECT_BASE}
    WHERE a.ativo = 1 AND s.quantidade <= s.stock_minimo
    ORDER BY (s.quantidade - s.stock_minimo) ASC, a.nome ASC`);
}

module.exports = {
  listar,
  porArtigo,
  porArtigoParaAtualizar,
  garantirLinha,
  definirQuantidade,
  atualizarParametros,
  alertasStockBaixo
};
