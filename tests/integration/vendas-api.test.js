'use strict';

const { test, describe, before } = require('node:test');
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

// Preco "oficial" do artigo, tal como esta na BD — o cliente NUNCA o pode alterar.
const ARTIGO_TESTE = { id: 1, nome: 'Imperial', preco: 1.5, ativo: 1 };

function handlersVendasApi() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => (username === UTILIZADOR_TESTE.username ? [UTILIZADOR_TESTE] : [])
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },
    {
      pattern: /FROM artigos[\s\S]*WHERE a\.id = \?/i,
      handler: ([id]) => (Number(id) === ARTIGO_TESTE.id ? [ARTIGO_TESTE] : [])
    },
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [] },
    { pattern: /COALESCE\(MAX\(numero\), 0\)/i, handler: () => [{ proximo: 1 }] },
    { pattern: /INSERT INTO vendas/i, handler: () => ({ insertId: 500 }) },
    { pattern: /INSERT INTO venda_itens/i, handler: () => ({ insertId: 1 }) },
    { pattern: /INSERT INTO stocks/i, handler: () => ({}) },
    {
      pattern: /FROM stocks WHERE artigo_id = \? FOR UPDATE/i,
      handler: ([artigoId]) => [{ id: 1, artigo_id: Number(artigoId), quantidade: 50, stock_minimo: 5, unidade: 'un' }]
    },
    { pattern: /UPDATE stocks SET quantidade/i, handler: () => ({}) },
    { pattern: /INSERT INTO movimentos_stock/i, handler: () => ({ insertId: 1 }) }
  ];
}

describe('POST /api/vendas — validacao de payload', () => {
  let agent;

  before(async () => {
    const { app } = loadAppWithFakeDb(handlersVendasApi());
    agent = request.agent(app);
    // Autentica uma vez; o agent mantem o cookie de sessao entre pedidos.
    await agent
      .post('/login')
      .type('form')
      .send({ username: UTILIZADOR_TESTE.username, password: 'password-correta-123' });
  });

  test('Dado um carrinho vazio, responde 422 com erro estruturado', async () => {
    const res = await agent.post('/api/vendas').send({ itens: [], metodo_pagamento: 'dinheiro' });

    assert.equal(res.status, 422);
    assert.equal(res.body.erro, 'Dados invalidos');
    assert.ok(Array.isArray(res.body.erros) && res.body.erros.length > 0);
  });

  test('Dada uma quantidade <= 0, responde 422 com erro estruturado', async () => {
    const res = await agent
      .post('/api/vendas')
      .send({ itens: [{ artigo_id: 1, quantidade: 0 }], metodo_pagamento: 'dinheiro' });

    assert.equal(res.status, 422);
    assert.ok(res.body.erros.some((e) => /[Qq]uantidade/.test(e.mensagem) || /quantidade/i.test(e.campo)));
  });

  test('Dada uma quantidade negativa, responde 422 com erro estruturado', async () => {
    const res = await agent
      .post('/api/vendas')
      .send({ itens: [{ artigo_id: 1, quantidade: -5 }], metodo_pagamento: 'dinheiro' });

    assert.equal(res.status, 422);
  });

  test('Dado um artigo_id invalido (nao numerico), responde 422 com erro estruturado', async () => {
    const res = await agent
      .post('/api/vendas')
      .send({ itens: [{ artigo_id: 'abc', quantidade: 1 }], metodo_pagamento: 'dinheiro' });

    assert.equal(res.status, 422);
  });

  test('Dado um metodo de pagamento invalido, responde 422 com erro estruturado', async () => {
    const res = await agent
      .post('/api/vendas')
      .send({ itens: [{ artigo_id: 1, quantidade: 1 }], metodo_pagamento: 'bitcoin' });

    assert.equal(res.status, 422);
  });


  test('Dado um valor_dinheiro negativo, responde 422 com erro estruturado', async () => {
    const res = await agent.post('/api/vendas').send({
      itens: [{ artigo_id: 1, quantidade: 1 }],
      metodo_pagamento: 'dinheiro',
      valor_dinheiro: -1
    });

    assert.equal(res.status, 422);
  });

  test('Dado um artigo inexistente na BD, responde 404 (regra de negocio, apos passar a validacao de forma)', async () => {
    const res = await agent
      .post('/api/vendas')
      .send({ itens: [{ artigo_id: 999999, quantidade: 1 }], metodo_pagamento: 'dinheiro' });

    assert.equal(res.status, 404);
  });
});

describe('POST /api/vendas — movimento interno (sem metodo_pagamento)', () => {
  let agent;
  let insercoes;

  before(async () => {
    insercoes = [];
    const handlers = handlersVendasApi().map((h) =>
      /INSERT INTO vendas/i.test(h.pattern.source)
        ? {
            pattern: h.pattern,
            handler: (params) => {
              insercoes.push(params);
              return { insertId: 500 };
            }
          }
        : h
    );

    const { app } = loadAppWithFakeDb(handlers);
    agent = request.agent(app);
    await agent
      .post('/login')
      .type('form')
      .send({ username: UTILIZADOR_TESTE.username, password: 'password-correta-123' });
  });

  test('Sem metodo_pagamento no payload, grava como interno com troco e valores a zero (201)', async () => {
    // Given: o ecra de movimentos internos ja nao envia metodo de pagamento
    // When
    const res = await agent.post('/api/vendas').send({
      itens: [{ artigo_id: ARTIGO_TESTE.id, quantidade: 2 }]
    });

    // Then: registado, com o total, mas sem dinheiro e sem troco
    assert.equal(res.status, 201);
    assert.equal(res.body.venda.total, 3); // 2 x 1.50
    assert.equal(res.body.venda.metodo_pagamento, 'interno');
    assert.equal(res.body.venda.valor_dinheiro, 0);
    assert.equal(res.body.venda.valor_multibanco, 0);
    assert.equal(res.body.venda.troco, 0);

    // E o que foi gravado na BD tem mesmo metodo 'interno' e zeros.
    // Ordem do INSERT: numero, total, metodo, dinheiro, multibanco, troco, ...
    const params = insercoes[insercoes.length - 1];
    assert.equal(params[2], 'interno');
    assert.equal(params[3], 0);
    assert.equal(params[4], 0);
    assert.equal(params[5], 0);
  });

  test('Com metodo_pagamento = interno explicito, o comportamento e o mesmo', async () => {
    const res = await agent.post('/api/vendas').send({
      itens: [{ artigo_id: ARTIGO_TESTE.id, quantidade: 1 }],
      metodo_pagamento: 'interno'
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.venda.metodo_pagamento, 'interno');
    assert.equal(res.body.venda.troco, 0);
  });

  test('Valores de dinheiro enviados por engano num movimento interno sao ignorados', async () => {
    const res = await agent.post('/api/vendas').send({
      itens: [{ artigo_id: ARTIGO_TESTE.id, quantidade: 1 }],
      valor_dinheiro: 50,
      valor_multibanco: 20
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.venda.valor_dinheiro, 0);
    assert.equal(res.body.venda.valor_multibanco, 0);
    assert.equal(res.body.venda.troco, 0);
  });
});

describe('POST /api/vendas — precos vem sempre da BD, nunca do cliente', () => {
  let agent;

  before(async () => {
    const { app } = loadAppWithFakeDb(handlersVendasApi());
    agent = request.agent(app);
    await agent
      .post('/login')
      .type('form')
      .send({ username: UTILIZADOR_TESTE.username, password: 'password-correta-123' });
  });

  test('Dado um preco adulterado enviado pelo cliente, a venda usa sempre o preco real da BD', async () => {
    // Given: o artigo custa 1.50€ na BD; o cliente tenta enviar um preco de 0.01€
    // (o campo nem sequer e lido pelo controller/servico, mas confirmamos que o total final e o correto)
    const payload = {
      itens: [{ artigo_id: ARTIGO_TESTE.id, quantidade: 2, preco: 0.01, preco_unit: 0.01 }],
      metodo_pagamento: 'dinheiro',
      valor_dinheiro: 3
    };

    // When
    const res = await agent.post('/api/vendas').send(payload);

    // Then: total = 2 x 1.50 (preco real da BD), nunca 2 x 0.01
    assert.equal(res.status, 201);
    assert.equal(res.body.venda.total, 3);
    assert.equal(res.body.venda.troco, 0);
  });
});
