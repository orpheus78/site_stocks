'use strict';

/**
 * Renomeacao POS -> GIM: rotas, ficheiros estaticos e compatibilidade.
 *
 * O que se protege aqui:
 *   1. O ecra novo responde em /gim e carrega /css/gim.css + /js/gim.js.
 *   2. Os estaticos novos sao mesmo servidos (um rename a meio deixaria o
 *      ecra sem estilos e sem logica sem partir mais nenhum teste).
 *   3. As classes gim-* usadas no HTML existem no CSS -- e a rede de seguranca
 *      contra um rename feito so de um lado.
 *   4. As rotas antigas /pos continuam a responder com redirect (atalhos ja
 *      gravados nos tablets do balcao).
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const RAIZ = path.join(__dirname, '..', '..');

const PASSWORD = 'password-de-teste-123';
// rounds baixos: mantem a suite rapida (o custo real esta no seed/producao).
const HASH = bcrypt.hashSync(PASSWORD, 4);

const FUNCIONARIO = {
  id: 2,
  nome: 'Funcionario Bar',
  username: 'bar.teste',
  password_hash: HASH,
  pin_hash: null,
  role: 'funcionario',
  ativo: 1
};

function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => (username === FUNCIONARIO.username ? [FUNCIONARIO] : [])
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [] },
    { pattern: /FROM stocks s/i, handler: () => [] },
    { pattern: /FROM artigos a/i, handler: () => [] },
    { pattern: /FROM categorias/i, handler: () => [] }
  ];
}

let app;
let funcionario;
let htmlGim;

before(async () => {
  ({ app } = loadAppWithFakeDb(handlers()));

  funcionario = request.agent(app);
  const login = await funcionario
    .post('/login')
    .type('form')
    .send({ username: FUNCIONARIO.username, password: PASSWORD });

  // O funcionario so tem acesso ao GIM: o login tem de o mandar para la.
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/gim');

  const res = await funcionario.get('/gim');
  assert.equal(res.status, 200);
  htmlGim = res.text;
});

describe('GIM — ecra e estaticos', () => {
  test('GET /gim responde 200 e referencia gim.css e gim.js', () => {
    assert.match(htmlGim, /\/css\/gim\.css/);
    assert.match(htmlGim, /\/js\/gim\.js/);
  });

  test('O body do GIM leva a classe gim-body', () => {
    assert.match(htmlGim, /class="[^"]*gim-body/);
  });

  test('Nao sobra nenhuma referencia aos ficheiros antigos do POS', () => {
    assert.doesNotMatch(htmlGim, /pos\.css/);
    assert.doesNotMatch(htmlGim, /pos\.js/);
    // Nenhuma classe/id com o prefixo antigo (ignora `method="post"`).
    assert.doesNotMatch(htmlGim, /"pos-/);
    assert.doesNotMatch(htmlGim, /id="pos[A-Z]/);
  });

  test('GET /css/gim.css responde 200', async () => {
    const res = await request(app).get('/css/gim.css');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/css/);
    assert.ok(res.text.indexOf('.gim-') !== -1, 'o CSS tem de definir classes gim-');
  });

  test('GET /js/gim.js responde 200', async () => {
    const res = await request(app).get('/js/gim.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
  });

  test('Os ficheiros antigos do POS ja nao sao servidos', async () => {
    const css = await request(app).get('/css/pos.css');
    const js = await request(app).get('/js/pos.js');
    assert.equal(css.status, 404);
    assert.equal(js.status, 404);
  });
});

describe('GIM — o ecra tem mesmo estilos (HTML e CSS batem certo)', () => {
  test('Todas as classes gim-* do HTML estao definidas no gim.css', () => {
    const css = fs.readFileSync(path.join(RAIZ, 'public/css/gim.css'), 'utf8');

    const usadas = new Set();
    const atributos = htmlGim.match(/class="[^"]*"/g) || [];
    for (const atributo of atributos) {
      const nomes = atributo.match(/gim-[a-z0-9-]+/g) || [];
      for (const nome of nomes) usadas.add(nome);
    }

    assert.ok(usadas.size > 10, `esperavam-se varias classes gim-, encontradas ${usadas.size}`);

    const semEstilo = [];
    for (const nome of usadas) {
      // `.nome` seguido de algo que nao continue o nome da classe.
      if (!new RegExp(`\\.${nome}(?![a-z0-9-])`).test(css)) semEstilo.push(nome);
    }

    assert.deepEqual(semEstilo, [], `classes usadas no HTML sem estilo no gim.css: ${semEstilo.join(', ')}`);
  });

  test('O gim.css ja nao define nenhuma classe com o prefixo antigo pos-', () => {
    const css = fs.readFileSync(path.join(RAIZ, 'public/css/gim.css'), 'utf8');
    assert.ok(css.indexOf('.pos-') === -1, 'o gim.css nao pode manter classes .pos-');
  });
});

describe('Compatibilidade — rotas antigas /pos redirecionam para /gim', () => {
  test('GET /pos responde 308 para /gim', async () => {
    const res = await request(app).get('/pos');
    assert.equal(res.status, 308);
    assert.equal(res.headers.location, '/gim');
  });

  test('GET /api/pos/artigos responde 308 para /api/gim/artigos', async () => {
    const res = await request(app).get('/api/pos/artigos');
    assert.equal(res.status, 308);
    assert.equal(res.headers.location, '/api/gim/artigos');
  });

  test('POST /pos/pin responde 308 para /gim/pin (308 preserva o metodo)', async () => {
    const res = await request(app).post('/pos/pin').type('form').send({ pin: '1234' });
    assert.equal(res.status, 308);
    assert.equal(res.headers.location, '/gim/pin');
  });

  test('O redirect nao abre acesso: seguir /pos sem sessao acaba no login', async () => {
    const res = await request(app).get('/pos').redirects(1);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });

  test('As rotas de talao continuam a nao existir (404), com o nome novo', async () => {
    const res = await funcionario.get('/gim/consumo/9/talao');
    assert.equal(res.status, 404);
  });
});
