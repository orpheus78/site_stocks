'use strict';

/**
 * A aplicacao NAO e um sistema de faturacao.
 *
 * Enquadramento (confirmado pelo cliente): isto e software de controlo INTERNO
 * — stock e registo de consumos. Nao emite talao, comprovativo nem qualquer
 * documento para o cliente. Em Portugal, software que emite documentos de venda
 * tem de ser certificado pela AT (assinatura encadeada, ATCUD, QR code, SAF-T);
 * esta aplicacao nao e nem quer ser isso.
 *
 * Estes testes sao a rede de seguranca contra a reintroducao dessa
 * funcionalidade:
 *   1. a rota do talao esta MORTA (404), nao apenas escondida na UI;
 *   2. os ficheiros do talao (view + css) nao existem no disco;
 *   3. o controller do GIM ja nao exporta o handler nem devolve `talao_url`;
 *   4. nenhuma pagina servida contem "bi-printer", "Comprovativo" ou "Talao";
 *   5. a mencao "sem valor fiscal" aparece nas paginas do backoffice/caixa.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const RAIZ = path.join(__dirname, '..', '..');

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

const CATEGORIA = { id: 3, nome: 'Bebidas', cor: '#0d6efd', ordem: 1, ativo: 1 };

const ARTIGO = {
  id: 5,
  categoria_id: CATEGORIA.id,
  nome: 'Agua 0.5L',
  preco: 0.8,
  imagem: null,
  ativo: 1,
  ordem: 1,
  criado_em: new Date(2026, 0, 1, 10, 0),
  categoria_nome: CATEGORIA.nome,
  categoria_cor: CATEGORIA.cor,
  quantidade: 10,
  stock_minimo: 2,
  unidade: 'un'
};

// Registo HISTORICO (anterior a conversao): tem pagamento real. Serve para
// garantir que o detalhe continua a mostrar o historico e que, mesmo assim,
// nao aparece nada com cheiro a comprovativo.
const CONSUMO = {
  id: 9,
  numero: 12,
  total: 3,
  metodo_pagamento: 'dinheiro',
  valor_dinheiro: 5,
  valor_multibanco: 0,
  troco: 2,
  estado: 'concluida',
  utilizador_id: 1,
  utilizador_nome: 'Administrador',
  sessao_caixa_id: 7,
  criado_em: new Date(2026, 0, 1, 11, 30),
  n_itens: 2
};

const ITEM = {
  id: 1,
  consumo_id: CONSUMO.id,
  artigo_id: ARTIGO.id,
  nome_snapshot: ARTIGO.nome,
  preco_unit: 1.5,
  quantidade: 2,
  subtotal: 3
};

const SESSAO = {
  id: 7,
  utilizador_id: 1,
  utilizador_nome: 'Administrador',
  fundo_inicial: 20,
  estado: 'aberta',
  aberta_em: new Date(2026, 0, 1, 9, 0),
  fechada_em: null,
  total_contado: null,
  diferenca: null
};

/** A ordem importa: o primeiro padrao que casar com o SQL ganha. */
function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => UTILIZADORES.filter((u) => u.username === username)
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },

    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [SESSAO] },
    { pattern: /FROM sessoes_caixa[\s\S]*WHERE s\.id = \?/i, handler: () => [SESSAO] },
    { pattern: /FROM sessoes_caixa/i, handler: () => [SESSAO] },
    { pattern: /FROM movimentos_caixa/i, handler: () => [] },
    { pattern: /FROM consumos[\s\S]*sessao_caixa_id IS NULL/i, handler: () => [{ n_consumos: 0, total: 0 }] },
    {
      pattern: /COUNT\(\*\) AS n_consumos[\s\S]*FROM consumos\b(?![\s\S]*JOIN)/i,
      handler: () => [{ n_consumos: 1, total: 3, dinheiro: 5, interno: 0, multibanco: 0 }]
    },

    { pattern: /DATE\(v\.criado_em\) AS dia/i, handler: () => [] },
    {
      pattern: /COUNT\(\*\) AS n_consumos[\s\S]*FROM consumos v/i,
      handler: () => [{ n_consumos: 1, total: 3, dinheiro: 5, multibanco: 0, ticket_medio: 3 }]
    },

    { pattern: /FROM consumo_itens WHERE consumo_id/i, handler: () => [ITEM] },
    { pattern: /FROM consumos v[\s\S]*WHERE v\.id = \?/i, handler: () => [CONSUMO] },
    { pattern: /FROM consumos v[\s\S]*ORDER BY v\.criado_em DESC/i, handler: () => [CONSUMO] },
    { pattern: /FROM consumo_itens vi\s+JOIN/i, handler: () => [] },
    { pattern: /FROM consumos v/i, handler: () => [CONSUMO] },

    { pattern: /FROM movimentos_stock/i, handler: () => [] },
    { pattern: /FROM stocks s/i, handler: () => [] },

    { pattern: /FROM artigos a[\s\S]*WHERE a\.id = \?/i, handler: () => [ARTIGO] },
    { pattern: /FROM artigos a/i, handler: () => [ARTIGO] },
    { pattern: /FROM categorias/i, handler: () => [CATEGORIA] }
  ];
}

let app;
let admin;
let funcionario;

async function sessaoDe(utilizador) {
  const agente = request.agent(app);
  const res = await agente
    .post('/login')
    .type('form')
    .send({ username: utilizador.username, password: PASSWORD });
  assert.equal(res.status, 302, `login de ${utilizador.username} devia ter sucesso`);
  return agente;
}

before(async () => {
  ({ app } = loadAppWithFakeDb(handlers()));
  admin = await sessaoDe(ADMIN);
  funcionario = await sessaoDe(FUNCIONARIO);
});

/** HTML de uma pagina, garantindo que respondeu 200. */
async function html(agente, rota) {
  const res = await agente.get(rota);
  assert.equal(res.status, 200, `${rota} devia responder 200`);
  return res.text;
}

// Paginas com navegacao (layout completo) — sao estas que tem rodape.
const PAGINAS_COM_RODAPE = [
  { rota: '/admin', perfil: 'admin' },
  { rota: '/admin/artigos', perfil: 'admin' },
  { rota: '/admin/artigos/novo', perfil: 'admin' },
  { rota: '/admin/artigos/5/editar', perfil: 'admin' },
  { rota: '/admin/categorias', perfil: 'admin' },
  { rota: '/admin/categorias/novo', perfil: 'admin' },
  { rota: '/admin/categorias/3/editar', perfil: 'admin' },
  { rota: '/admin/stocks', perfil: 'admin' },
  { rota: '/admin/movimentos', perfil: 'admin' },
  { rota: '/admin/consumos', perfil: 'admin' },
  { rota: '/admin/consumos/9', perfil: 'admin' },
  { rota: '/admin/relatorios', perfil: 'admin' },
  { rota: '/caixa', perfil: 'admin' },
  { rota: '/caixa/sessao/7', perfil: 'admin' }
];

// Paginas sem navegacao (ecra cheio): login e o GIM touch.
const PAGINAS_SEM_RODAPE = [
  { rota: '/login', perfil: 'anonimo' },
  { rota: '/gim', perfil: 'funcionario' }
];

const TODAS = PAGINAS_COM_RODAPE.concat(PAGINAS_SEM_RODAPE);

function agenteDe(perfil) {
  if (perfil === 'admin') return admin;
  if (perfil === 'funcionario') return funcionario;
  return request(app);
}

// ---------------------------------------------------------------------------

describe('A rota do talao/comprovativo esta morta', () => {
  for (const perfil of ['admin', 'funcionario']) {
    test(`GET /gim/consumo/9/talao responde 404 (${perfil})`, async () => {
      const res = await agenteDe(perfil).get('/gim/consumo/9/talao');
      assert.equal(res.status, 404, 'a rota do talao tem de ter sido REMOVIDA, nao escondida');
    });
  }

  test('GET /gim/consumo/9/talao?papel=58 tambem responde 404', async () => {
    const res = await agenteDe('funcionario').get('/gim/consumo/9/talao?papel=58');
    assert.equal(res.status, 404);
  });

  test('Um id invalido nao rebenta o servidor (404, nunca 500)', async () => {
    const res = await agenteDe('admin').get('/gim/consumo/abc/talao');
    assert.equal(res.status, 404, 'tem de cair no 404 geral, sem erro do validador');
  });

  // A nomenclatura antiga ("venda") tambem nao pode ressuscitar o talao.
  test('GET /gim/venda/9/talao (nomenclatura antiga) responde 404', async () => {
    const res = await agenteDe('funcionario').get('/gim/venda/9/talao');
    assert.equal(res.status, 404, 'a rota antiga do talao tambem tem de estar morta');
  });
});

describe('Os ficheiros do talao desapareceram do projeto', () => {
  const REMOVIDOS = ['views/gim/talao.ejs', 'public/css/talao.css'];

  for (const ficheiro of REMOVIDOS) {
    test(`${ficheiro} nao existe`, () => {
      assert.ok(
        !fs.existsSync(path.join(RAIZ, ficheiro)),
        `${ficheiro} tem de ser eliminado: enquanto o ficheiro existir, a funcionalidade pode voltar`
      );
    });
  }

  test('O controller do GIM nao exporta nenhum handler de talao', () => {
    const ctrl = require('../../src/controllers/gim.controller');
    assert.equal(typeof ctrl.talao, 'undefined', 'gim.controller nao pode exportar talao()');
    assert.deepEqual(Object.keys(ctrl).sort(), ['catalogo', 'criarConsumo', 'ecra']);
  });

  test('O controller do GIM nao devolve talao_url no JSON de criacao', () => {
    const fonte = fs.readFileSync(path.join(RAIZ, 'src/controllers/gim.controller.js'), 'utf8');
    assert.ok(fonte.indexOf('talao_url') === -1, 'o JSON de criacao nao pode ter talao_url');
  });

  test('O JS de cliente do GIM nao usa talao_url', () => {
    const fonte = fs.readFileSync(path.join(RAIZ, 'public/js/gim.js'), 'utf8');
    assert.ok(fonte.indexOf('talao') === -1, '/js/gim.js nao pode referir o talao');
  });
});

describe('Nenhuma pagina servida parece um documento de venda', () => {
  // Tudo o que denuncia um sistema de faturacao/talao ao utilizador.
  const PROIBIDOS = ['bi-printer', 'Comprovativo', 'comprovativo', 'Talao', 'talao', 'Talão', 'talão'];

  for (const { rota, perfil } of TODAS) {
    test(`${rota} nao contem linguagem de talao/comprovativo`, async () => {
      const texto = await html(agenteDe(perfil), rota);

      for (const proibido of PROIBIDOS) {
        assert.ok(
          texto.indexOf(proibido) === -1,
          `${rota} ainda tem linguagem de documento de venda: "${proibido}"`
        );
      }
    });
  }

  test('O detalhe de um registo HISTORICO mantem o pagamento, mas rotulado como historico', async () => {
    // O historico real TEM pagamentos e essa informacao continua a ser precisa
    // para a contabilidade interna — o que muda e o rotulo, que deixa claro
    // que e historico anterior a conversao.
    const texto = await html(admin, '/admin/consumos/9');

    assert.match(texto, /Pagamento \(historico\)/);
    assert.match(texto, /Dinheiro recebido \(historico\)/);
    assert.match(texto, /Troco \(historico\)/);
    // E continua a ser um "Movimento", nunca uma "Venda".
    assert.match(texto, /Movimento #12/);
  });
});

describe('Mencao "sem valor fiscal"', () => {
  for (const { rota, perfil } of PAGINAS_COM_RODAPE) {
    test(`${rota} mostra "Registo interno — sem valor fiscal" no rodape`, async () => {
      const texto = await html(agenteDe(perfil), rota);

      assert.ok(
        texto.indexOf('Registo interno — sem valor fiscal') !== -1,
        `${rota} tem de ter a mencao no rodape`
      );
      assert.match(texto, /data-sem-valor-fiscal="1"/);
      // Discreta: e texto secundario do rodape, nunca um alerta.
      assert.match(texto, /<footer[^>]*text-body-secondary/);
    });
  }

  test('O GIM mostra a mencao na confirmacao, nao num rodape', async () => {
    // Decisao: o GIM e um ecra touch de operacao rapida (alvos >= 64px). Um
    // rodape fixo roubava altura ao catalogo e ao carrinho, por isso a mencao
    // vive no painel de confirmacao, exatamente onde antes existiria um talao.
    const texto = await html(funcionario, '/gim');

    assert.ok(texto.indexOf('sem valor fiscal') !== -1, 'o GIM tem de referir que nao ha valor fiscal');
    assert.ok(texto.indexOf('<footer') === -1, 'o GIM nao pode ganhar um rodape: rouba area de toque');
  });
});
