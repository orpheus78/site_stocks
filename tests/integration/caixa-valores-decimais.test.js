'use strict';

/**
 * Caixa — contrato entre o formato do ECRA (virgula) e o SERVIDOR (ponto).
 *
 * O teclado da caixa mostra "," e o cliente converte para "." no submit
 * (public/js/valor-decimal.js). Estes testes fixam o outro lado do contrato:
 *   - o servidor grava corretamente o que o cliente envia ("20.50");
 *   - o servidor continua a recusar lixo, tal como o <input type="number">
 *     fazia antes — a validacao que conta e a do servidor.
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');
const VD = require('../../public/js/valor-decimal');

const PASSWORD = 'password-de-teste-123';
const HASH = bcrypt.hashSync(PASSWORD, 4);

const ADMIN = {
  id: 1,
  nome: 'Administrador',
  username: 'admin.teste',
  password_hash: HASH,
  pin_hash: null,
  role: 'admin',
  ativo: 1
};

// Estado mutavel do "banco de dados" falso, reposto a cada teste.
let sessaoAberta = null;
let inserida = null;
let fechada = null;

const SESSAO_ABERTA = {
  id: 7,
  utilizador_id: 1,
  utilizador_nome: 'Administrador',
  fundo_inicial: 20.5,
  estado: 'aberta',
  aberta_em: new Date(2026, 0, 1, 10, 0),
  fechada_em: null,
  total_contado: null,
  diferenca: null
};

function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => (username === ADMIN.username ? [ADMIN] : [])
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },

    { pattern: /INSERT INTO sessoes_caixa/i, handler: (params) => {
      inserida = { utilizador_id: params[0], fundo_inicial: params[1] };
      return { insertId: 99 };
    } },
    { pattern: /UPDATE sessoes_caixa/i, handler: (params) => {
      fechada = { total_contado: params[0], diferenca: params[1], id: params[2] };
      return { affectedRows: 1 };
    } },
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => (sessaoAberta ? [sessaoAberta] : []) },
    { pattern: /FROM sessoes_caixa/i, handler: () => [] },
    { pattern: /FROM movimentos_caixa/i, handler: () => [] },
    { pattern: /INSERT INTO movimentos_caixa/i, handler: () => ({ insertId: 1 }) },
    { pattern: /FROM vendas[\s\S]*sessao_caixa_id IS NULL/i, handler: () => [{ n_vendas: 0, total: 0 }] },
    {
      pattern: /COUNT\(\*\) AS n_vendas[\s\S]*FROM vendas/i,
      handler: () => [{ n_vendas: 0, total: 0, dinheiro: 0, interno: 0, multibanco: 0 }]
    }
  ];
}

let app;

async function sessaoDeAdmin() {
  const agente = request.agent(app);
  const res = await agente
    .post('/login')
    .type('form')
    .send({ username: ADMIN.username, password: PASSWORD });
  assert.equal(res.status, 302);
  return agente;
}

before(() => {
  ({ app } = loadAppWithFakeDb(handlers()));
});

beforeEach(() => {
  sessaoAberta = null;
  inserida = null;
  fechada = null;
});

describe('POST /caixa/abrir — valores decimais', () => {
  test('Dado fundo_inicial="20.50" (formato normalizado pelo cliente), grava 20.50', async () => {
    // Given
    const admin = await sessaoDeAdmin();

    // When
    const res = await admin.post('/caixa/abrir').type('form').send({ fundo_inicial: '20.50' });

    // Then
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/caixa');
    assert.equal(inserida.fundo_inicial, 20.5);
  });

  test('Dado o que o utilizador teclou ("20,50"), o valor normalizado chega como 20.50', async () => {
    // Given: o cliente converte o formato de ecra para o formato do servidor
    const admin = await sessaoDeAdmin();
    const enviado = VD.normalizarDecimal('20,50');
    assert.equal(enviado, '20.50');

    // When
    const res = await admin.post('/caixa/abrir').type('form').send({ fundo_inicial: enviado });

    // Then
    assert.equal(res.status, 302);
    assert.equal(inserida.fundo_inicial, 20.5);
  });

  test('Dado "abc", o servidor recusa e nao abre caixa nenhuma', async () => {
    const admin = await sessaoDeAdmin();

    const res = await admin.post('/caixa/abrir').type('form').send({ fundo_inicial: 'abc' });

    assert.equal(res.status, 302); // volta atras com flash de erro
    assert.equal(inserida, null, 'nao devia ter sido inserida nenhuma sessao');
  });

  test('Dado um valor negativo, o servidor recusa', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.post('/caixa/abrir').type('form').send({ fundo_inicial: '-5' });
    assert.equal(res.status, 302);
    assert.equal(inserida, null);
  });

  test('Dado o formato de ecra por normalizar ("20,50"), o servidor RECUSA — dai a conversao no cliente', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.post('/caixa/abrir').type('form').send({ fundo_inicial: '20,50' });
    assert.equal(res.status, 302);
    assert.equal(inserida, null, 'o servidor so aceita ponto: o cliente TEM de normalizar');
  });
});

describe('POST /caixa/fechar — valores decimais', () => {
  test('Dado total_contado="18.25" com 20.50 esperado, grava contado e diferenca corretos', async () => {
    // Given uma caixa aberta com fundo 20.50 e sem movimentos
    sessaoAberta = SESSAO_ABERTA;
    const admin = await sessaoDeAdmin();

    // When o cliente envia o valor ja normalizado (utilizador teclou "18,25")
    const res = await admin
      .post('/caixa/fechar')
      .type('form')
      .send({ total_contado: VD.normalizarDecimal('18,25') });

    // Then
    assert.equal(res.status, 302);
    assert.equal(fechada.total_contado, 18.25);
    assert.equal(fechada.diferenca, -2.25);
    assert.equal(fechada.id, SESSAO_ABERTA.id);
  });

  test('Dado o valor exato esperado, a diferenca e 0 (nunca NaN)', async () => {
    sessaoAberta = SESSAO_ABERTA;
    const admin = await sessaoDeAdmin();

    await admin
      .post('/caixa/fechar')
      .type('form')
      .send({ total_contado: VD.normalizarDecimal('20,50') });

    assert.equal(fechada.total_contado, 20.5);
    assert.equal(fechada.diferenca, 0);
    assert.ok(!Number.isNaN(fechada.diferenca));
  });

  test('Dado lixo em total_contado, o servidor recusa e a caixa fica aberta', async () => {
    sessaoAberta = SESSAO_ABERTA;
    const admin = await sessaoDeAdmin();

    const res = await admin.post('/caixa/fechar').type('form').send({ total_contado: 'abc' });

    assert.equal(res.status, 302);
    assert.equal(fechada, null, 'a caixa nao devia ter sido fechada');
  });
});

describe('GET /caixa — marcacao dos campos de valor', () => {
  test('Os campos de valor NAO sao type="number" e usam inputmode="decimal"', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/caixa');

    assert.equal(res.status, 200);
    assert.match(res.text, /id="fundo_inicial"/);
    // O bug original: type="number" descarta "20," e esvazia o campo.
    assert.doesNotMatch(res.text, /type="number"[^>]*id="fundo_inicial"/);
    assert.match(res.text, /<input type="text" inputmode="decimal"[\s\S]*?id="fundo_inicial"/);
    assert.match(res.text, /data-campo-decimal/);
  });

  test('A tecla da virgula envia "," (e nao ".")', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/caixa');

    assert.match(res.text, /data-tecla="," aria-label="Virgula decimal">,</);
    assert.doesNotMatch(res.text, /data-tecla="\." aria-label="Virgula decimal"/);
  });

  test('O campo fundo_inicial NAO vem pre-preenchido (um value="0,00" matava o teclado)', async () => {
    // Regressao: com value="0,00" o campo ja tinha 2 casas decimais, por isso
    // aplicarTecla rejeitava digitos E virgula — o teclado ficava morto.
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/caixa');

    assert.equal(res.status, 200);

    const linha = res.text.split('\n').find((l) => l.includes('id="fundo_inicial"'));
    assert.ok(linha, 'o input fundo_inicial tem de existir');

    assert.doesNotMatch(linha, /value="0,00"/, 'o campo nao pode vir pre-preenchido com "0,00"');
    assert.doesNotMatch(linha, /value="[^"]+"/, 'o campo tem de arrancar vazio');
    assert.match(linha, /placeholder="0,00"/, 'o "0,00" deve ser placeholder, nao value');
  });

  test('fundo_inicial e type="text" com inputmode="decimal"', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/caixa');

    const bloco = res.text.match(/<input[^>]*id="fundo_inicial"[^>]*>/);
    assert.ok(bloco, 'nao foi possivel isolar o input fundo_inicial');
    // O atributo type vem antes do id na marcacao multi-linha; validamos o
    // elemento inteiro a partir do inicio da tag.
    const tagCompleta = res.text
      .slice(res.text.lastIndexOf('<input', res.text.indexOf('id="fundo_inicial"')))
      .split('>')[0];

    assert.match(tagCompleta, /type="text"/);
    assert.match(tagCompleta, /inputmode="decimal"/);
    assert.doesNotMatch(tagCompleta, /type="number"/);
    assert.match(tagCompleta, /data-campo-decimal/);
  });

  test('Todos os campos com teclado arrancam sem value pre-preenchido', async () => {
    // Protege contra a reintroducao do bug noutro campo com teclado.
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/caixa');

    const alvos = (res.text.match(/data-alvo="([^"]+)"/g) || []).map((m) =>
      m.replace(/data-alvo="|"/g, '')
    );
    assert.ok(alvos.length > 0, 'devia existir pelo menos um teclado numerico');

    alvos.forEach((id) => {
      const inicio = res.text.lastIndexOf('<input', res.text.indexOf('id="' + id + '"'));
      const tag = res.text.slice(inicio).split('>')[0];
      assert.doesNotMatch(tag, /value="[^"]+"/, `o campo ${id} nao pode vir pre-preenchido`);
    });
  });

  test('Os botoes do teclado usam a virgula correta em data-tecla', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/caixa');

    assert.match(res.text, /data-tecla="," aria-label="Virgula decimal">,</);
    assert.doesNotMatch(res.text, /data-tecla="\."/);

    // O teclado tem de trazer os 10 digitos + virgula + apagar + limpar.
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'apagar', 'limpar'].forEach((tecla) => {
      assert.match(res.text, new RegExp('data-tecla="' + tecla + '"'), `falta a tecla ${tecla}`);
    });
  });

  test('O modulo de valores e carregado antes do app.js', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/caixa');
    const posModulo = res.text.indexOf('/js/valor-decimal.js');
    const posApp = res.text.indexOf('/js/app.js');
    assert.ok(posModulo !== -1, 'valor-decimal.js tem de ser carregado');
    assert.ok(posModulo < posApp, 'valor-decimal.js tem de vir antes de app.js');
  });
});
