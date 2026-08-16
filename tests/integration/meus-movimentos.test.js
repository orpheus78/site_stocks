'use strict';

/**
 * OS MEUS MOVIMENTOS (/gim/meus-movimentos)
 *
 * Dois pontos criticos:
 *
 * 1. O filtro por utilizador e imposto no SERVIDOR, a partir de
 *    req.session.utilizador.id. Um funcionario NAO pode ver os movimentos de
 *    outra pessoa mexendo no URL. Por isso os handlers do fakeDb GUARDAM os
 *    parametros que chegaram ao SQL: nao basta verificar o que aparece no
 *    ecra, e preciso provar que o id que foi para a consulta e o da sessao.
 *
 * 2. O operador PODE anular movimentos SEUS, mas so enquanto a sessao de caixa
 *    em que foram registados continuar aberta. Todas as condicoes sao
 *    verificadas contra a BASE DE DADOS (dono real, estado real, estado real
 *    da caixa), nunca contra o que vem no pedido.
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');
const { hojeISO } = require('../../src/utils');

const RAIZ = path.join(__dirname, '..', '..');

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

// Sessoes de caixa: uma aberta e uma ja fechada. E o que decide se o operador
// ainda pode anular um movimento seu.
const SESSAO_ABERTA = 10;
const SESSAO_FECHADA = 11;

const SESSOES = [
  { id: SESSAO_ABERTA, estado: 'aberta' },
  { id: SESSAO_FECHADA, estado: 'fechada' }
];

// Movimentos de duas pessoas diferentes. So os do funcionario (id 2) podem
// aparecer quando e o funcionario a consultar.
//
// Cobrem os quatro casos de anulacao pelo proprio operador:
//   101 -> dele, concluida, caixa ABERTA   => pode anular
//   102 -> dele, JA ANULADA                => nao
//   103 -> dele, concluida, caixa FECHADA  => nao
//   104 -> dele, concluida, SEM caixa      => nao (consumo orfao)
//   900 -> de OUTRA pessoa                 => nao (nem sequer o ve)
const MOVIMENTOS_BASE = [
  {
    id: 101,
    numero: 41,
    total: 3.5,
    estado: 'concluida',
    criado_em: new Date(2026, 0, 5, 10, 15),
    utilizador_id: 2,
    sessao_caixa_id: SESSAO_ABERTA,
    n_itens: 2
  },
  {
    id: 102,
    numero: 42,
    total: 1.2,
    estado: 'anulada',
    criado_em: new Date(2026, 0, 5, 11, 0),
    utilizador_id: 2,
    sessao_caixa_id: SESSAO_ABERTA,
    n_itens: 1
  },
  {
    id: 103,
    numero: 43,
    total: 2.0,
    estado: 'concluida',
    criado_em: new Date(2026, 0, 5, 9, 0),
    utilizador_id: 2,
    sessao_caixa_id: SESSAO_FECHADA,
    n_itens: 1
  },
  {
    id: 104,
    numero: 44,
    total: 5.0,
    estado: 'concluida',
    criado_em: new Date(2026, 0, 5, 8, 0),
    utilizador_id: 2,
    sessao_caixa_id: null,
    n_itens: 1
  },
  {
    id: 900,
    numero: 90,
    total: 99.99,
    estado: 'concluida',
    criado_em: new Date(2026, 0, 5, 12, 0),
    utilizador_id: 1,
    sessao_caixa_id: SESSAO_ABERTA,
    n_itens: 7
  }
];

const ITENS = {
  101: [{ id: 1, consumo_id: 101, artigo_id: 7, quantidade: 2, nome_snapshot: 'Agua' }],
  103: [{ id: 2, consumo_id: 103, artigo_id: 7, quantidade: 1, nome_snapshot: 'Agua' }],
  104: [{ id: 3, consumo_id: 104, artigo_id: 7, quantidade: 1, nome_snapshot: 'Agua' }],
  900: [{ id: 4, consumo_id: 900, artigo_id: 7, quantidade: 1, nome_snapshot: 'Agua' }]
};

// Estado mutavel, reposto a cada teste (ver beforeEach).
let MOVIMENTOS = [];
let stockDoArtigo7 = 0;
let movimentosStockRegistados = [];

function reporEstado() {
  MOVIMENTOS = MOVIMENTOS_BASE.map((m) => ({ ...m }));
  stockDoArtigo7 = 0;
  movimentosStockRegistados = [];
}

function movimentoPorId(id) {
  return MOVIMENTOS.find((m) => Number(m.id) === Number(id)) || null;
}

/** Ultima chamada a consulta de "movimentos de um utilizador". */
let ultimaConsulta = null;

function handlers() {
  return [
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => UTILIZADORES.filter((u) => u.username === username)
    },
    { pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i, handler: () => [] },

    // A consulta nova. Tem de vir ANTES dos padroes genericos de consumos.
    {
      pattern: /FROM consumos v[\s\S]*WHERE v\.utilizador_id = \?/i,
      handler: (params) => {
        ultimaConsulta = { utilizadorId: params[0], params: params.slice() };
        // Filtra mesmo pelo id recebido: se o servidor passar o id errado,
        // o teste ve as linhas erradas (ou nenhuma).
        return MOVIMENTOS.filter((m) => Number(m.utilizador_id) === Number(params[0])).map((m) => ({
          ...m,
          // O LEFT JOIN a sessoes_caixa que o repositorio faz.
          sessao_estado: (SESSOES.find((s) => s.id === m.sessao_caixa_id) || {}).estado || null
        }));
      }
    },

    // --- anulacao -----------------------------------------------------------
    {
      pattern: /FROM consumos WHERE id = \? FOR UPDATE/i,
      handler: ([id]) => {
        const m = movimentoPorId(id);
        return m ? [m] : [];
      }
    },
    {
      pattern: /FROM sessoes_caixa WHERE id = \? FOR UPDATE/i,
      handler: ([id]) => SESSOES.filter((s) => Number(s.id) === Number(id))
    },
    {
      pattern: /FROM consumo_itens WHERE consumo_id = \?/i,
      handler: ([id]) => ITENS[Number(id)] || []
    },
    { pattern: /INSERT INTO stocks/i, handler: () => ({ insertId: 1 }) },
    {
      pattern: /FROM stocks WHERE artigo_id = \? FOR UPDATE/i,
      handler: ([artigoId]) => [
        { id: 1, artigo_id: artigoId, quantidade: stockDoArtigo7, stock_minimo: 0, unidade: 'un' }
      ]
    },
    {
      pattern: /UPDATE stocks SET quantidade/i,
      handler: ([quantidade]) => {
        stockDoArtigo7 = Number(quantidade);
        return { affectedRows: 1 };
      }
    },
    {
      pattern: /INSERT INTO movimentos_stock/i,
      handler: (params) => {
        movimentosStockRegistados.push(params);
        return { insertId: movimentosStockRegistados.length };
      }
    },
    {
      pattern: /UPDATE consumos SET estado = 'anulada'/i,
      handler: ([id]) => {
        const m = movimentoPorId(id);
        if (m) m.estado = 'anulada';
        return { affectedRows: m ? 1 : 0 };
      }
    },

    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [] },
    { pattern: /FROM stocks s/i, handler: () => [] },
    { pattern: /FROM artigos a/i, handler: () => [] },
    { pattern: /FROM categorias/i, handler: () => [] }
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
  reporEstado();
  ({ app } = loadAppWithFakeDb(handlers()));
  admin = await sessaoDe(ADMIN);
  funcionario = await sessaoDe(FUNCIONARIO);
});

beforeEach(() => {
  ultimaConsulta = null;
  reporEstado();
});

// ---------------------------------------------------------------------------

describe('O funcionario consulta os SEUS movimentos', () => {
  test('GET /gim/meus-movimentos responde 200', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');
    assert.equal(res.status, 200);
    assert.match(res.text, /Os meus movimentos/);
  });

  test('Mostra os movimentos dele e NENHUM de outra pessoa', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');

    assert.match(res.text, /#41/);
    assert.match(res.text, /#42/);
    assert.ok(res.text.indexOf('#90') === -1, 'nao pode aparecer o movimento do admin');
    assert.ok(res.text.indexOf('99.99') === -1, 'nao pode aparecer o total do admin');
  });

  test('Mostra numero, data/hora, nr de itens, total e estado', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');

    assert.match(res.text, /#41/); // numero
    assert.match(res.text, /05\/01\/2026 10:15/); // data/hora
    assert.match(res.text, /2 artigos/); // nr de itens
    assert.match(res.text, /3\.50 €/); // total
    assert.match(res.text, /Concluido/); // estado
    assert.match(res.text, /Anulado/);
  });

  test('Por omissao mostra o dia de hoje', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');
    assert.equal(res.status, 200);

    const hoje = hojeISO();
    assert.deepEqual(ultimaConsulta.params.slice(1, 3), [`${hoje} 00:00:00`, `${hoje} 23:59:59`]);
  });

  test('Aceita outro periodo pelos filtros de/ate', async () => {
    const res = await funcionario.get('/gim/meus-movimentos?de=2026-01-01&ate=2026-01-31');
    assert.equal(res.status, 200);

    assert.deepEqual(ultimaConsulta.params.slice(1, 3), ['2026-01-01 00:00:00', '2026-01-31 23:59:59']);
  });

  test('Uma data invalida cai no dia de hoje (nao rebenta nem faz redirect)', async () => {
    const res = await funcionario.get('/gim/meus-movimentos?de=NAO-E-DATA&ate=../../etc');
    assert.equal(res.status, 200);

    const hoje = hojeISO();
    assert.deepEqual(ultimaConsulta.params.slice(1, 3), [`${hoje} 00:00:00`, `${hoje} 23:59:59`]);
  });

  test('O admin tambem tem acesso, e ve os SEUS proprios movimentos', async () => {
    const res = await admin.get('/gim/meus-movimentos');

    assert.equal(res.status, 200);
    assert.equal(Number(ultimaConsulta.utilizadorId), ADMIN.id);
    assert.match(res.text, /#90/);
    assert.ok(res.text.indexOf('#41') === -1, 'o admin nao ve aqui os movimentos do funcionario');
  });

  test('Ha ligacao visivel entre o GIM e este ecra, nos dois sentidos', async () => {
    const ecraGim = await funcionario.get('/gim');
    assert.equal(ecraGim.status, 200);
    assert.match(ecraGim.text, /href="\/gim\/meus-movimentos"/);

    const meus = await funcionario.get('/gim/meus-movimentos');
    assert.match(meus.text, /href="\/gim"/);
  });
});

describe('SEGURANCA: o dono dos movimentos vem da sessao, nunca do pedido', () => {
  // Todas as formas plausiveis de tentar forcar outro utilizador pelo URL.
  const TENTATIVAS = [
    '?utilizador_id=1',
    '?utilizador_id[]=1',
    '?utilizadorId=1',
    '?utilizador_id=1&de=2020-01-01&ate=2030-01-01',
    '?id=1',
    '?user=1',
    '?utilizador_id=1&utilizador_id=2'
  ];

  for (const querystring of TENTATIVAS) {
    test(`GET /gim/meus-movimentos${querystring} continua a mostrar SO os do proprio`, async () => {
      const res = await funcionario.get(`/gim/meus-movimentos${querystring}`);

      assert.equal(res.status, 200);
      // A prova esta no parametro que chegou ao SQL: e o id da sessao (2).
      assert.equal(
        Number(ultimaConsulta.utilizadorId),
        FUNCIONARIO.id,
        'o id da consulta tem de vir da sessao, nunca da query string'
      );
      assert.ok(res.text.indexOf('#90') === -1, 'nao pode aparecer o movimento do admin');
      assert.ok(res.text.indexOf('99.99') === -1);
    });
  }

  test('Um POST com utilizador_id no corpo nao existe sequer como rota (404)', async () => {
    const res = await funcionario
      .post('/gim/meus-movimentos')
      .type('form')
      .send({ utilizador_id: '1' });

    assert.equal(res.status, 404);
  });

  test('Sem sessao, redireciona para /login (nunca mostra movimentos)', async () => {
    const res = await request(app).get('/gim/meus-movimentos');

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login\?next=/);
    assert.equal(ultimaConsulta, null, 'sem sessao nao pode chegar a consultar a base de dados');
  });

  test('O servico recusa um utilizadorId que nao seja um id valido', async () => {
    const consumosService = require('../../src/services/consumos.service');

    for (const invalido of [null, undefined, 0, -1, 'abc', '1 OR 1=1', {}]) {
      await assert.rejects(
        () => consumosService.listarDoUtilizador(invalido, {}),
        /Utilizador invalido/,
        `devia recusar ${JSON.stringify(invalido)}`
      );
    }
  });
});

describe('ANULAR: o operador pode anular movimentos SEUS com a caixa aberta', () => {
  const ANULAR = (id) => `/gim/meus-movimentos/${id}/anular`;

  test('Anula um movimento seu com a caixa ABERTA e o stock e reposto', async () => {
    assert.equal(movimentoPorId(101).estado, 'concluida');

    const res = await funcionario.post(ANULAR(101)).type('form').send({});

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/gim\/meus-movimentos/);
    assert.equal(movimentoPorId(101).estado, 'anulada');

    // Stock reposto: 2 unidades do artigo 7 voltaram (partia de 0).
    assert.equal(stockDoArtigo7, 2);
    assert.equal(movimentosStockRegistados.length, 1);
    const [artigoId, tipo, quantidade] = movimentosStockRegistados[0];
    assert.equal(Number(artigoId), 7);
    assert.equal(tipo, 'entrada');
    assert.equal(Number(quantidade), 2);
  });

  test('O movimento de stock da anulacao fica com o id de QUEM anulou', async () => {
    await funcionario.post(ANULAR(101)).type('form').send({});

    // A ordem dos parametros e a de movimentosStock.repo.registar:
    // artigo_id, tipo, quantidade, quantidade_apos, motivo, utilizador_id
    const [, , , , motivo, utilizadorId] = movimentosStockRegistados[0];
    assert.equal(Number(utilizadorId), FUNCIONARIO.id);
    assert.match(String(motivo), /Anulacao do movimento #41/);
  });

  test('NAO anula um movimento de OUTRO utilizador (403) e o movimento fica intacto', async () => {
    const res = await funcionario.post(ANULAR(900)).type('form').send({});

    assert.equal(res.status, 403);
    assert.equal(movimentoPorId(900).estado, 'concluida');
    assert.equal(stockDoArtigo7, 0, 'nao pode ter mexido em stock nenhum');
  });

  test('Manipular o id no corpo do pedido nao muda nada: o id vem do URL e o dono da BD', async () => {
    // Corpo a tentar apontar para o movimento do admin de todas as formas.
    const res = await funcionario
      .post(ANULAR(900))
      .type('form')
      .send({ id: '101', consumo_id: '101', utilizador_id: '2' });

    assert.equal(res.status, 403);
    assert.equal(movimentoPorId(900).estado, 'concluida');
    assert.equal(movimentoPorId(101).estado, 'concluida', 'nao pode ter anulado outro por engano');
  });

  test('NAO anula um movimento seu com a caixa JA FECHADA (403)', async () => {
    const res = await funcionario.post(ANULAR(103)).type('form').send({});

    assert.equal(res.status, 403);
    assert.equal(movimentoPorId(103).estado, 'concluida');
    assert.equal(stockDoArtigo7, 0);
  });

  test('NAO anula um movimento seu SEM sessao de caixa (consumo orfao, 403)', async () => {
    const res = await funcionario.post(ANULAR(104)).type('form').send({});

    assert.equal(res.status, 403);
    assert.equal(movimentoPorId(104).estado, 'concluida');
  });

  test('NAO anula duas vezes o mesmo movimento', async () => {
    const primeira = await funcionario.post(ANULAR(101)).type('form').send({});
    assert.equal(primeira.status, 302);
    assert.equal(movimentoPorId(101).estado, 'anulada');

    const segunda = await funcionario.post(ANULAR(101)).type('form').send({});
    assert.equal(segunda.status, 403);
    // Stock reposto UMA so vez.
    assert.equal(stockDoArtigo7, 2);
    assert.equal(movimentosStockRegistados.length, 1);
  });

  test('Um movimento ja anulado (102) tambem nao se anula', async () => {
    const res = await funcionario.post(ANULAR(102)).type('form').send({});
    assert.equal(res.status, 403);
  });

  test('A recusa da sempre a MESMA mensagem, sem revelar nada de terceiros', async () => {
    const doOutro = await funcionario.post(ANULAR(900)).type('form').send({});
    const caixaFechada = await funcionario.post(ANULAR(103)).type('form').send({});

    for (const res of [doOutro, caixaFechada]) {
      assert.match(res.text, /So pode anular movimentos seus enquanto a caixa estiver aberta/);
      // Nada do movimento de outra pessoa pode transparecer.
      assert.ok(res.text.indexOf('#90') === -1);
      assert.ok(res.text.indexOf('99.99') === -1);
      assert.ok(res.text.indexOf('Administrador') === -1);
    }
  });

  test('Sem sessao, o POST de anular nao chega a tocar na base de dados', async () => {
    const res = await request(app).post(ANULAR(101)).type('form').send({});

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
    assert.equal(movimentoPorId(101).estado, 'concluida');
  });

  test('Um POST SEM corpo nem Content-Type funciona na mesma (nao da 500)', async () => {
    // Regressao real: em Express 5 o `req.body` fica undefined quando o pedido
    // nao traz corpo. O supertest com .send({}) mascarava o problema; um
    // `curl -X POST` sem -d apanhava-o. Aqui vai mesmo sem corpo nenhum.
    const res = await funcionario.post(ANULAR(101));

    assert.equal(res.status, 302);
    assert.equal(movimentoPorId(101).estado, 'anulada');
  });

  test('Um POST sem corpo que devia ser recusado continua a dar 403 (nao 500)', async () => {
    const res = await funcionario.post(ANULAR(103));

    assert.equal(res.status, 403);
    assert.equal(movimentoPorId(103).estado, 'concluida');
  });

  test('Um id de movimento invalido nao passa a validacao', async () => {
    for (const idMau of ['abc', '0', '-1']) {
      const res = await funcionario.post(`/gim/meus-movimentos/${idMau}/anular`).type('form').send({});
      assert.ok(res.status >= 300, `id "${idMau}" nao devia ser aceite (recebido ${res.status})`);
      assert.notEqual(res.status, 200);
    }
  });
});

describe('ANULAR: o admin nao tem as restricoes do operador', () => {
  test('O admin anula um movimento seu mesmo estando so ele em jogo', async () => {
    const res = await admin.post('/gim/meus-movimentos/900/anular').type('form').send({});

    assert.equal(res.status, 302);
    assert.equal(movimentoPorId(900).estado, 'anulada');
  });

  test('O admin anula um movimento de OUTRO utilizador com a caixa ja fechada', async () => {
    // 103 e do funcionario e a caixa dele esta fechada: para o operador seria
    // 403, para o admin e uma operacao normal.
    const res = await admin.post('/gim/meus-movimentos/103/anular').type('form').send({});

    assert.equal(res.status, 302);
    assert.equal(movimentoPorId(103).estado, 'anulada');
  });

  test('O admin anula um consumo orfao (sem sessao de caixa)', async () => {
    const res = await admin.post('/gim/meus-movimentos/104/anular').type('form').send({});

    assert.equal(res.status, 302);
    assert.equal(movimentoPorId(104).estado, 'anulada');
  });

  test('A rota do backoffice continua a ser exclusiva de admin', async () => {
    // Isto NAO contradiz o requisito novo: o funcionario anula pelo GIM.
    // O backoffice (/admin/*) continua fechado ao perfil de balcao.
    const doFuncionario = await funcionario.post('/admin/consumos/101/anular').type('form').send({});
    assert.equal(doFuncionario.status, 403);
    assert.equal(movimentoPorId(101).estado, 'concluida');

    const doAdmin = await admin.post('/admin/consumos/101/anular').type('form').send({});
    assert.equal(doAdmin.status, 302);
    assert.equal(movimentoPorId(101).estado, 'anulada');
  });
});

describe('ANULAR: o botao so aparece quando a accao e mesmo possivel', () => {
  test('So o movimento anulavel tem formulario de anular', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');

    // 101: caixa aberta -> tem botao.
    assert.match(res.text, /action="\/gim\/meus-movimentos\/101\/anular"/);
    // 102 (anulada), 103 (caixa fechada), 104 (orfao) -> nao tem.
    for (const id of [102, 103, 104]) {
      assert.ok(
        res.text.indexOf(`/gim/meus-movimentos/${id}/anular`) === -1,
        `o movimento ${id} nao devia ter botao de anular`
      );
    }
  });

  test('Explica porque nao pode, em vez de deixar o cartao mudo', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');
    assert.match(res.text, /Caixa ja fechada: so o responsavel pode anular/);
  });

  test('O botao usa o modal de confirmacao e avisa que repoe stock', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');

    assert.match(res.text, /data-confirmar="Anular o movimento #41\?"/);
    assert.match(res.text, /data-confirmar-detalhe="[^"]*REPOSTO/);
    assert.match(res.text, /data-confirmar-perigo="1"/);
    // Continua sem qualquer JS inline nem dialogo nativo.
    for (const proibido of ['onclick=', 'onsubmit=', 'confirm(', 'alert(', 'prompt(']) {
      assert.ok(res.text.indexOf(proibido) === -1, `nao pode ter "${proibido}"`);
    }
  });

  test('Esconder o botao e SO usabilidade: a autorizacao esta no servico', async () => {
    const consumosService = require('../../src/services/consumos.service');

    // Espelho puro usado pela view.
    const base = { utilizador_id: 2, estado: 'concluida', sessao_caixa_id: 10, sessao_estado: 'aberta' };
    assert.equal(consumosService.podeOperadorAnular(base, 2), true);
    assert.equal(consumosService.podeOperadorAnular(base, 1), false, 'nao e dele');
    assert.equal(consumosService.podeOperadorAnular({ ...base, estado: 'anulada' }, 2), false);
    assert.equal(consumosService.podeOperadorAnular({ ...base, sessao_estado: 'fechada' }, 2), false);
    assert.equal(
      consumosService.podeOperadorAnular({ ...base, sessao_caixa_id: null, sessao_estado: null }, 2),
      false,
      'consumo orfao nunca e anulavel pelo operador'
    );
    assert.equal(consumosService.podeOperadorAnular(null, 2), false);
  });
});

describe('O ecra nao expoe informacao de gestao nem JS inline', () => {
  test('Nao mostra preco de custo nem margem', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');

    for (const proibido of ['custo', 'Custo', 'margem', 'Margem', 'preco_custo']) {
      assert.ok(res.text.indexOf(proibido) === -1, `nao pode aparecer "${proibido}"`);
    }
  });

  test('Zero JS inline e nenhum dialogo nativo', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');

    for (const proibido of ['onclick=', 'onsubmit=', 'onchange=', 'confirm(', 'alert(', 'prompt(']) {
      assert.ok(res.text.indexOf(proibido) === -1, `nao pode ter "${proibido}"`);
    }
    assert.match(res.text, /src="\/js\/confirmar\.js"/);
  });

  test('Reaproveita os estilos do GIM e todas as classes gim-* existem no CSS', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');
    assert.match(res.text, /\/css\/gim\.css/);
    assert.match(res.text, /class="[^"]*gim-body/);

    const css = fs.readFileSync(path.join(RAIZ, 'public/css/gim.css'), 'utf8');
    const usadas = new Set();
    for (const atributo of res.text.match(/class="[^"]*"/g) || []) {
      for (const nome of atributo.match(/gim-[a-z0-9-]+/g) || []) usadas.add(nome);
    }

    assert.ok(usadas.size > 5, `esperavam-se varias classes gim-, encontradas ${usadas.size}`);
    const semEstilo = [];
    for (const nome of usadas) {
      if (!new RegExp(`\\.${nome}(?![a-z0-9-])`).test(css)) semEstilo.push(nome);
    }
    assert.deepEqual(semEstilo, [], `classes sem estilo no gim.css: ${semEstilo.join(', ')}`);
  });

  test('Nao ha navbar de backoffice (o funcionario nao tem backoffice)', async () => {
    const res = await funcionario.get('/gim/meus-movimentos');
    assert.ok(res.text.indexOf('<nav class="navbar') === -1);
  });
});
