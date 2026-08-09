'use strict';

const { run } = require('./base');

/**
 * Proximo numero sequencial de venda.
 * Usa FOR UPDATE dentro da transacao para evitar numeros duplicados
 * quando ha varios postos a vender em simultaneo.
 */
async function proximoNumero(conn) {
  const rows = await conn.query('SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM vendas FOR UPDATE');
  return Number(rows[0].proximo);
}

async function criar(venda, conn) {
  const res = await run(conn).query(
    `INSERT INTO vendas
       (numero, total, metodo_pagamento, valor_dinheiro, valor_multibanco, troco, estado, utilizador_id, sessao_caixa_id)
     VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?)`,
    [
      venda.numero,
      venda.total,
      venda.metodo_pagamento,
      venda.valor_dinheiro,
      venda.valor_multibanco,
      venda.troco,
      venda.utilizador_id || null,
      venda.sessao_caixa_id || null
    ]
  );
  return res.insertId;
}

async function criarItem(item, conn) {
  await run(conn).query(
    `INSERT INTO venda_itens (venda_id, artigo_id, nome_snapshot, preco_unit, quantidade, subtotal)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [item.venda_id, item.artigo_id || null, item.nome_snapshot, item.preco_unit, item.quantidade, item.subtotal]
  );
}

async function porId(id, conn) {
  const rows = await run(conn).query(
    `SELECT v.*, u.nome AS utilizador_nome
     FROM vendas v
     LEFT JOIN utilizadores u ON u.id = v.utilizador_id
     WHERE v.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function itensDaVenda(vendaId, conn) {
  return run(conn).query(
    'SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY id ASC',
    [vendaId]
  );
}

async function listar({ de, ate, estado, metodo, limite = 200 } = {}, conn) {
  const where = [];
  const params = [];
  if (de) {
    where.push('v.criado_em >= ?');
    params.push(`${de} 00:00:00`);
  }
  if (ate) {
    where.push('v.criado_em <= ?');
    params.push(`${ate} 23:59:59`);
  }
  if (estado) {
    where.push('v.estado = ?');
    params.push(estado);
  }
  if (metodo) {
    where.push('v.metodo_pagamento = ?');
    params.push(metodo);
  }
  params.push(Number(limite));

  return run(conn).query(
    `SELECT v.*, u.nome AS utilizador_nome,
            (SELECT COUNT(*) FROM venda_itens vi WHERE vi.venda_id = v.id) AS n_itens
     FROM vendas v
     LEFT JOIN utilizadores u ON u.id = v.utilizador_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY v.criado_em DESC, v.id DESC
     LIMIT ?`,
    params
  );
}

async function anular(id, conn) {
  await run(conn).query("UPDATE vendas SET estado = 'anulada' WHERE id = ?", [id]);
}

/** Bloqueia a venda para garantir que a anulacao nao corre duas vezes. */
async function porIdParaAtualizar(id, conn) {
  const rows = await conn.query('SELECT * FROM vendas WHERE id = ? FOR UPDATE', [id]);
  return rows[0] || null;
}

module.exports = {
  proximoNumero,
  criar,
  criarItem,
  porId,
  porIdParaAtualizar,
  itensDaVenda,
  listar,
  anular
};
