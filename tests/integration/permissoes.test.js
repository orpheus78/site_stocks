'use strict';

/**
 * Autorizacao por perfil (requisito do cliente):
 *   - admin       -> backoffice (/admin/*), caixa (/caixa/*) e GIM
 *   - funcionario -> APENAS o GIM (registo de movimentos, catalogo) e o logout
 *
 * O que se verifica aqui e a guarda do SERVIDOR, nao o que a UI esconde:
 * esconder links e usabilidade, o 403 e que e seguranca.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const PASSWORD = 'password-de-teste-123';
// rounds baixos: mantem a suite rapida (o custo real esta no seed/producao).
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

const FUNCIONARIO = {
  id: 2,
  nome: 'Funcionario Bar',
  username: 'bar.teste',
  password_hash: HASH,
  pin_hash: null,
  role: 'funcionario',
  ativo: 1
};

const UTILIZADORES = [ADMIN, FUNCIONARIO];

/**
 * Handlers suficientes para as paginas do backoffice, da caixa e do GIM
 * renderizarem com listas vazias. A ordem importa: o primeiro padrao ganha.
 */
function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => UTILIZADORES.filter((u) => u.username === username)
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },

    // Caixa
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [] },
    { pattern: /FROM sessoes_caixa/i, handler: () => [] },
    { pattern: /FROM movimentos_caixa/i, handler: () => [] },
    { pattern: /INSERT INTO sessoes_caixa/i, handler: () => ({ insertId: 1 }) },
    // Movimentos que ficaram sem sessao de caixa (aviso do ecra /caixa).
    { pattern: /FROM consumos[\s\S]*sessao_caixa_id IS NULL/i, handler: () => [{ n_consumos: 0, total: 0 }] },

    // Relatorios / dashboard
    { pattern: /DATE\(v\.criado_em\) AS dia/i, handler: () => [] },
    {
      pattern: /COUNT\(\*\) AS n_consumos[\s\S]*FROM consumos v/i,
      handler: () => [{ n_consumos: 0, total: 0, dinheiro: 0, multibanco: 0, ticket_medio: 0 }]
    },
    { pattern: /FROM consumo_itens vi/i, handler: () => [] },
    { pattern: /FROM consumos v/i, handler: () => [] },
    { pattern: /FROM movimentos_stock/i, handler: () => [] },

    // Catalogo / stocks
    { pattern: /FROM stocks s/i, handler: () => [] },
    { pattern: /FROM artigos a/i, handler: () => [] },
    { pattern: /FROM categorias/i, handler: () => [] }
  ];
}

let app;

/** Autentica e devolve um agent com o cookie de sessao do perfil pedido. */
async function sessaoDe(utilizador) {
  const agente = request.agent(app);
  const res = await agente
    .post('/login')
    .type('form')
    .send({ username: utilizador.username, password: PASSWORD });
  assert.equal(res.status, 302, `login de ${utilizador.username} devia ter sucesso`);
  return agente;
}

before(() => {
  ({ app } = loadAppWithFakeDb(handlers()));
});

// Areas exclusivas do admin. Sao paginas HTML -> 403 renderizado.
const AREAS_ADMIN = [
  '/admin',
  '/admin/artigos',
  '/admin/categorias',
  '/admin/stocks',
  '/admin/movimentos',
  '/admin/consumos',
  '/admin/relatorios',
  '/caixa'
];

const POSTS_CAIXA = [
  { rota: '/caixa/abrir', corpo: { fundo_inicial: '50.00' } },
  { rota: '/caixa/movimento', corpo: { tipo: 'sangria', valor: '10.00', descricao: 'x' } },
  { rota: '/caixa/fechar', corpo: { total_contado: '60.00' } }
];

describe('Perfil funcionario — bloqueado fora do GIM', () => {
  let funcionario;

  before(async () => {
    funcionario = await sessaoDe(FUNCIONARIO);
  });

  for (const rota of AREAS_ADMIN) {
    test(`GET ${rota} responde 403 (nao redireciona para /login)`, async () => {
      const res = await funcionario.get(rota);
      assert.equal(res.status, 403, `${rota} devia estar vedado ao funcionario`);
      assert.match(res.text, /Sem permissoes/);
    });
  }

  for (const { rota, corpo } of POSTS_CAIXA) {
    test(`POST ${rota} responde 403 e nao executa a operacao`, async () => {
      const res = await funcionario.post(rota).type('form').send(corpo);
      assert.equal(res.status, 403);
    });
  }

  test('GET /caixa/sessao/:id responde 403', async () => {
    const res = await funcionario.get('/caixa/sessao/1');
    assert.equal(res.status, 403);
  });

  test('Um pedido de API do backoffice responde 403 em JSON (nao HTML)', async () => {
    const res = await funcionario.get('/admin/relatorios').set('accept', 'application/json');
    assert.equal(res.status, 403);
    assert.equal(res.body.erro, 'Sem permissoes');
  });
});

describe('Perfil funcionario — acesso ao GIM permitido', () => {
  let funcionario;

  before(async () => {
    funcionario = await sessaoDe(FUNCIONARIO);
  });

  test('GET /gim responde 200', async () => {
    const res = await funcionario.get('/gim');
    assert.equal(res.status, 200);
  });

  test('GET /api/gim/artigos responde 200 com o catalogo', async () => {
    const res = await funcionario.get('/api/gim/artigos');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.artigos));
    assert.ok(Array.isArray(res.body.categorias));
  });

  test('O GIM nao mostra atalhos para caixa nem para o backoffice', async () => {
    const res = await funcionario.get('/gim');
    assert.doesNotMatch(res.text, /href="\/admin"/);
    assert.doesNotMatch(res.text, /href="\/caixa"/);
  });

  test('Sem caixa aberta o ecra avisa o funcionario mas nao bloqueia o registo', async () => {
    const res = await funcionario.get('/gim');
    // Sem caixa aberta (handler devolve []) o registo continua disponivel, mas
    // o aviso tem de aparecer: os movimentos internos contam para o dinheiro
    // esperado em caixa, logo sem sessao ficam fora de qualquer fecho.
    assert.match(res.text, /Nao ha caixa aberta/);
    assert.match(res.text, /Avise o responsavel/);
    // O funcionario nao pode abrir caixa: nao ha atalho para /caixa.
    assert.doesNotMatch(res.text, /Abrir caixa<\/a>/);
    assert.match(res.text, /Movimentos Internos/);
    assert.match(res.text, /Registar/);
  });

  test('O ecra nao mostra mecanica de dinheiro (PAGAR, metodos, troco)', async () => {
    const res = await funcionario.get('/gim');
    for (const proibido of ['PAGAR', 'Multibanco', 'Troco', 'Dinheiro']) {
      assert.ok(!res.text.includes(proibido), `o GIM nao devia conter "${proibido}"`);
    }
  });
});

describe('Perfil admin — acesso total', () => {
  let admin;

  before(async () => {
    admin = await sessaoDe(ADMIN);
  });

  for (const rota of AREAS_ADMIN) {
    test(`GET ${rota} e permitido (200)`, async () => {
      const res = await admin.get(rota);
      assert.equal(res.status, 200, `${rota} devia estar acessivel ao admin`);
    });
  }

  test('GET /gim e permitido e mostra os atalhos de caixa e gestao', async () => {
    const res = await admin.get('/gim');
    assert.equal(res.status, 200);
    assert.match(res.text, /href="\/admin"/);
    assert.match(res.text, /href="\/caixa"/);
  });

  test('POST /caixa/abrir e permitido (redirect, nao 403)', async () => {
    const res = await admin.post('/caixa/abrir').type('form').send({ fundo_inicial: '50.00' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/caixa');
  });
});

describe('Sem sessao — redireciona para o login, nunca 403', () => {
  for (const rota of AREAS_ADMIN) {
    test(`GET ${rota} redireciona (302) para /login com o destino original`, async () => {
      const res = await request(app).get(rota);
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /^\/login\?next=/);
    });
  }

  test('POST /caixa/abrir sem sessao redireciona para /login (nao 403)', async () => {
    const res = await request(app).post('/caixa/abrir').type('form').send({ fundo_inicial: '10' });
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });
});

describe('Redirect por perfil apos autenticacao', () => {
  test('Admin sem "next" vai para o backoffice', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: ADMIN.username, password: PASSWORD });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin');
  });

  test('Admin com "next" interno vai para esse destino', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: ADMIN.username, password: PASSWORD, next: '/admin/stocks' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin/stocks');
  });

  test('Funcionario sem "next" vai para o GIM', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: FUNCIONARIO.username, password: PASSWORD });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/gim');
  });

  test('Funcionario com "next" para area de admin vai na mesma para o GIM (evita 403 imediato)', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: FUNCIONARIO.username, password: PASSWORD, next: '/caixa' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/gim');
  });

  test('Um "next" externo continua a ser ignorado (open redirect)', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({
        username: ADMIN.username,
        password: PASSWORD,
        next: 'https://site-malicioso.exemplo/roubo'
      });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin');
  });
});

describe('GET / encaminha cada perfil para a sua area', () => {
  test('Sem sessao vai para /login', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
  });

  test('Admin vai para /admin', async () => {
    const admin = await sessaoDe(ADMIN);
    const res = await admin.get('/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin');
  });

  test('Funcionario vai para /gim', async () => {
    const funcionario = await sessaoDe(FUNCIONARIO);
    const res = await funcionario.get('/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/gim');
  });
});
