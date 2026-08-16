'use strict';

/**
 * GESTAO DE UTILIZADORES (/admin/utilizadores) — exclusiva do admin.
 *
 * O que se protege aqui:
 *   1. Autorizacao: o funcionario nunca entra (403), o anonimo vai ao login.
 *   2. UNICIDADE DO PIN. O login por PIN nao pede username (auth.service):
 *      dois PINs iguais fariam os movimentos ficar atribuidos a pessoa errada.
 *      Como os hashes bcrypt tem salts diferentes, nenhum indice unico resolve
 *      isto -- tem de ser validado no servico, e e isso que se testa.
 *   3. AUTO-BLOQUEIO. Um admin nao se desactiva nem se despromove a si proprio,
 *      e o ultimo admin activo nao pode ser desactivado nem despromovido.
 *   4. Password e PIN nunca sao guardados em claro nem aparecem no HTML.
 *   5. Na edicao, password/PIN em branco NAO apagam o hash existente.
 *
 * O fakeDb aqui e uma pequena tabela `utilizadores` em memoria: so assim se
 * pode verificar o que ficou MESMO gravado (hashes, ativo, role).
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadAppWithFakeDb } = require('../helpers/fakeDb');

const PASSWORD = 'password-de-teste-123';
// rounds baixos NOS DADOS DE PARTIDA: mantem a suite rapida. O codigo em teste
// continua a usar SALT_ROUNDS = 12 (e isso e verificado mais abaixo).
const HASH = bcrypt.hashSync(PASSWORD, 4);

const PIN_ADMIN = '1234';
const PIN_FUNCIONARIO = '4321';

const ADMIN = {
  id: 1,
  nome: 'Administrador',
  username: 'admin.teste',
  password_hash: HASH,
  pin_hash: bcrypt.hashSync(PIN_ADMIN, 4),
  role: 'admin',
  ativo: 1,
  criado_em: new Date(2026, 0, 1, 9, 0)
};

const FUNCIONARIO = {
  id: 2,
  nome: 'Funcionario Bar',
  username: 'bar.teste',
  password_hash: HASH,
  pin_hash: bcrypt.hashSync(PIN_FUNCIONARIO, 4),
  role: 'funcionario',
  ativo: 1,
  criado_em: new Date(2026, 0, 1, 9, 0)
};

// -------------------------------------------------- tabela `utilizadores` fake

let tabela = [];
let proximoId = 3;

function reset() {
  tabela = [{ ...ADMIN }, { ...FUNCIONARIO }];
  proximoId = 3;
}

function porId(id) {
  return tabela.find((u) => Number(u.id) === Number(id)) || null;
}

function seguro(u) {
  return {
    id: u.id,
    nome: u.nome,
    username: u.username,
    role: u.role,
    ativo: u.ativo,
    criado_em: u.criado_em,
    tem_pin: u.pin_hash ? 1 : 0
  };
}

/** A ordem importa: o primeiro padrao que casar com o SQL ganha. */
function handlers() {
  return [
    // --- escrita (padroes mais especificos primeiro) ---
    {
      pattern: /INSERT INTO utilizadores/i,
      handler: ([nome, username, passwordHash, pinHash, role, ativo]) => {
        const id = proximoId;
        proximoId += 1;
        tabela.push({
          id,
          nome,
          username,
          password_hash: passwordHash,
          pin_hash: pinHash,
          role,
          ativo,
          criado_em: new Date(2026, 0, 2, 9, 0)
        });
        return { insertId: id };
      }
    },
    {
      pattern: /UPDATE utilizadores SET password_hash/i,
      handler: ([hash, id]) => {
        porId(id).password_hash = hash;
        return { affectedRows: 1 };
      }
    },
    {
      pattern: /UPDATE utilizadores SET pin_hash/i,
      handler: ([hash, id]) => {
        porId(id).pin_hash = hash;
        return { affectedRows: 1 };
      }
    },
    {
      pattern: /UPDATE utilizadores SET ativo = \? WHERE id/i,
      handler: ([ativo, id]) => {
        porId(id).ativo = ativo;
        return { affectedRows: 1 };
      }
    },
    {
      pattern: /UPDATE utilizadores SET nome = \?/i,
      handler: ([nome, username, role, ativo, id]) => {
        Object.assign(porId(id), { nome, username, role, ativo });
        return { affectedRows: 1 };
      }
    },

    // --- leitura ---
    {
      pattern: /COUNT\(\*\) AS total FROM utilizadores/i,
      handler: () => [
        { total: tabela.filter((u) => u.role === 'admin' && Number(u.ativo) === 1).length }
      ]
    },
    {
      pattern: /FROM utilizadores WHERE username/i,
      handler: ([username]) => tabela.filter((u) => u.username === username)
    },
    {
      // CAMPOS_SEGUROS por id (formulario de edicao): sem hashes.
      pattern: /tem_pin\s+FROM utilizadores WHERE id/i,
      handler: ([id]) => (porId(id) ? [seguro(porId(id))] : [])
    },
    {
      // CAMPOS_SEGUROS na listagem: sem hashes.
      pattern: /tem_pin\s+FROM utilizadores ORDER BY nome/i,
      handler: () => tabela.map(seguro)
    },
    {
      pattern: /FROM utilizadores WHERE ativo = 1 AND pin_hash/i,
      handler: () => tabela.filter((u) => Number(u.ativo) === 1 && u.pin_hash)
    },
    {
      pattern: /FROM utilizadores WHERE pin_hash IS NOT NULL/i,
      handler: () => tabela.filter((u) => u.pin_hash)
    },
    {
      pattern: /FROM utilizadores WHERE id = \?/i,
      handler: ([id]) => (porId(id) ? [porId(id)] : [])
    },

    // Restante backoffice (para as paginas renderizarem).
    { pattern: /FROM sessoes_caixa[\s\S]*estado = 'aberta'/i, handler: () => [] },
    { pattern: /FROM stocks s/i, handler: () => [] },
    { pattern: /FROM artigos a/i, handler: () => [] },
    { pattern: /FROM categorias/i, handler: () => [] }
  ];
}

let app;
let admin;
let funcionario;
let utilizadoresService;

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
  reset();
  ({ app } = loadAppWithFakeDb(handlers()));
  utilizadoresService = require('../../src/services/utilizadores.service');
  admin = await sessaoDe(ADMIN);
  funcionario = await sessaoDe(FUNCIONARIO);
});

beforeEach(() => {
  reset();
});

/** Faz o POST e devolve a flash message que ficou na pagina seguinte. */
async function postComFlash(agente, rota, corpo, destino = '/admin/utilizadores') {
  const res = await agente.post(rota).type('form').send(corpo);
  assert.equal(res.status, 302, `${rota} devia redirecionar`);
  const pagina = await agente.get(res.headers.location || destino);
  return { redirect: res.headers.location, html: pagina.text };
}

const NOVO = {
  nome: 'Maria Balcao',
  username: 'maria',
  password: 'segredo-forte-1',
  pin: '5555',
  role: 'funcionario',
  ativo: '1'
};

// ---------------------------------------------------------------------------

describe('Autorizacao — a area e exclusiva do admin', () => {
  const ROTAS_GET = ['/admin/utilizadores', '/admin/utilizadores/novo', '/admin/utilizadores/1/editar'];

  for (const rota of ROTAS_GET) {
    test(`GET ${rota} responde 403 ao funcionario`, async () => {
      const res = await funcionario.get(rota);
      assert.equal(res.status, 403);
      assert.match(res.text, /Sem permissoes/);
    });
  }

  const ROTAS_POST = [
    { rota: '/admin/utilizadores', corpo: NOVO },
    { rota: '/admin/utilizadores/1', corpo: { ...NOVO, role: 'admin' } },
    { rota: '/admin/utilizadores/1/desactivar', corpo: {} },
    { rota: '/admin/utilizadores/2/activar', corpo: {} }
  ];

  for (const { rota, corpo } of ROTAS_POST) {
    test(`POST ${rota} responde 403 ao funcionario e nao altera nada`, async () => {
      const antes = JSON.stringify(tabela);
      const res = await funcionario.post(rota).type('form').send(corpo);

      assert.equal(res.status, 403);
      assert.equal(JSON.stringify(tabela), antes, 'a tabela nao pode ter sido tocada');
    });
  }

  for (const rota of ROTAS_GET) {
    test(`GET ${rota} sem sessao redireciona para /login`, async () => {
      const res = await request(app).get(rota);
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /^\/login\?next=/);
    });
  }

  test('GET /admin/utilizadores e permitido ao admin', async () => {
    const res = await admin.get('/admin/utilizadores');
    assert.equal(res.status, 200);
    assert.match(res.text, /Utilizadores/);
  });

  test('O funcionario nao ve o atalho para a gestao de utilizadores', async () => {
    const res = await funcionario.get('/gim');
    assert.ok(res.text.indexOf('/admin/utilizadores') === -1);
  });
});

describe('Criar utilizador', () => {
  test('Cria com hash bcrypt de 12 rounds e nada em claro na base de dados', async () => {
    const { redirect } = await postComFlash(admin, '/admin/utilizadores', NOVO);
    assert.equal(redirect, '/admin/utilizadores');

    const criado = tabela.find((u) => u.username === 'maria');
    assert.ok(criado, 'o utilizador devia ter sido gravado');
    assert.equal(criado.nome, 'Maria Balcao');
    assert.equal(criado.role, 'funcionario');
    assert.equal(criado.ativo, 1);

    // Hashes bcrypt com SALT_ROUNDS = 12 (ver auth.service.hashPassword).
    assert.match(criado.password_hash, /^\$2[aby]\$12\$/);
    assert.match(criado.pin_hash, /^\$2[aby]\$12\$/);

    // Nada em claro, em campo nenhum.
    const registo = JSON.stringify(criado);
    assert.ok(registo.indexOf(NOVO.password) === -1, 'a password nao pode ficar em claro');
    assert.ok(registo.indexOf(NOVO.pin) === -1, 'o PIN nao pode ficar em claro');

    // E os hashes correspondem mesmo ao que foi introduzido.
    assert.ok(await bcrypt.compare(NOVO.password, criado.password_hash));
    assert.ok(await bcrypt.compare(NOVO.pin, criado.pin_hash));
  });

  test('O utilizador criado aparece na listagem, sem password nem PIN no HTML', async () => {
    await postComFlash(admin, '/admin/utilizadores', NOVO);
    const res = await admin.get('/admin/utilizadores');

    assert.match(res.text, /Maria Balcao/);
    assert.match(res.text, /maria/);
    assert.ok(res.text.indexOf(NOVO.password) === -1, 'a password nao pode aparecer no HTML');
    assert.ok(res.text.indexOf(NOVO.pin) === -1, 'o PIN nao pode aparecer no HTML');
    assert.ok(res.text.indexOf('$2a$') === -1, 'nem sequer o hash pode aparecer');
    assert.ok(res.text.indexOf('password_hash') === -1);
    assert.ok(res.text.indexOf('pin_hash') === -1);
  });

  test('O formulario de edicao nunca traz a password nem o PIN preenchidos', async () => {
    const res = await admin.get('/admin/utilizadores/2/editar');

    assert.equal(res.status, 200);
    assert.ok(res.text.indexOf(PASSWORD) === -1);
    assert.ok(res.text.indexOf(PIN_FUNCIONARIO) === -1);
    assert.ok(res.text.indexOf('$2a$') === -1);
    // Os campos existem, mas sem `value`.
    assert.match(res.text, /id="password"[^>]*>/);
    assert.match(res.text, /id="pin"[^>]*>/);
    assert.ok(!/id="password"[^>]*value=/.test(res.text));
    assert.ok(!/id="pin"[^>]*value=/.test(res.text));
  });
});

describe('Validacao (express-validator)', () => {
  const INVALIDOS = [
    { caso: 'username duplicado', corpo: { ...NOVO, username: 'bar.teste' }, erro: /Ja existe um utilizador/ },
    { caso: 'username vazio', corpo: { ...NOVO, username: '' }, erro: /obrigatorio/i },
    { caso: 'nome vazio', corpo: { ...NOVO, nome: '' }, erro: /Nome obrigatorio/ },
    { caso: 'PIN com 3 digitos', corpo: { ...NOVO, pin: '123' }, erro: /4 digitos/ },
    { caso: 'PIN com 5 digitos', corpo: { ...NOVO, pin: '12345' }, erro: /4 digitos/ },
    { caso: 'PIN nao numerico', corpo: { ...NOVO, pin: 'abcd' }, erro: /4 digitos/ },
    { caso: 'PIN vazio', corpo: { ...NOVO, pin: '' }, erro: /4 digitos/ },
    { caso: 'role invalido', corpo: { ...NOVO, role: 'superuser' }, erro: /Perfil invalido/ },
    { caso: 'role vazio', corpo: { ...NOVO, role: '' }, erro: /Perfil invalido/ },
    { caso: 'password curta', corpo: { ...NOVO, password: '123' }, erro: /pelo menos 8/ },
    { caso: 'password vazia', corpo: { ...NOVO, password: '' }, erro: /pelo menos 8/ }
  ];

  for (const { caso, corpo, erro } of INVALIDOS) {
    test(`Rejeita: ${caso}`, async () => {
      const antes = tabela.length;
      const res = await admin
        .post('/admin/utilizadores')
        .type('form')
        .set('referer', '/admin/utilizadores/novo')
        .send(corpo);

      assert.equal(res.status, 302, 'devia voltar ao formulario');
      assert.equal(tabela.length, antes, 'nada pode ter sido criado');

      const pagina = await admin.get('/admin/utilizadores/novo');
      assert.match(pagina.text, erro);
      // A mensagem de erro NUNCA pode repetir a credencial introduzida.
      assert.ok(pagina.text.indexOf(NOVO.password) === -1, 'a password nao pode aparecer no erro');
      assert.ok(pagina.text.indexOf(NOVO.pin) === -1, 'o PIN nao pode aparecer no erro');
    });
  }
});

describe('PONTO CRITICO 1 — unicidade do PIN', () => {
  test('CRIAR: um segundo utilizador com o PIN de alguem activo e rejeitado', async () => {
    const antes = tabela.length;
    const { html } = await postComFlash(
      admin,
      '/admin/utilizadores',
      { ...NOVO, pin: PIN_FUNCIONARIO },
      '/admin/utilizadores/novo'
    );

    assert.match(html, /Ja existe um utilizador activo com esse PIN\./);
    assert.equal(tabela.length, antes, 'nao pode ter sido criado nenhum utilizador');
  });

  test('CRIAR: o PIN do proprio admin tambem esta tomado', async () => {
    const antes = tabela.length;
    const { html } = await postComFlash(
      admin,
      '/admin/utilizadores',
      { ...NOVO, pin: PIN_ADMIN },
      '/admin/utilizadores/novo'
    );

    assert.match(html, /Ja existe um utilizador activo com esse PIN\./);
    assert.equal(tabela.length, antes);
  });

  test('EDITAR: nao se pode dar a alguem o PIN de outra pessoa', async () => {
    const { html } = await postComFlash(
      admin,
      '/admin/utilizadores/2',
      { nome: 'Funcionario Bar', username: 'bar.teste', password: '', pin: PIN_ADMIN, role: 'funcionario', ativo: '1' },
      '/admin/utilizadores/2/editar'
    );

    assert.match(html, /Ja existe um utilizador activo com esse PIN\./);
    // O PIN do funcionario NAO mudou: continua a ser o dele.
    assert.ok(await bcrypt.compare(PIN_FUNCIONARIO, porId(2).pin_hash));
    assert.ok(!(await bcrypt.compare(PIN_ADMIN, porId(2).pin_hash)));
  });

  test('EDITAR: manter o proprio PIN nao choca consigo mesmo', async () => {
    const { redirect } = await postComFlash(admin, '/admin/utilizadores/2', {
      nome: 'Funcionario Bar',
      username: 'bar.teste',
      password: '',
      pin: PIN_FUNCIONARIO,
      role: 'funcionario',
      ativo: '1'
    });

    assert.equal(redirect, '/admin/utilizadores');
    assert.ok(await bcrypt.compare(PIN_FUNCIONARIO, porId(2).pin_hash));
    // Voltou a ser hashado com 12 rounds.
    assert.match(porId(2).pin_hash, /^\$2[aby]\$12\$/);
  });

  test('Um PIN livre e aceite', async () => {
    const { redirect } = await postComFlash(admin, '/admin/utilizadores', { ...NOVO, pin: '9876' });

    assert.equal(redirect, '/admin/utilizadores');
    const criado = tabela.find((u) => u.username === 'maria');
    assert.ok(await bcrypt.compare('9876', criado.pin_hash));
  });

  test('Tambem se recusa o PIN de um utilizador DESACTIVADO (senao bastava reactiva-lo)', async () => {
    porId(2).ativo = 0;

    const antes = tabela.length;
    const { html } = await postComFlash(
      admin,
      '/admin/utilizadores',
      { ...NOVO, pin: PIN_FUNCIONARIO },
      '/admin/utilizadores/novo'
    );

    assert.match(html, /Ja existe um utilizador desactivado com esse PIN/);
    assert.equal(tabela.length, antes);
  });

  test('Depois de criar, o login por PIN autentica a pessoa CERTA', async () => {
    await postComFlash(admin, '/admin/utilizadores', { ...NOVO, pin: '9876' });
    const criado = tabela.find((u) => u.username === 'maria');

    const authService = require('../../src/services/auth.service');
    const sessao = await authService.autenticarPorPin('9876');

    assert.equal(sessao.id, criado.id);
    assert.equal(sessao.username, 'maria');
    assert.equal(sessao.role, 'funcionario');
    // E a sessao nao leva credenciais nenhumas.
    assert.deepEqual(Object.keys(sessao).sort(), ['id', 'nome', 'role', 'username']);
  });
});

describe('PONTO CRITICO 2 — o admin nao se pode auto-bloquear', () => {
  test('Nao se pode desactivar a si proprio (rota de desactivar)', async () => {
    const { html } = await postComFlash(admin, '/admin/utilizadores/1/desactivar', {});

    assert.match(html, /Nao pode desactivar a sua propria conta\./);
    assert.equal(Number(porId(1).ativo), 1, 'o admin tem de continuar activo');
  });

  test('Nao se pode desactivar a si proprio (formulario de edicao, sem a checkbox)', async () => {
    const { html } = await postComFlash(
      admin,
      '/admin/utilizadores/1',
      { nome: 'Administrador', username: 'admin.teste', password: '', pin: '', role: 'admin' },
      '/admin/utilizadores/1/editar'
    );

    assert.match(html, /Nao pode desactivar a sua propria conta\./);
    assert.equal(Number(porId(1).ativo), 1);
  });

  test('Nao se pode despromover a si proprio para funcionario', async () => {
    // Existe outro admin, para isolar a regra "a si proprio" da regra "ultimo admin".
    tabela.push({ ...ADMIN, id: 9, username: 'outro.admin', nome: 'Outro Admin', pin_hash: null });

    const { html } = await postComFlash(
      admin,
      '/admin/utilizadores/1',
      { nome: 'Administrador', username: 'admin.teste', password: '', pin: '', role: 'funcionario', ativo: '1' },
      '/admin/utilizadores/1/editar'
    );

    assert.match(html, /Nao pode retirar a si proprio o perfil de administrador\./);
    assert.equal(porId(1).role, 'admin');
  });

  test('A listagem nao oferece o botao de desactivar na linha do proprio', async () => {
    const res = await admin.get('/admin/utilizadores');

    assert.ok(res.text.indexOf('/admin/utilizadores/1/desactivar') === -1);
    assert.match(res.text, /a sua conta/);
  });

  test('O ULTIMO admin activo nao pode ser desactivado', async () => {
    // Cenario limite: quem age nao e o proprio (autorId diferente).
    await assert.rejects(
      () => utilizadoresService.desactivar(1, 999),
      /ultimo administrador activo/,
      'devia recusar deixar o sistema sem admin'
    );
    assert.equal(Number(porId(1).ativo), 1);
  });

  test('O ULTIMO admin activo nao pode ser despromovido', async () => {
    await assert.rejects(
      () =>
        utilizadoresService.atualizar(
          1,
          {
            nome: 'Administrador',
            username: 'admin.teste',
            password: '',
            pin: '',
            role: 'funcionario',
            ativo: true
          },
          999
        ),
      /ultimo administrador activo/
    );
    assert.equal(porId(1).role, 'admin');
  });

  test('Havendo dois admins activos, ja se pode desactivar um deles', async () => {
    tabela.push({ ...ADMIN, id: 9, username: 'outro.admin', nome: 'Outro Admin', pin_hash: null });

    const { html } = await postComFlash(admin, '/admin/utilizadores/9/desactivar', {});

    assert.match(html, /foi desactivado/);
    assert.equal(Number(porId(9).ativo), 0);
    // Soft-delete: o registo continua la (o historico de consumos aponta para ca).
    assert.ok(porId(9), 'o utilizador nao pode ser apagado fisicamente');
  });

  test('Desactivar um funcionario e permitido e nao apaga o registo', async () => {
    const { html } = await postComFlash(admin, '/admin/utilizadores/2/desactivar', {});

    assert.match(html, /foi desactivado/);
    assert.equal(Number(porId(2).ativo), 0);
    assert.equal(tabela.length, 2, 'nao pode haver DELETE fisico');

    // E deixa de aparecer no login por PIN.
    const authService = require('../../src/services/auth.service');
    await assert.rejects(() => authService.autenticarPorPin(PIN_FUNCIONARIO), /PIN invalido/);
  });
});

describe('Editar — password e PIN em branco NAO apagam o hash', () => {
  test('Guardar sem password nem PIN mantem os hashes que ja la estavam', async () => {
    const passwordAntes = porId(2).password_hash;
    const pinAntes = porId(2).pin_hash;

    const { redirect } = await postComFlash(admin, '/admin/utilizadores/2', {
      nome: 'Funcionario Bar (novo nome)',
      username: 'bar.teste',
      password: '',
      pin: '',
      role: 'funcionario',
      ativo: '1'
    });

    assert.equal(redirect, '/admin/utilizadores');
    assert.equal(porId(2).nome, 'Funcionario Bar (novo nome)');
    assert.equal(porId(2).password_hash, passwordAntes, 'o hash da password nao pode mudar');
    assert.equal(porId(2).pin_hash, pinAntes, 'o hash do PIN nao pode mudar');
    assert.ok(porId(2).pin_hash, 'o PIN nao pode ter sido apagado');

    // E as credenciais antigas continuam a funcionar.
    const authService = require('../../src/services/auth.service');
    const sessao = await authService.autenticar('bar.teste', PASSWORD);
    assert.equal(sessao.id, 2);
    const porPin = await authService.autenticarPorPin(PIN_FUNCIONARIO);
    assert.equal(porPin.id, 2);
  });

  test('Indicar uma password nova substitui apenas a password', async () => {
    const pinAntes = porId(2).pin_hash;

    await postComFlash(admin, '/admin/utilizadores/2', {
      nome: 'Funcionario Bar',
      username: 'bar.teste',
      password: 'outra-password-99',
      pin: '',
      role: 'funcionario',
      ativo: '1'
    });

    assert.equal(porId(2).pin_hash, pinAntes, 'o PIN nao devia ter sido tocado');
    assert.match(porId(2).password_hash, /^\$2[aby]\$12\$/);
    assert.ok(await bcrypt.compare('outra-password-99', porId(2).password_hash));
    assert.ok(!(await bcrypt.compare(PASSWORD, porId(2).password_hash)));
  });

  test('Indicar um PIN novo substitui apenas o PIN', async () => {
    const passwordAntes = porId(2).password_hash;

    await postComFlash(admin, '/admin/utilizadores/2', {
      nome: 'Funcionario Bar',
      username: 'bar.teste',
      password: '',
      pin: '7777',
      role: 'funcionario',
      ativo: '1'
    });

    assert.equal(porId(2).password_hash, passwordAntes);
    assert.ok(await bcrypt.compare('7777', porId(2).pin_hash));
  });
});

describe('Confirmacao pelo modal (zero JS inline)', () => {
  test('A desactivacao usa data-confirmar e nao confirm()', async () => {
    const res = await admin.get('/admin/utilizadores');

    assert.match(res.text, /action="\/admin\/utilizadores\/2\/desactivar"/);
    assert.match(res.text, /data-confirmar="Desactivar «Funcionario Bar»\?"/);
    assert.match(res.text, /data-confirmar-titulo="Desactivar utilizador"/);
    assert.match(res.text, /data-confirmar-perigo="1"/);

    for (const proibido of ['onclick=', 'onsubmit=', 'confirm(', 'alert(', 'prompt(']) {
      assert.ok(res.text.indexOf(proibido) === -1, `nao pode ter "${proibido}"`);
    }
    assert.match(res.text, /src="\/js\/confirmar\.js"/);
  });

  test('O formulario de utilizador tambem nao tem JS inline', async () => {
    for (const rota of ['/admin/utilizadores/novo', '/admin/utilizadores/2/editar']) {
      const res = await admin.get(rota);
      assert.equal(res.status, 200);
      for (const proibido of ['onclick=', 'onsubmit=', 'onchange=', 'confirm(', 'alert(', 'prompt(']) {
        assert.ok(res.text.indexOf(proibido) === -1, `${rota} nao pode ter "${proibido}"`);
      }
    }
  });
});

describe('Nao existe DELETE fisico de utilizadores', () => {
  test('Nao ha rota de eliminar', async () => {
    const res = await admin.post('/admin/utilizadores/2/eliminar').type('form').send({});
    assert.equal(res.status, 404);
    assert.equal(tabela.length, 2);
  });

  test('O repositorio nao expoe nenhuma funcao de remocao', () => {
    const repo = require('../../src/repositories/utilizadores.repo');
    assert.equal(typeof repo.remover, 'undefined');
    assert.equal(typeof repo.eliminar, 'undefined');
    assert.equal(typeof repo.apagar, 'undefined');
  });

  test('O codigo do repositorio nao contem nenhum DELETE', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'repositories', 'utilizadores.repo.js'),
      'utf8'
    );
    assert.ok(!/DELETE\s+FROM\s+utilizadores/i.test(fonte), 'nunca pode haver DELETE de utilizadores');
  });
});
