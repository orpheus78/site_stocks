'use strict';

/**
 * Backoffice de artigos — preco de custo e margem.
 *
 * Cobre o contrato do formulario (o que o servidor aceita e recusa) e o que a
 * listagem mostra. Sem MariaDB: a BD e substituida pelo fake de
 * tests/helpers/fakeDb.js.
 *
 * Regras fixadas aqui:
 *   - o custo aceita virgula (pt-PT) e ponto;
 *   - negativos e nao-numericos sao RECUSADOS (nunca gravados como 0);
 *   - sem custo indicado grava 0;
 *   - a listagem mostra custo, preco e margem (€ e %), e um artigo com
 *     preco 0 nao produz NaN nem Infinity.
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

const CATEGORIA = { id: 3, nome: 'Cervejas', cor: '#fd7e14', ordem: 2, ativo: 1 };

// Artigos da listagem: um normal, um com margem negativa e um com preco 0.
const ARTIGOS = [
  {
    id: 5,
    categoria_id: CATEGORIA.id,
    nome: 'Imperial',
    preco: 1.2,
    preco_custo: 0.4,
    imagem: null,
    ativo: 1,
    ordem: 1,
    categoria_nome: CATEGORIA.nome,
    categoria_cor: CATEGORIA.cor,
    quantidade: 40,
    stock_minimo: 10,
    unidade: 'un'
  },
  {
    id: 6,
    categoria_id: CATEGORIA.id,
    nome: 'Cerveja cara',
    preco: 1.2,
    preco_custo: 1.5, // custo acima do preco -> margem negativa
    imagem: null,
    ativo: 1,
    ordem: 2,
    categoria_nome: CATEGORIA.nome,
    categoria_cor: CATEGORIA.cor,
    quantidade: 5,
    stock_minimo: 2,
    unidade: 'un'
  },
  {
    id: 7,
    categoria_id: null,
    nome: 'Oferta da casa',
    preco: 0, // preco 0: a percentagem nao tem base de calculo
    preco_custo: 0.35,
    imagem: null,
    ativo: 1,
    ordem: 3,
    categoria_nome: null,
    categoria_cor: null,
    quantidade: 10,
    stock_minimo: 0,
    unidade: 'un'
  }
];

// Estado mutavel do "banco de dados" falso, reposto a cada teste.
let inserido = null;
let atualizado = null;

function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => (username === ADMIN.username ? [ADMIN] : [])
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },

    {
      pattern: /INSERT INTO artigos/i,
      handler: (params) => {
        // (categoria_id, nome, preco, preco_custo, imagem, ativo, ordem)
        inserido = {
          categoria_id: params[0],
          nome: params[1],
          preco: params[2],
          preco_custo: params[3],
          ativo: params[5],
          ordem: params[6]
        };
        return { insertId: 99 };
      }
    },
    {
      pattern: /UPDATE artigos\s+SET/i,
      handler: (params) => {
        // (categoria_id, nome, preco, preco_custo, imagem, ativo, ordem, id)
        atualizado = {
          categoria_id: params[0],
          nome: params[1],
          preco: params[2],
          preco_custo: params[3],
          id: params[7]
        };
        return { affectedRows: 1 };
      }
    },
    { pattern: /UPDATE artigos SET ativo/i, handler: () => ({ affectedRows: 1 }) },

    { pattern: /INSERT INTO stocks/i, handler: () => ({ insertId: 1 }) },
    { pattern: /UPDATE stocks SET/i, handler: () => ({ affectedRows: 1 }) },
    { pattern: /FROM stocks/i, handler: () => [] },
    { pattern: /INSERT INTO movimentos_stock/i, handler: () => ({ insertId: 1 }) },
    { pattern: /FROM movimentos_stock/i, handler: () => [] },
    { pattern: /COUNT\(\*\) AS total FROM consumo_itens/i, handler: () => [{ total: 0 }] },

    {
      pattern: /FROM artigos a[\s\S]*WHERE a\.id = \?/i,
      handler: ([id]) => ARTIGOS.filter((a) => a.id === Number(id))
    },
    { pattern: /FROM artigos a/i, handler: () => ARTIGOS },
    { pattern: /FROM categorias/i, handler: () => [CATEGORIA] }
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

/** Campos minimos validos de um artigo, para nao repetir em cada teste. */
function camposBase(extra = {}) {
  return { nome: 'Artigo novo', preco: '1.20', ordem: '0', unidade: 'un', ativo: 'on', ...extra };
}

before(() => {
  ({ app } = loadAppWithFakeDb(handlers()));
});

beforeEach(() => {
  inserido = null;
  atualizado = null;
});

describe('POST /admin/artigos — preco_custo aceita o formato pt-PT', () => {
  test('Dado preco_custo="0,40" (com virgula), grava 0.40', async () => {
    // Given
    const admin = await sessaoDeAdmin();

    // When
    const res = await admin
      .post('/admin/artigos')
      .type('form')
      .send(camposBase({ preco_custo: '0,40' }));

    // Then
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin/artigos');
    assert.equal(inserido.preco_custo, 0.4);
    assert.ok(!Number.isNaN(inserido.preco_custo));
  });

  test('Dado preco_custo="0.40" (com ponto), grava o mesmo valor', async () => {
    const admin = await sessaoDeAdmin();

    const res = await admin
      .post('/admin/artigos')
      .type('form')
      .send(camposBase({ preco_custo: '0.40' }));

    assert.equal(res.status, 302);
    assert.equal(inserido.preco_custo, 0.4);
  });

  test('Dado o valor tal como o cliente o normaliza, o resultado e o mesmo', async () => {
    const admin = await sessaoDeAdmin();
    const enviado = VD.normalizarDecimal('1,05');
    assert.equal(enviado, '1.05');

    await admin.post('/admin/artigos').type('form').send(camposBase({ preco_custo: enviado }));

    assert.equal(inserido.preco_custo, 1.05);
  });

  test('Sem preco_custo no formulario, grava 0 (campo opcional)', async () => {
    const admin = await sessaoDeAdmin();

    const res = await admin.post('/admin/artigos').type('form').send(camposBase());

    assert.equal(res.status, 302);
    assert.equal(inserido.preco_custo, 0);
  });

  test('Com preco_custo vazio, grava 0 e nao rebenta', async () => {
    const admin = await sessaoDeAdmin();

    await admin.post('/admin/artigos').type('form').send(camposBase({ preco_custo: '' }));

    assert.equal(inserido.preco_custo, 0);
  });
});

describe('POST /admin/artigos — validacao do preco_custo', () => {
  test('Dado um preco_custo negativo, recusa e nao grava nada', async () => {
    // Given
    const admin = await sessaoDeAdmin();

    // When
    const res = await admin
      .post('/admin/artigos')
      .type('form')
      .send(camposBase({ preco_custo: '-1' }));

    // Then: volta atras com flash de erro, sem INSERT
    assert.equal(res.status, 302);
    assert.equal(inserido, null, 'um custo negativo nunca pode ser gravado');
  });

  test('Dado um preco_custo negativo com virgula ("-0,40"), tambem recusa', async () => {
    const admin = await sessaoDeAdmin();

    await admin.post('/admin/artigos').type('form').send(camposBase({ preco_custo: '-0,40' }));

    assert.equal(inserido, null);
  });

  test('Dado um preco_custo nao numerico, recusa e nao grava nada', async () => {
    const admin = await sessaoDeAdmin();

    const res = await admin
      .post('/admin/artigos')
      .type('form')
      .send(camposBase({ preco_custo: 'abc' }));

    assert.equal(res.status, 302);
    assert.equal(inserido, null, 'lixo nao pode ser gravado como 0 em silencio');
  });

  test('Dado um preco negativo, continua a recusar (regressao do campo antigo)', async () => {
    const admin = await sessaoDeAdmin();

    await admin
      .post('/admin/artigos')
      .type('form')
      .send(camposBase({ preco: '-2', preco_custo: '0,40' }));

    assert.equal(inserido, null);
  });
});

describe('POST /admin/artigos/:id — editar o preco de custo', () => {
  test('Dado "0,55" na edicao, atualiza o artigo com 0.55', async () => {
    // Given
    const admin = await sessaoDeAdmin();

    // When
    const res = await admin
      .post('/admin/artigos/5')
      .type('form')
      .send(camposBase({ nome: 'Imperial', preco: '1,20', preco_custo: '0,55' }));

    // Then
    assert.equal(res.status, 302);
    assert.equal(atualizado.id, 5);
    assert.equal(atualizado.preco_custo, 0.55);
    assert.equal(atualizado.preco, 1.2);
  });

  test('Dado um custo invalido na edicao, nao altera nada', async () => {
    const admin = await sessaoDeAdmin();

    await admin
      .post('/admin/artigos/5')
      .type('form')
      .send(camposBase({ nome: 'Imperial', preco_custo: 'x' }));

    assert.equal(atualizado, null);
  });
});

describe('GET /admin/artigos/novo|editar — marcacao do campo de custo', () => {
  test('O campo preco_custo NAO e type="number" e usa inputmode="decimal"', async () => {
    // O <input type="number"> descarta estados intermedios como "0," e
    // esvazia o campo — o bug que ja aconteceu duas vezes neste projeto.
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/admin/artigos/novo');

    assert.equal(res.status, 200);
    const inicio = res.text.lastIndexOf('<input', res.text.indexOf('id="preco_custo"'));
    const tag = res.text.slice(inicio).split('>')[0];

    assert.match(tag, /type="text"/);
    assert.match(tag, /inputmode="decimal"/);
    assert.doesNotMatch(tag, /type="number"/);
    assert.match(tag, /data-campo-decimal/);
  });

  test('O formulario de edicao traz o custo do artigo', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/admin/artigos/5/editar');

    assert.equal(res.status, 200);
    assert.match(res.text, /name="preco_custo"/);
    assert.match(res.text, /value="0\.40"/);
  });

  test('O modulo de valores decimais e carregado antes do app.js', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/admin/artigos/novo');

    // `posicao*` = indice do texto no HTML. Nada a ver com o ecra GIM.
    const posicaoModulo = res.text.indexOf('/js/valor-decimal.js');
    const posicaoApp = res.text.indexOf('/js/app.js');
    assert.ok(posicaoModulo !== -1);
    assert.ok(posicaoModulo < posicaoApp);
  });
});

describe('GET /admin/artigos — listagem com custo e margem', () => {
  test('Mostra as colunas de custo, preco e margem', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/admin/artigos');

    assert.equal(res.status, 200);
    assert.match(res.text, /<th[^>]*>Custo<\/th>/);
    assert.match(res.text, /<th[^>]*>Preco<\/th>/);
    assert.match(res.text, /<th[^>]*>Margem<\/th>/);
  });

  test('Dado preco 1.20 e custo 0.40, mostra a margem 0.80 € e 66.7 %', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/admin/artigos');

    assert.ok(res.text.includes('0.40 €'), 'devia mostrar o custo');
    assert.ok(res.text.includes('0.80 €'), 'devia mostrar a margem em euros');
    assert.ok(res.text.includes('66.7 %'), 'devia mostrar a margem em percentagem');
  });

  test('Dado um artigo com custo acima do preco, mostra margem negativa', async () => {
    const admin = await sessaoDeAdmin();
    const res = await admin.get('/admin/artigos');

    assert.ok(res.text.includes('-0.30 €'), 'a margem negativa tem de aparecer');
    assert.ok(res.text.includes('-25.0 %'));
  });

  test('Dado um artigo com preco 0, NAO aparece NaN nem Infinity na pagina', async () => {
    // Given: 'Oferta da casa' tem preco 0 e custo 0.35
    const admin = await sessaoDeAdmin();

    // When
    const res = await admin.get('/admin/artigos');

    // Then
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('NaN'), 'a divisao por zero nunca pode chegar ao ecra');
    assert.ok(!res.text.includes('Infinity'));
    assert.ok(res.text.includes('—'), 'sem base de calculo mostra-se um travessao');
  });
});
