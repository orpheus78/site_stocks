'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const UTILIZADOR_TESTE = {
  id: 1,
  nome: 'Utilizador Teste',
  username: 'utilizador.teste',
  password_hash: bcrypt.hashSync('password-correta-123', 4), // rounds baixos: testes rapidos
  pin_hash: null,
  role: 'admin',
  ativo: 1
};

function handlersAuth() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) =>
        username === UTILIZADOR_TESTE.username ? [UTILIZADOR_TESTE] : []
    },
    {
      pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i,
      handler: () => []
    }
  ];
}

describe('POST /login', () => {
  let app;

  before(() => {
    ({ app } = loadAppWithFakeDb(handlersAuth()));
  });

  test('Dadas credenciais invalidas (username inexistente), nao autentica e devolve mensagem generica', async () => {
    // Given / When
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'nao.existe', password: 'qualquer-coisa' });

    // Then: 401, sem indicar se o username existe ou nao (mensagem generica)
    assert.equal(res.status, 401);
    assert.match(res.text, /Utilizador ou password invalidos/);
    assert.doesNotMatch(res.text, /nao existe/i);
  });

  test('Dado um username valido mas password errada, nao autentica com a mesma mensagem generica', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: UTILIZADOR_TESTE.username, password: 'password-errada' });

    assert.equal(res.status, 401);
    assert.match(res.text, /Utilizador ou password invalidos/);
  });

  test('Dadas credenciais corretas, autentica e redireciona para a area do perfil (admin -> /admin)', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: UTILIZADOR_TESTE.username, password: 'password-correta-123' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin');
    assert.ok(res.headers['set-cookie'], 'deve criar cookie de sessao apos login valido');
  });

  test('Dado um campo "next" que aponta para fora do site, ignora-o e redireciona para a area do perfil (evita open redirect)', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({
        username: UTILIZADOR_TESTE.username,
        password: 'password-correta-123',
        next: 'https://site-malicioso.exemplo/roubo'
      });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin');
  });

  test('Dado um pedido sem username, e rejeitado pela validacao antes de tocar na BD', async () => {
    const res = await request(app).post('/login').type('form').send({ password: 'x' });
    assert.equal(res.status, 302); // validate.js faz redirect com flash para pedidos nao-API
  });
});
