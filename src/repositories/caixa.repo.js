'use strict';

const { run } = require('./base');

async function sessaoAberta(conn) {
  const rows = await run(conn).query(
    `SELECT s.*, u.nome AS utilizador_nome
     FROM sessoes_caixa s
     JOIN utilizadores u ON u.id = s.utilizador_id
     WHERE s.estado = 'aberta'
     ORDER BY s.aberta_em DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function porId(id, conn) {
  const rows = await run(conn).query(
    `SELECT s.*, u.nome AS utilizador_nome
     FROM sessoes_caixa s
     JOIN utilizadores u ON u.id = s.utilizador_id
     WHERE s.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function abrir({ utilizador_id, fundo_inicial }, conn) {
  const res = await run(conn).query(
    "INSERT INTO sessoes_caixa (utilizador_id, fundo_inicial, estado) VALUES (?, ?, 'aberta')",
    [utilizador_id, fundo_inicial]
  );
  return res.insertId;
}

async function fechar(id, { total_contado, diferenca }, conn) {
  await run(conn).query(
    `UPDATE sessoes_caixa
     SET estado = 'fechada', fechada_em = NOW(), total_contado = ?, diferenca = ?
     WHERE id = ? AND estado = 'aberta'`,
    [total_contado, diferenca, id]
  );
}

async function registarMovimento({ sessao_caixa_id, tipo, valor, descricao }, conn) {
  const res = await run(conn).query(
    'INSERT INTO movimentos_caixa (sessao_caixa_id, tipo, valor, descricao) VALUES (?, ?, ?, ?)',
    [sessao_caixa_id, tipo, valor, descricao || '']
  );
  return res.insertId;
}

async function movimentosDaSessao(sessaoId, conn) {
  return run(conn).query(
    'SELECT * FROM movimentos_caixa WHERE sessao_caixa_id = ? ORDER BY criado_em ASC, id ASC',
    [sessaoId]
  );
}

/**
 * Totais de consumos/movimentos concluidos associados a uma sessao, por metodo.
 *
 * `dinheiro`   -> dinheiro fisico recebido em VENDAS antigas, liquido de troco.
 *                 So metodos historicos ('dinheiro', 'multibanco', 'misto');
 *                 os movimentos internos ficam explicitamente de fora para a
 *                 intencao nao depender de eles terem valor_dinheiro = 0.
 * `interno`    -> total dos MOVIMENTOS INTERNOS. Conta como dinheiro esperado
 *                 em caixa (regra de negocio confirmada pelo cliente).
 * `multibanco` -> nunca entra no dinheiro fisico esperado.
 *
 * Apenas registos com estado = 'concluida': anulados nao contam.
 */
async function totaisConsumos(sessaoId, conn) {
  const rows = await run(conn).query(
    `SELECT COUNT(*) AS n_consumos,
            COALESCE(SUM(total), 0) AS total,
            COALESCE(SUM(CASE WHEN metodo_pagamento <> 'interno'
                              THEN valor_dinheiro - troco ELSE 0 END), 0) AS dinheiro,
            COALESCE(SUM(CASE WHEN metodo_pagamento = 'interno'
                              THEN total ELSE 0 END), 0) AS interno,
            COALESCE(SUM(valor_multibanco), 0) AS multibanco
     FROM consumos
     WHERE sessao_caixa_id = ? AND estado = 'concluida'`,
    [sessaoId]
  );
  const r = rows[0];
  return {
    n_consumos: Number(r.n_consumos),
    total: Number(r.total),
    dinheiro: Number(r.dinheiro),
    interno: Number(r.interno),
    multibanco: Number(r.multibanco)
  };
}

/**
 * Movimentos concluidos que ficaram SEM sessao de caixa (registados com a
 * caixa fechada). Como os movimentos internos passaram a contar como dinheiro
 * esperado, estes ficam fora de qualquer fecho: e preciso sinaliza-los ao
 * responsavel em vez de os deixar desaparecer das contas.
 */
async function totaisSemSessao(conn) {
  const rows = await run(conn).query(
    `SELECT COUNT(*) AS n_consumos,
            COALESCE(SUM(total), 0) AS total
     FROM consumos
     WHERE sessao_caixa_id IS NULL AND estado = 'concluida'`
  );
  const r = rows[0];
  return { n_consumos: Number(r.n_consumos), total: Number(r.total) };
}

async function historico(limite = 50, conn) {
  return run(conn).query(
    `SELECT s.*, u.nome AS utilizador_nome
     FROM sessoes_caixa s
     JOIN utilizadores u ON u.id = s.utilizador_id
     ORDER BY s.aberta_em DESC
     LIMIT ?`,
    [Number(limite)]
  );
}

/**
 * Le uma sessao de caixa BLOQUEANDO a linha (FOR UPDATE), para decidir se
 * ainda esta aberta sem deixar janela de corrida.
 *
 * Usado pela anulacao feita pelo proprio operador: entre "verifiquei que a
 * caixa esta aberta" e "gravei a anulacao" nao pode caber um fecho de caixa.
 * Com o bloqueio, um `UPDATE sessoes_caixa SET estado='fechada'` concorrente
 * fica a espera do commit desta transacao (mesmo padrao do FOR UPDATE usado
 * na numeracao dos consumos).
 *
 * Exige `conn` de proposito: fora de uma transacao o bloqueio nao teria efeito.
 */
async function porIdParaAtualizar(id, conn) {
  const rows = await conn.query('SELECT id, estado FROM sessoes_caixa WHERE id = ? FOR UPDATE', [id]);
  return rows[0] || null;
}

module.exports = {
  sessaoAberta,
  porId,
  porIdParaAtualizar,
  abrir,
  fechar,
  registarMovimento,
  movimentosDaSessao,
  totaisConsumos,
  totaisSemSessao,
  historico
};
