'use strict';

/**
 * POST /api/consumos — snapshot do CUSTO unitario.
 *
 * O `custo_unit` segue exatamente a regra do `preco_unit`:
 *   - e lido da BD (artigos.preco_custo), nunca do que o cliente envia;
 *   - fica CONGELADO na linha do consumo, para que alterar amanha o preco de
 *     compra do artigo nao reescreva a margem dos consumos ja registados.
 *
 * Sem MariaDB: a BD e substituida pelo fake de tests/helpers/fakeDb.js.
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const UTILIZADOR_TESTE = {
  id: 1,
  nome: 'Operador Teste',
  username: 'operador.teste',
  password_hash: bcrypt.hashSync('password-correta-123', 4),
  pin_hash: null,
  role: 'funcionario',
  ativo: 1
};

// Preco e custo "oficiais" do artigo. Mutavel: um dos testes simula a
// alteracao do custo DEPOIS do consumo ja estar registado.
const ARTIGO = { id: 1, nome: 'Imperial', preco: 1.5, preco_custo: 0.4, ativo: 1 };

// Linhas gravadas em consumo_itens, pela ordem do INSERT.
let itensGravados = [];

/** Parametros do INSERT INTO consumo_itens, com nome. */
function linha(params) {
  return {
    consumo_id: params[0],
    artigo_id: params[1],
    nome_snapshot: params[2],
    preco_unit: params[3],
    custo_unit: params[4],
    quantidade: params[5],
    subtotal: params[6]
  };
}

function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => (username === UTILIZADOR_TESTE.username ? [UTILIZADOR_TESTE] : [])
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },
    {
      pattern: /FROM artigos[\s\S]*WHERE a\.id = \?/i,
      handler: ([id]) => (Number(id) === ARTIGO.id ? [{ ...ARTIGO }] : [])
    },
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [] },
    { pattern: /COALESCE\(MAX\(numero\), 0\)/i, handler: () => [{ proximo: 1 }] },
    { pattern: /INSERT INTO consumos/i, handler: () => ({ insertId: 500 }) },
    {
      pattern: /INSERT INTO consumo_itens/i,
      handler: (params) => {
        itensGravados.push(linha(params));
        return { insertId: itensGravados.length };
      }
    },
    { pattern: /INSERT INTO stocks/i, handler: () => ({}) },
    {
      pattern: /FROM stocks WHERE artigo_id = \? FOR UPDATE/i,
      handler: ([artigoId]) => [
        { id: 1, artigo_id: Number(artigoId), quantidade: 50, stock_minimo: 5, unidade: 'un' }
      ]
    },
    { pattern: /UPDATE stocks SET quantidade/i, handler: () => ({}) },
    { pattern: /INSERT INTO movimentos_stock/i, handler: () => ({ insertId: 1 }) }
  ];
}

let agente;

before(async () => {
  const { app } = loadAppWithFakeDb(handlers());
  agente = request.agent(app);
  await agente
    .post('/login')
    .type('form')
    .send({ username: UTILIZADOR_TESTE.username, password: 'password-correta-123' });
});

beforeEach(() => {
  itensGravados = [];
  ARTIGO.preco_custo = 0.4;
});

describe('POST /api/consumos — o custo vem da BD, nunca do cliente', () => {
  test('Dado um consumo normal, grava o custo unitario do artigo', async () => {
    // Given: o artigo custa 0.40 a comprar e vende-se a 1.50
    // When
    const res = await agente.post('/api/consumos').send({
      itens: [{ artigo_id: ARTIGO.id, quantidade: 2 }]
    });

    // Then
    assert.equal(res.status, 201);
    assert.equal(itensGravados.length, 1);
    assert.equal(itensGravados[0].preco_unit, 1.5);
    assert.equal(itensGravados[0].custo_unit, 0.4);
    assert.equal(itensGravados[0].subtotal, 3);
  });

  test('Dado um custo_unit adulterado no payload, e IGNORADO (vale o da BD)', async () => {
    // Given: o cliente tenta enviar um custo de 0.01 (margem inflacionada)
    // When
    const res = await agente.post('/api/consumos').send({
      itens: [{ artigo_id: ARTIGO.id, quantidade: 1, custo_unit: 0.01, preco_custo: 0.01, custo: 0.01 }]
    });

    // Then
    assert.equal(res.status, 201);
    assert.equal(itensGravados[0].custo_unit, 0.4, 'o custo gravado tem de ser o da BD');
  });

  test('Dado um custo inflacionado no payload, tambem e ignorado', async () => {
    const res = await agente.post('/api/consumos').send({
      itens: [{ artigo_id: ARTIGO.id, quantidade: 1, custo_unit: 999 }]
    });

    assert.equal(res.status, 201);
    assert.equal(itensGravados[0].custo_unit, 0.4);
  });

  test('Dado um artigo sem preco_custo na BD, grava 0 (nunca NULL nem NaN)', async () => {
    // Given: artigo antigo, com o custo ainda por preencher
    delete ARTIGO.preco_custo;

    const res = await agente.post('/api/consumos').send({
      itens: [{ artigo_id: ARTIGO.id, quantidade: 1 }]
    });

    assert.equal(res.status, 201);
    assert.equal(itensGravados[0].custo_unit, 0);
    assert.ok(!Number.isNaN(itensGravados[0].custo_unit));

    ARTIGO.preco_custo = 0.4;
  });
});

describe('POST /api/consumos — o custo gravado nao muda com o artigo', () => {
  test('Alterar o preco_custo do artigo nao altera o custo ja gravado no consumo', async () => {
    // Given: um consumo registado com o custo de 0.40
    await agente.post('/api/consumos').send({ itens: [{ artigo_id: ARTIGO.id, quantidade: 1 }] });
    const antes = { ...itensGravados[0] };
    assert.equal(antes.custo_unit, 0.4);

    // When: o fornecedor sobe o preco e o custo do artigo passa a 0.90
    ARTIGO.preco_custo = 0.9;
    await agente.post('/api/consumos').send({ itens: [{ artigo_id: ARTIGO.id, quantidade: 1 }] });

    // Then: o consumo antigo mantem o custo antigo; so o NOVO usa o novo custo
    assert.equal(itensGravados[0].custo_unit, 0.4, 'o historico nao pode ser reescrito');
    assert.equal(itensGravados[1].custo_unit, 0.9);
    assert.deepEqual(itensGravados[0], antes);
  });
});
