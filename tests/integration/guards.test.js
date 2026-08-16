'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

let app;

before(() => {
  // Nenhum handler de BD e necessario: estas rotas nao chegam a tocar a BD
  // porque os guards de autenticacao bloqueiam antes de qualquer query.
  ({ app } = loadAppWithFakeDb([]));
});

describe('Rotas operacionais', () => {
  test('GET /health responde 200 mesmo sem qualquer autenticacao ou BD', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.estado, 'ok');
  });

  test('GET numa rota inexistente responde 404', async () => {
    const res = await request(app).get('/esta-rota-nao-existe');
    assert.equal(res.status, 404);
  });

  test('GET numa rota /api/ inexistente responde 404 em JSON', async () => {
    const res = await request(app).get('/api/isto-nao-existe');
    assert.equal(res.status, 404);
    assert.equal(res.body.erro, 'Rota nao encontrada');
  });
});

describe('Guards de autenticacao — paginas HTML', () => {
  test('Dado um pedido sem sessao a /gim, redireciona (302) para /login', async () => {
    const res = await request(app).get('/gim');
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });

  test('Dado um pedido sem sessao a /caixa, redireciona (302) para /login', async () => {
    const res = await request(app).get('/caixa');
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });

  test('Dado um pedido sem sessao a /admin, redireciona (302) para /login', async () => {
    const res = await request(app).get('/admin');
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });
});

describe('Guards de autenticacao — rotas /api/*', () => {
  test('Dado um pedido sem sessao a /api/gim/artigos, responde 401 em JSON (sem redirecionar)', async () => {
    const res = await request(app).get('/api/gim/artigos');
    assert.equal(res.status, 401);
    assert.equal(res.body.erro, 'Nao autenticado');
  });

  test('Dado um pedido sem sessao a POST /api/consumos, responde 401 em JSON', async () => {
    const res = await request(app)
      .post('/api/consumos')
      .send({ itens: [{ artigo_id: 1, quantidade: 1 }], metodo_pagamento: 'dinheiro' });
    assert.equal(res.status, 401);
    assert.equal(res.body.erro, 'Nao autenticado');
  });
});
