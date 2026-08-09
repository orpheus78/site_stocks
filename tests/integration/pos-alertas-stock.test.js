'use strict';

/**
 * Alertas de stock baixo no POS (requisito do cliente):
 * "criar um alerta caso o stock do artigo esteja abaixo do stock minimo, na
 * parte da venda, assim o utilizador pode avisar o responsavel".
 *
 * Cobre o contrato HTTP das duas pecas:
 *   - GET  /api/pos/artigos -> `stock_minimo` + booleano derivado `stock_baixo`
 *   - POST /api/vendas      -> `avisos` (texto) e `avisos_stock` (com `tipo`)
 *
 * REGRA DE NEGOCIO: a venda NUNCA e bloqueada por falta de stock. Os avisos
 * sao informativos e a resposta continua a ser 201.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const FUNCIONARIO = {
  id: 2,
  nome: 'Funcionario Bar',
  username: 'bar.teste',
  password_hash: bcrypt.hashSync('password-de-teste-123', 4),
  pin_hash: null,
  role: 'funcionario',
  ativo: 1
};

const CATEGORIA = { id: 1, nome: 'Bebidas', cor: '#0d6efd', ordem: 1, ativo: 1 };

/**
 * Catalogo de teste, um artigo por cenario relevante da regra
 * `quantidade <= stock_minimo`.
 */
const ARTIGOS = [
  // Confortavel: acima do minimo.
  linha({ id: 1, nome: 'Imperial', preco: 1.2, quantidade: 40, stock_minimo: 30 }),
  // Limite inclusivo: igual ao minimo JA e stock baixo.
  linha({ id: 2, nome: 'Cafe', preco: 0.7, quantidade: 5, stock_minimo: 5 }),
  // Abaixo do minimo.
  linha({ id: 3, nome: 'Cha', preco: 0.9, quantidade: 2, stock_minimo: 10 }),
  // Esgotado.
  linha({ id: 4, nome: 'Bifana', preco: 3, quantidade: 0, stock_minimo: 8 }),
  // Negativo (inventario por corrigir).
  linha({ id: 5, nome: 'Gelado premium', preco: 2.5, quantidade: -3, stock_minimo: 5 }),
  // Artigo SEM linha de stock: o LEFT JOIN devolve tudo a null.
  linha({ id: 6, nome: 'Sandes do dia', preco: 2.8, quantidade: null, stock_minimo: null, unidade: null })
];

function linha({ id, nome, preco, quantidade, stock_minimo, unidade = 'un' }) {
  return {
    id,
    categoria_id: CATEGORIA.id,
    nome,
    preco,
    imagem: null,
    ativo: 1,
    ordem: id,
    categoria_nome: CATEGORIA.nome,
    categoria_cor: CATEGORIA.cor,
    quantidade,
    stock_minimo,
    unidade
  };
}

function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => (username === FUNCIONARIO.username ? [FUNCIONARIO] : [])
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },

    // Catalogo do POS
    {
      pattern: /FROM artigos a[\s\S]*WHERE a\.id = \?/i,
      handler: ([id]) => ARTIGOS.filter((a) => a.id === Number(id))
    },
    { pattern: /FROM artigos a/i, handler: () => ARTIGOS },
    { pattern: /FROM categorias/i, handler: () => [CATEGORIA] },

    // Venda
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [] },
    { pattern: /COALESCE\(MAX\(numero\), 0\)/i, handler: () => [{ proximo: 1 }] },
    { pattern: /INSERT INTO vendas/i, handler: () => ({ insertId: 500 }) },
    { pattern: /INSERT INTO venda_itens/i, handler: () => ({ insertId: 1 }) },
    { pattern: /INSERT INTO stocks/i, handler: () => ({}) },
    {
      pattern: /FROM stocks WHERE artigo_id = \? FOR UPDATE/i,
      handler: ([artigoId]) => {
        const artigo = ARTIGOS.find((a) => a.id === Number(artigoId));
        return [
          {
            id: artigo.id,
            artigo_id: artigo.id,
            quantidade: artigo.quantidade === null ? 0 : artigo.quantidade,
            stock_minimo: artigo.stock_minimo === null ? 0 : artigo.stock_minimo,
            unidade: artigo.unidade || 'un'
          }
        ];
      }
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
    .send({ username: FUNCIONARIO.username, password: 'password-de-teste-123' });
});

/** Artigo do catalogo devolvido pela API, por nome. */
async function doCatalogo(nome) {
  const res = await agente.get('/api/pos/artigos');
  assert.equal(res.status, 200);
  const artigo = res.body.artigos.find((a) => a.nome === nome);
  assert.ok(artigo, `o catalogo devia conter ${nome}`);
  return artigo;
}

describe('GET /api/pos/artigos — stock_minimo e stock_baixo', () => {
  test('Dado um artigo acima do minimo, devolve stock_baixo = false', async () => {
    const artigo = await doCatalogo('Imperial');

    assert.equal(artigo.stock, 40);
    assert.equal(artigo.stock_minimo, 30);
    assert.equal(artigo.stock_baixo, false);
  });

  test('Dado um artigo com stock igual ao minimo, devolve stock_baixo = true (limite inclusivo)', async () => {
    const artigo = await doCatalogo('Cafe');

    assert.equal(artigo.stock, 5);
    assert.equal(artigo.stock_minimo, 5);
    assert.equal(artigo.stock_baixo, true);
  });

  test('Dado um artigo abaixo do minimo, devolve stock_baixo = true', async () => {
    const artigo = await doCatalogo('Cha');

    assert.equal(artigo.stock, 2);
    assert.equal(artigo.stock_minimo, 10);
    assert.equal(artigo.stock_baixo, true);
  });

  test('Dado um artigo esgotado, devolve stock 0 e stock_baixo = true', async () => {
    const artigo = await doCatalogo('Bifana');

    assert.equal(artigo.stock, 0);
    assert.equal(artigo.stock_baixo, true);
  });

  test('Dado um artigo com stock negativo, devolve o valor real e stock_baixo = true', async () => {
    const artigo = await doCatalogo('Gelado premium');

    assert.equal(artigo.stock, -3);
    assert.equal(artigo.stock_baixo, true);
  });

  test('Dado um artigo sem linha de stock, nao rebenta: stock/minimo a null e sem alerta', async () => {
    const artigo = await doCatalogo('Sandes do dia');

    assert.equal(artigo.stock, null);
    assert.equal(artigo.stock_minimo, null);
    assert.equal(artigo.stock_baixo, false);
  });

  test('Os campos ja existentes do contrato mantem-se inalterados', async () => {
    const artigo = await doCatalogo('Imperial');

    assert.equal(artigo.id, 1);
    assert.equal(artigo.categoria_id, 1);
    assert.equal(artigo.preco, 1.2);
    assert.equal(artigo.imagem, null);
    assert.equal(artigo.unidade, 'un');
  });
});

describe('POST /api/vendas — avisos de stock com tipo', () => {
  test('Dada uma venda que empurra o artigo para baixo do minimo, devolve aviso do tipo stock_baixo (201)', async () => {
    // Given: Imperial tem 40 e minimo 30
    // When: vende 12 -> fica com 28
    const res = await agente.post('/api/vendas').send({
      itens: [{ artigo_id: 1, quantidade: 12 }],
      metodo_pagamento: 'multibanco'
    });

    // Then: a venda passa (nunca e bloqueada) e traz o aviso classificado
    assert.equal(res.status, 201);
    assert.equal(res.body.avisos_stock.length, 1);

    const aviso = res.body.avisos_stock[0];
    assert.equal(aviso.tipo, 'stock_baixo');
    assert.equal(aviso.artigo_id, 1);
    assert.equal(aviso.artigo, 'Imperial');
    assert.equal(aviso.quantidade, 28);
    assert.equal(aviso.stock_minimo, 30);
    assert.match(aviso.mensagem, /responsavel/i);

    // Compatibilidade: `avisos` continua a ser a lista de mensagens de texto.
    assert.deepEqual(res.body.avisos, [aviso.mensagem]);
  });

  test('Dada uma venda que deixa o stock negativo, o aviso e do tipo stock_negativo (nao duplica)', async () => {
    // Given: Cha tem 2 e minimo 10. When: vende 5 -> -3
    const res = await agente.post('/api/vendas').send({
      itens: [{ artigo_id: 3, quantidade: 5 }],
      metodo_pagamento: 'multibanco'
    });

    assert.equal(res.status, 201, 'a venda nunca pode ser bloqueada por falta de stock');
    assert.equal(res.body.avisos_stock.length, 1, 'um artigo gera no maximo um aviso');
    assert.equal(res.body.avisos_stock[0].tipo, 'stock_negativo');
    assert.equal(res.body.avisos_stock[0].quantidade, -3);
    assert.match(res.body.avisos[0], /negativo/i);
  });

  test('Dada uma venda sem impacto no minimo, nao ha avisos nenhuns', async () => {
    // Given: Imperial tem 40 e minimo 30. When: vende 1 -> 39
    const res = await agente.post('/api/vendas').send({
      itens: [{ artigo_id: 1, quantidade: 1 }],
      metodo_pagamento: 'multibanco'
    });

    assert.equal(res.status, 201);
    assert.deepEqual(res.body.avisos, []);
    assert.deepEqual(res.body.avisos_stock, []);
  });

  test('Dada uma venda com varios artigos, cada um traz o seu aviso com o tipo correto', async () => {
    const res = await agente.post('/api/vendas').send({
      itens: [
        { artigo_id: 1, quantidade: 12 }, // 40 -> 28 (baixo)
        { artigo_id: 3, quantidade: 5 }, // 2 -> -3 (negativo)
        { artigo_id: 2, quantidade: 1 } // 5 -> 4 (baixo)
      ],
      metodo_pagamento: 'multibanco'
    });

    assert.equal(res.status, 201);
    const tipos = res.body.avisos_stock.map((a) => `${a.artigo}:${a.tipo}`);
    assert.deepEqual(tipos, ['Imperial:stock_baixo', 'Cha:stock_negativo', 'Cafe:stock_baixo']);
    assert.equal(res.body.avisos.length, 3);
  });
});
