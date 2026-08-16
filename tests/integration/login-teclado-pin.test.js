'use strict';

/**
 * Teclado numerico do PIN no ecra de login.
 *
 * Pedido do cliente: entrar no GIM com o dedo, sem teclado do sistema. Como
 * nao e possivel tocar no ecra a partir dos testes, esta suite garante o que
 * o SERVIDOR entrega:
 *   1. as 10 teclas de digito + apagar + limpar estao no HTML;
 *   2. o modulo novo e carregado (e SO nesta pagina) e e mesmo servido;
 *   3. nao ha um unico pedaco de JS inline (a regra do projeto);
 *   4. o PIN nao aparece em claro (campo mascarado) nem sai do contrato:
 *      continua a submeter POST /gim/pin;
 *   5. o POST /gim/pin continua a funcionar e a falhar sem revelar nada.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const PIN_VALIDO = '4321';
// rounds baixos: mantem a suite rapida (o custo real esta no seed/producao).
const FUNCIONARIO = {
  id: 2,
  nome: 'Funcionario Bar',
  username: 'bar.teste',
  password_hash: bcrypt.hashSync('password-de-teste-123', 4),
  pin_hash: bcrypt.hashSync(PIN_VALIDO, 4),
  role: 'funcionario',
  ativo: 1
};

function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => (username === FUNCIONARIO.username ? [FUNCIONARIO] : [])
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [FUNCIONARIO] }
  ];
}

let app;
let html;

before(async () => {
  ({ app } = loadAppWithFakeDb(handlers()));
  const res = await request(app).get('/login');
  assert.equal(res.status, 200);
  html = res.text;
});

describe('GET /login — teclado do PIN no HTML', () => {
  test('Os 10 digitos estao la, cada um com a sua tecla', () => {
    for (let d = 0; d <= 9; d += 1) {
      assert.ok(
        html.indexOf(`data-pin-tecla="${d}"`) !== -1,
        `falta a tecla do digito ${d}`
      );
    }
  });

  test('Ha tecla de apagar e tecla de limpar (o erro de digitacao e recuperavel)', () => {
    assert.match(html, /data-pin-tecla="apagar"/);
    assert.match(html, /data-pin-tecla="limpar"/);
    assert.match(html, /aria-label="Apagar o ultimo digito"/);
  });

  test('Os 4 pontos de feedback existem e nao ha PIN em claro no HTML', () => {
    const pontos = html.match(/data-pin-ponto(?!s)/g) || [];
    assert.equal(pontos.length, 4, 'devem ser exatamente 4 pontos');
    // O campo real e mascarado: sem JS ve-se o campo, nunca os digitos.
    assert.match(html, /type="password"[^>]*name="pin"|name="pin"[^>]*type="password"/);
    assert.ok(html.indexOf('value="' + PIN_VALIDO) === -1, 'nenhum PIN pre-preenchido');
  });

  test('O contrato do formulario mantem-se: POST /gim/pin com o campo "pin"', () => {
    assert.match(html, /action="\/gim\/pin"/);
    assert.match(html, /method="post"/);
    assert.match(html, /name="pin"/);
    assert.match(html, /data-pin-campo/);
  });

  test('O modulo do teclado e carregado nesta pagina', () => {
    assert.match(html, /src="\/js\/pin-teclado\.js"/);
  });

  test('Zero JavaScript inline na pagina de login', () => {
    for (const proibido of ['onclick=', 'onsubmit=', 'onkeyup=', 'oninput=', 'javascript:']) {
      assert.ok(html.indexOf(proibido) === -1, `/login nao pode ter ${proibido}`);
    }
  });
});

describe('O modulo do teclado e um ficheiro estatico servido', () => {
  test('GET /js/pin-teclado.js responde 200 e exporta a logica esperada', async () => {
    const res = await request(app).get('/js/pin-teclado.js');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.text, /aplicarTecla/);
  });

  test('O modulo NAO e carregado globalmente (so no login)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    // Se entrasse no layout, todas as paginas passavam a carregar codigo morto.
    const layout = fs.readFileSync(
      path.join(__dirname, '..', '..', 'views', 'layouts', 'main.ejs'),
      'utf8'
    );
    assert.ok(layout.indexOf('pin-teclado') === -1, 'o layout global nao pode carregar o teclado do PIN');
  });

  test('O modulo e ES5 puro (as WebViews dos terminais nao percebem ES6)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const codigo = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'js', 'pin-teclado.js'),
      'utf8'
    );
    const semComentarios = codigo
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.doesNotMatch(semComentarios, /=>/, 'arrow functions sao ES6');
    assert.doesNotMatch(semComentarios, /(^|[^\w.])(let|const)\s/, 'let/const sao ES6');
    assert.doesNotMatch(semComentarios, /`/, 'template literals sao ES6');
    assert.doesNotMatch(semComentarios, /\.closest\s*\(/, 'closest nao existe nas WebViews antigas');
  });
});

describe('POST /gim/pin — o contrato nao mudou', () => {
  test('Com o PIN correcto, autentica e vai directo para /gim', async () => {
    const res = await request(app).post('/gim/pin').type('form').send({ pin: PIN_VALIDO });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/gim');
    assert.ok(res.headers['set-cookie'], 'deve criar cookie de sessao');
  });

  test('Com um PIN errado, volta ao login sem revelar nada', async () => {
    const agente = request.agent(app);
    const res = await agente.post('/gim/pin').type('form').send({ pin: '0000' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');

    const pagina = await agente.get('/login');
    assert.match(pagina.text, /PIN invalido/);
    // Mensagem generica: nada de "PIN nao existe", nome de utilizador ou dicas.
    assert.ok(pagina.text.indexOf(FUNCIONARIO.nome) === -1);
    assert.ok(pagina.text.indexOf(FUNCIONARIO.username) === -1);
    assert.doesNotMatch(pagina.text, /nao existe/i);
  });

  test('Um PIN com formato invalido nem chega a comparar-se contra a BD', async () => {
    for (const pin of ['12', '12345', 'abcd', '']) {
      const res = await request(app)
        .post('/gim/pin')
        .type('form')
        .set('Referer', '/login')
        .send({ pin });

      // Rejeitado pela validacao: volta ao login, nunca entra no GIM.
      assert.equal(res.status, 302, `pin ${JSON.stringify(pin)}`);
      assert.equal(res.headers.location, '/login', `pin ${JSON.stringify(pin)}`);
    }
  });
});
