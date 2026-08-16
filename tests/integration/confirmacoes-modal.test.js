'use strict';

/**
 * Substituicao dos dialogos NATIVOS do browser pelo modal proprio.
 *
 * Pedido do cliente: "todos popup 'alert', criar um modal para esse efeito".
 * Os `confirm()`/`alert()` nativos nao seguem o tema, nao se estilizam e tem
 * botoes minusculos — inutilizaveis no ecra touch atras do balcao.
 *
 * Como nao e possivel clicar no browser, estes testes sao a garantia:
 *   1. cada formulario destrutivo declara o mecanismo novo ([data-confirmar])
 *      com a mensagem certa e ja nao tem `confirm(` inline;
 *   2. NENHUMA pagina renderizada volta a conter confirm(/alert(/prompt(
 *      (rede de seguranca contra reintroducao);
 *   3. o modulo do modal e servido a todas as paginas.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

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

// Nomes com aspas, « » e acentos: e o pior caso para a escapagem no atributo.
const CATEGORIA = {
  id: 3,
  nome: 'Bebidas "geladas"',
  cor: '#0d6efd',
  ordem: 1,
  ativo: 1
};

const ARTIGO = {
  id: 5,
  categoria_id: CATEGORIA.id,
  nome: 'Sandes «mista»',
  preco: 2.5,
  imagem: null,
  ativo: 1,
  ordem: 1,
  criado_em: new Date(2026, 0, 1, 10, 0),
  categoria_nome: CATEGORIA.nome,
  categoria_cor: CATEGORIA.cor,
  quantidade: 4,
  stock_minimo: 2,
  unidade: 'un'
};

const CONSUMO = {
  id: 9,
  numero: 12,
  total: 3,
  metodo_pagamento: 'interno',
  valor_dinheiro: 0,
  valor_multibanco: 0,
  troco: 0,
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

    // Caixa (sessao ABERTA: so assim o formulario de fecho e renderizado)
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [SESSAO] },
    { pattern: /FROM sessoes_caixa[\s\S]*WHERE s\.id = \?/i, handler: () => [SESSAO] },
    { pattern: /FROM sessoes_caixa/i, handler: () => [SESSAO] },
    { pattern: /FROM movimentos_caixa/i, handler: () => [] },
    { pattern: /FROM consumos[\s\S]*sessao_caixa_id IS NULL/i, handler: () => [{ n_consumos: 0, total: 0 }] },
    {
      pattern: /COUNT\(\*\) AS n_consumos[\s\S]*FROM consumos\b(?![\s\S]*JOIN)/i,
      handler: () => [{ n_consumos: 1, total: 3, dinheiro: 0, interno: 3, multibanco: 0 }]
    },

    // Relatorios / dashboard
    { pattern: /DATE\(v\.criado_em\) AS dia/i, handler: () => [] },
    {
      pattern: /COUNT\(\*\) AS n_consumos[\s\S]*FROM consumos v/i,
      handler: () => [{ n_consumos: 1, total: 3, dinheiro: 0, multibanco: 0, ticket_medio: 3 }]
    },

    // Movimentos internos (consumos).
    // ATENCAO a ordem: a listagem traz uma subconsulta "FROM consumo_itens vi"
    // para contar itens — os padroes de consumos tem de vir PRIMEIRO.
    { pattern: /FROM consumo_itens WHERE consumo_id/i, handler: () => [ITEM] },
    { pattern: /FROM consumos v[\s\S]*WHERE v\.id = \?/i, handler: () => [CONSUMO] },
    { pattern: /FROM consumos v[\s\S]*ORDER BY v\.criado_em DESC/i, handler: () => [CONSUMO] },
    { pattern: /FROM consumo_itens vi\s+JOIN/i, handler: () => [] },
    { pattern: /FROM consumos v/i, handler: () => [CONSUMO] },

    // Stock
    { pattern: /FROM movimentos_stock/i, handler: () => [] },
    { pattern: /FROM stocks s/i, handler: () => [] },

    // Catalogo
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

// ---------------------------------------------------------------------------

describe('Nenhum dialogo nativo sobrevive no HTML servido', () => {
  // Todas as paginas HTML da aplicacao (as do admin ficam com o agente admin).
  const PAGINAS = [
    { rota: '/login', perfil: 'anonimo' },
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
    { rota: '/caixa/sessao/7', perfil: 'admin' },
    { rota: '/gim', perfil: 'funcionario' }
  ];

  function agenteDe(perfil) {
    if (perfil === 'admin') return admin;
    if (perfil === 'funcionario') return funcionario;
    return request(app);
  }

  for (const { rota, perfil } of PAGINAS) {
    test(`${rota} nao contem confirm( / alert( / prompt( no HTML`, async () => {
      const texto = await html(agenteDe(perfil), rota);

      for (const proibido of ['confirm(', 'alert(', 'prompt(']) {
        assert.ok(
          texto.indexOf(proibido) === -1,
          `${rota} ainda tem um dialogo nativo: "${proibido}"`
        );
      }
      // O `onsubmit="return confirm(...)"` desapareceu por completo.
      assert.ok(texto.indexOf('onsubmit=') === -1, `${rota} nao devia ter onsubmit inline`);
    });
  }

  test('Todas as paginas carregam o modulo do modal', async () => {
    for (const { rota, perfil } of PAGINAS) {
      const texto = await html(agenteDe(perfil), rota);
      assert.match(texto, /src="\/js\/confirmar\.js"/, `${rota} devia carregar /js/confirmar.js`);
    }
  });
});

describe('Eliminar categoria — confirmacao pelo modal', () => {
  test('O formulario declara data-confirmar com o nome da categoria escapado', async () => {
    const texto = await html(admin, '/admin/categorias');

    assert.match(texto, /action="\/admin\/categorias\/3\/eliminar"/);
    // O nome vem da BD: as aspas TEM de sair escapadas no atributo.
    assert.ok(
      texto.indexOf('data-confirmar="Eliminar a categoria «Bebidas &#34;geladas&#34;»?"') !== -1,
      'a mensagem tem de estar no atributo, com o nome escapado'
    );
    assert.match(texto, /data-confirmar-titulo="Eliminar categoria"/);
    assert.match(texto, /data-confirmar-detalhe="Se tiver artigos, sera apenas desativada\."/);
    assert.match(texto, /data-confirmar-perigo="1"/);
    assert.ok(texto.indexOf('confirm(') === -1);
  });
});

describe('Eliminar artigo — confirmacao pelo modal', () => {
  test('O formulario declara data-confirmar com o nome do artigo', async () => {
    const texto = await html(admin, '/admin/artigos');

    assert.match(texto, /action="\/admin\/artigos\/5\/eliminar"/);
    assert.ok(texto.indexOf('data-confirmar="Eliminar «Sandes «mista»»?"') !== -1);
    assert.match(texto, /data-confirmar-titulo="Eliminar artigo"/);
    assert.match(texto, /data-confirmar-detalhe="Se ja tiver movimentos, sera apenas desativado\."/);
    assert.match(texto, /data-confirmar-perigo="1"/);
    assert.ok(texto.indexOf('confirm(') === -1);
  });
});

describe('Anular movimento — confirmacao pelo modal (listagem e detalhe)', () => {
  const MENSAGEM = 'data-confirmar="ANULAR o movimento #12 de 3.00 €?"';
  const DETALHE =
    'data-confirmar-detalhe="O stock dos artigos sera reposto. Esta accao nao pode ser desfeita."';

  test('Na listagem, o numero e o total continuam na mensagem', async () => {
    const texto = await html(admin, '/admin/consumos');

    assert.match(texto, /action="\/admin\/consumos\/9\/anular"/);
    assert.ok(texto.indexOf(MENSAGEM) !== -1, 'mensagem com numero e total');
    // O que era "\n\n" na mensagem nativa e agora um paragrafo secundario.
    assert.ok(texto.indexOf(DETALHE) !== -1, 'o aviso passou a paragrafo de detalhe');
    assert.ok(texto.indexOf('\\n\\n') === -1, 'nao pode sobrar "\\n\\n" no HTML');
    assert.match(texto, /data-confirmar-perigo="1"/);
  });

  test('No detalhe, a mensagem e exatamente a mesma', async () => {
    const texto = await html(admin, '/admin/consumos/9');

    assert.match(texto, /action="\/admin\/consumos\/9\/anular"/);
    assert.ok(texto.indexOf(MENSAGEM) !== -1);
    assert.ok(texto.indexOf(DETALHE) !== -1);
    assert.ok(texto.indexOf('confirm(') === -1);
  });

  test('A terminologia mantem-se ("movimento", nunca "consumo"/"pagamento")', async () => {
    const texto = await html(admin, '/admin/consumos');
    const atributos = texto.match(/data-confirmar="[^"]*"/g);
    assert.ok(atributos && atributos.length, 'devia haver pelo menos uma confirmacao');
    const atributo = atributos.join(' ');

    assert.match(atributo, /movimento/i);
    assert.doesNotMatch(atributo, /pagamento/i);
    assert.doesNotMatch(atributo, /\bIVA\b/);
  });
});

describe('Fechar caixa — confirmacao pelo modal', () => {
  test('O formulario de fecho declara o mecanismo (mensagem final calculada no cliente)', async () => {
    const texto = await html(admin, '/caixa');

    assert.match(texto, /id="formFecharCaixa"/);
    assert.match(texto, /data-confirmar="Fechar a caixa com o valor contado\?"/);
    assert.match(texto, /data-confirmar-titulo="Fechar caixa"/);
    assert.match(texto, /data-confirmar-perigo="1"/);
    assert.ok(texto.indexOf('confirm(') === -1);
  });
});

describe('GIM — terminar sessao e limpar lista', () => {
  test('O logout do GIM pede confirmacao pelo painel do GIM', async () => {
    const texto = await html(funcionario, '/gim');

    assert.match(texto, /action="\/logout"/);
    assert.match(texto, /data-confirmar="Terminar sessao\?"/);
    assert.match(texto, /data-confirmar-titulo="Terminar sessao"/);
    assert.match(texto, /data-confirmar-cancelar="Continuar aqui"/);
    assert.match(texto, /data-confirmar-perigo="1"/);
    assert.ok(texto.indexOf('onsubmit=') === -1);
  });

  test('O botao de limpar a lista existe e a confirmacao vive no /js/gim.js', async () => {
    const texto = await html(funcionario, '/gim');

    assert.match(texto, /id="gimLimpar"/);
    assert.ok(texto.indexOf('confirm(') === -1);
    assert.match(texto, /src="\/js\/gim\.js"/);
  });
});

describe('Os ficheiros de cliente ja nao usam dialogos nativos', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const DIR = path.join(__dirname, '..', '..', 'public', 'js');

  for (const ficheiro of fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
    test(`public/js/${ficheiro} nao chama confirm()/alert()/prompt()`, () => {
      const codigo = fs.readFileSync(path.join(DIR, ficheiro), 'utf8');
      // Ignora comentarios: o que interessa e a CHAMADA.
      const semComentarios = codigo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

      assert.doesNotMatch(semComentarios, /(^|[^.\w])confirm\s*\(/, 'confirm() nativo');
      assert.doesNotMatch(semComentarios, /(^|[^.\w])alert\s*\(/, 'alert() nativo');
      assert.doesNotMatch(semComentarios, /(^|[^.\w])prompt\s*\(/, 'prompt() nativo');
    });
  }

  test('/js/confirmar.js e servido como ficheiro estatico', async () => {
    const res = await request(app).get('/js/confirmar.js');

    assert.equal(res.status, 200);
    assert.match(res.text, /Confirmar/);
  });
});
