'use strict';

const { run } = require('./base');

const INTERVALO = 'v.criado_em BETWEEN ? AND ?';
const limites = (de, ate) => [`${de} 00:00:00`, `${ate} 23:59:59`];

/**
 * Resumo do periodo. `total` e o consumo registado (base tambem usada no fecho
 * de caixa). `dinheiro` usa a MESMA definicao de caixa.repo.totaisVendas:
 * dinheiro fisico de VENDAS antigas, liquido de troco, sem os movimentos
 * internos — para nao existirem duas contas divergentes na aplicacao.
 */
async function resumoVendas(de, ate, conn) {
  const rows = await run(conn).query(
    `SELECT COUNT(*) AS n_vendas,
            COALESCE(SUM(v.total), 0) AS total,
            COALESCE(SUM(CASE WHEN v.metodo_pagamento <> 'interno'
                              THEN v.valor_dinheiro - v.troco ELSE 0 END), 0) AS dinheiro,
            COALESCE(SUM(CASE WHEN v.metodo_pagamento = 'interno'
                              THEN v.total ELSE 0 END), 0) AS interno,
            COALESCE(SUM(v.valor_multibanco), 0) AS multibanco,
            COALESCE(AVG(v.total), 0) AS ticket_medio
     FROM vendas v
     WHERE v.estado = 'concluida' AND ${INTERVALO}`,
    limites(de, ate)
  );
  const r = rows[0];
  return {
    n_vendas: Number(r.n_vendas),
    total: Number(r.total),
    dinheiro: Number(r.dinheiro),
    interno: Number(r.interno),
    multibanco: Number(r.multibanco),
    ticket_medio: Number(r.ticket_medio)
  };
}

async function vendasPorDia(de, ate, conn) {
  return run(conn).query(
    `SELECT DATE(v.criado_em) AS dia, COUNT(*) AS n_vendas, COALESCE(SUM(v.total), 0) AS total
     FROM vendas v
     WHERE v.estado = 'concluida' AND ${INTERVALO}
     GROUP BY DATE(v.criado_em)
     ORDER BY dia ASC`,
    limites(de, ate)
  );
}

async function topArtigos(de, ate, limite = 10, conn) {
  return run(conn).query(
    `SELECT vi.nome_snapshot AS nome,
            SUM(vi.quantidade) AS quantidade,
            SUM(vi.subtotal) AS total
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     WHERE v.estado = 'concluida' AND ${INTERVALO}
     GROUP BY vi.nome_snapshot
     ORDER BY quantidade DESC, total DESC
     LIMIT ?`,
    [...limites(de, ate), Number(limite)]
  );
}

async function vendasPorCategoria(de, ate, conn) {
  return run(conn).query(
    `SELECT COALESCE(c.nome, 'Sem categoria') AS categoria,
            SUM(vi.quantidade) AS quantidade,
            SUM(vi.subtotal) AS total
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     LEFT JOIN artigos a ON a.id = vi.artigo_id
     LEFT JOIN categorias c ON c.id = a.categoria_id
     WHERE v.estado = 'concluida' AND ${INTERVALO}
     GROUP BY categoria
     ORDER BY total DESC`,
    limites(de, ate)
  );
}

module.exports = { resumoVendas, vendasPorDia, topArtigos, vendasPorCategoria };
