'use strict';

const { run } = require('./base');

const INTERVALO = 'v.criado_em BETWEEN ? AND ?';
const limites = (de, ate) => [`${de} 00:00:00`, `${ate} 23:59:59`];

/**
 * Resumo do periodo. `total` e o consumo registado (base tambem usada no fecho
 * de caixa). `dinheiro` usa a MESMA definicao de caixa.repo.totaisConsumos:
 * dinheiro fisico de VENDAS antigas, liquido de troco, sem os movimentos
 * internos — para nao existirem duas contas divergentes na aplicacao.
 */
async function resumoConsumos(de, ate, conn) {
  const rows = await run(conn).query(
    `SELECT COUNT(*) AS n_consumos,
            COALESCE(SUM(v.total), 0) AS total,
            COALESCE(SUM(CASE WHEN v.metodo_pagamento <> 'interno'
                              THEN v.valor_dinheiro - v.troco ELSE 0 END), 0) AS dinheiro,
            COALESCE(SUM(CASE WHEN v.metodo_pagamento = 'interno'
                              THEN v.total ELSE 0 END), 0) AS interno,
            COALESCE(SUM(v.valor_multibanco), 0) AS multibanco,
            COALESCE(AVG(v.total), 0) AS ticket_medio
     FROM consumos v
     WHERE v.estado = 'concluida' AND ${INTERVALO}`,
    limites(de, ate)
  );
  const r = rows[0];
  return {
    n_consumos: Number(r.n_consumos),
    total: Number(r.total),
    dinheiro: Number(r.dinheiro),
    interno: Number(r.interno),
    multibanco: Number(r.multibanco),
    ticket_medio: Number(r.ticket_medio)
  };
}

async function consumosPorDia(de, ate, conn) {
  return run(conn).query(
    `SELECT DATE(v.criado_em) AS dia, COUNT(*) AS n_consumos, COALESCE(SUM(v.total), 0) AS total
     FROM consumos v
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
     FROM consumo_itens vi
     JOIN consumos v ON v.id = vi.consumo_id
     WHERE v.estado = 'concluida' AND ${INTERVALO}
     GROUP BY vi.nome_snapshot
     ORDER BY quantidade DESC, total DESC
     LIMIT ?`,
    [...limites(de, ate), Number(limite)]
  );
}

async function consumosPorCategoria(de, ate, conn) {
  return run(conn).query(
    `SELECT COALESCE(c.nome, 'Sem categoria') AS categoria,
            SUM(vi.quantidade) AS quantidade,
            SUM(vi.subtotal) AS total,
            SUM(vi.custo_unit * vi.quantidade) AS custo
     FROM consumo_itens vi
     JOIN consumos v ON v.id = vi.consumo_id
     LEFT JOIN artigos a ON a.id = vi.artigo_id
     LEFT JOIN categorias c ON c.id = a.categoria_id
     WHERE v.estado = 'concluida' AND ${INTERVALO}
     GROUP BY categoria
     ORDER BY total DESC`,
    limites(de, ate)
  );
}

/**
 * Custo total dos artigos consumidos no periodo, a partir do SNAPSHOT
 * `custo_unit` gravado em cada linha — nunca do `artigos.preco_custo` atual.
 * E essa a diferenca entre saber a margem que se teve e inventar a margem
 * que se teria com os precos de compra de hoje.
 *
 * `venda` vem dos mesmos itens e serve de controlo: deve bater certo com o
 * `total` de resumoConsumos (que soma os cabecalhos).
 */
async function custoConsumos(de, ate, conn) {
  const rows = await run(conn).query(
    `SELECT COALESCE(SUM(vi.custo_unit * vi.quantidade), 0) AS custo,
            COALESCE(SUM(vi.subtotal), 0) AS venda
     FROM consumo_itens vi
     JOIN consumos v ON v.id = vi.consumo_id
     WHERE v.estado = 'concluida' AND ${INTERVALO}`,
    limites(de, ate)
  );
  const r = rows[0] || {};
  return { custo: Number(r.custo || 0), venda: Number(r.venda || 0) };
}

/**
 * Venda, custo e quantidade por artigo (pelo nome em snapshot, tal como o
 * topArtigos). Sem LIMIT: num bar pequeno sao poucas dezenas de linhas e as
 * de margem NEGATIVA — as que interessam — nunca podem ficar de fora por
 * ficarem no fim da ordenacao.
 */
async function margemPorArtigo(de, ate, conn) {
  return run(conn).query(
    `SELECT vi.nome_snapshot AS nome,
            SUM(vi.quantidade) AS quantidade,
            SUM(vi.subtotal) AS total,
            SUM(vi.custo_unit * vi.quantidade) AS custo
     FROM consumo_itens vi
     JOIN consumos v ON v.id = vi.consumo_id
     WHERE v.estado = 'concluida' AND ${INTERVALO}
     GROUP BY vi.nome_snapshot
     ORDER BY (SUM(vi.subtotal) - SUM(vi.custo_unit * vi.quantidade)) DESC, total DESC`,
    limites(de, ate)
  );
}

module.exports = {
  resumoConsumos,
  consumosPorDia,
  topArtigos,
  consumosPorCategoria,
  custoConsumos,
  margemPorArtigo
};
