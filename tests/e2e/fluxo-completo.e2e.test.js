'use strict';

/**
 * Testes end-to-end contra uma MariaDB REAL (contentor Docker).
 *
 * Cobrem o fluxo completo do bar: login -> abertura de caixa -> movimentos ->
 * anulacao -> movimentos de caixa -> fecho -> backoffice -> relatorios,
 * sempre com asserçoes diretas na base de dados (nao apenas na resposta HTTP).
 *
 * SEGURANCA / ISOLAMENTO
 *  - Corre sempre contra uma base de dados DEDICADA (TEST_DB_NAME, ex. `bar_test`),
 *    criada no inicio e ELIMINADA no fim. Nunca toca na BD de desenvolvimento.
 *  - Recusa-se a correr se a BD de teste tiver o mesmo nome da de desenvolvimento.
 *  - Credenciais lidas exclusivamente do ambiente (.env), nunca hardcoded.
 *
 * SKIP AUTOMATICO
 *  - Se nao houver MariaDB acessivel, o teste faz skip em vez de falhar, para
 *    que `npm test` continue a funcionar em maquinas sem Docker.
 *
 * REGRA DE NEGOCIO CENTRAL: nao existe IVA. O preco do artigo e o valor final.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

require('dotenv').config();

const RAIZ = path.join(__dirname, '..', '..');

// --- Configuracao da BD de teste (antes de qualquer require da aplicacao) ----
const TEST_DB = {
  host: process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.TEST_DB_USER || process.env.DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.TEST_DB_NAME || 'bar_test'
};

const BD_DESENVOLVIMENTO = process.env.DB_NAME || 'bar_campo';
if (TEST_DB.database === BD_DESENVOLVIMENTO) {
  throw new Error(
    `TEST_DB_NAME (${TEST_DB.database}) e igual a DB_NAME. Os testes E2E nunca podem correr contra a BD de desenvolvimento.`
  );
}

// A aplicacao e os scripts db/* leem DB_*. Redireciona-os para a BD de teste.
// `dotenv` nao sobrepoe variaveis ja definidas, por isso isto e definitivo.
const AMBIENTE_TESTE = {
  ...process.env,
  DB_HOST: TEST_DB.host,
  DB_PORT: String(TEST_DB.port),
  DB_USER: TEST_DB.user,
  DB_PASSWORD: TEST_DB.password,
  DB_NAME: TEST_DB.database,
  NODE_ENV: 'development'
};
Object.assign(process.env, {
  DB_HOST: AMBIENTE_TESTE.DB_HOST,
  DB_PORT: AMBIENTE_TESTE.DB_PORT,
  DB_USER: AMBIENTE_TESTE.DB_USER,
  DB_PASSWORD: AMBIENTE_TESTE.DB_PASSWORD,
  DB_NAME: AMBIENTE_TESTE.DB_NAME
});

const mariadb = require('mariadb');
const request = require('supertest');

// Credenciais do seed (db/seed.js). Sobreponiveis por ambiente, tal como o seed.
const ADMIN = {
  username: process.env.SEED_ADMIN_USERNAME || 'admin',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  pin: process.env.SEED_ADMIN_PIN || '1234'
};

// Perfil de consumo: so tem acesso ao GIM.
const FUNCIONARIO = {
  username: process.env.SEED_BAR_USERNAME || 'bar',
  password: process.env.SEED_BAR_PASSWORD || 'bar123',
  pin: process.env.SEED_BAR_PIN || '4321'
};

/** PNG 1x1 valido, para o teste de upload (evita depender de ficheiros externos). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Ligacao direta a BD para asserçoes, com as mesmas opcoes de tipos da app. */
function ligar(database) {
  return mariadb.createConnection({
    host: TEST_DB.host,
    port: TEST_DB.port,
    user: TEST_DB.user,
    password: TEST_DB.password,
    database,
    connectTimeout: 5000,
    decimalAsNumber: true,
    bigIntAsNumber: true,
    insertIdAsNumber: true
  });
}

async function mariadbDisponivel() {
  let conn;
  try {
    conn = await ligar(undefined);
    await conn.query('SELECT 1');
    return true;
  } catch (err) {
    console.warn(`[e2e] MariaDB indisponivel em ${TEST_DB.host}:${TEST_DB.port} -> ${err.message}`);
    return false;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

function correrScript(ficheiro) {
  return execFileSync(process.execPath, [path.join('db', ficheiro)], {
    cwd: RAIZ,
    env: AMBIENTE_TESTE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

test('E2E: fluxo completo do bar contra MariaDB real', async (t) => {
  if (!(await mariadbDisponivel())) {
    t.skip(
      `MariaDB de teste indisponivel em ${TEST_DB.host}:${TEST_DB.port}. ` +
        'Arrancar com `npm run db:up` para correr os testes E2E.'
    );
    return;
  }

  // --- Preparacao: BD de teste limpa + schema + seed (reutiliza db/*.js) -----
  let admin = await ligar(undefined);
  await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB.database}\``);
  await admin.end();

  correrScript('apply-schema.js');
  correrScript('seed.js');

  const bd = await ligar(TEST_DB.database);
  const app = require('../../src/app');
  const relatoriosRepo = require('../../src/repositories/relatorios.repo');
  const caixaService = require('../../src/services/caixa.service');
  const env = require('../../src/config/env');

  const uma = (sql, params = []) => bd.query(sql, params).then((r) => r[0] || null);
  const artigoPorNome = (nome) =>
    uma(
      'SELECT a.id, a.nome, a.preco, s.quantidade, s.stock_minimo FROM artigos a JOIN stocks s ON s.artigo_id = a.id WHERE a.nome = ?',
      [nome]
    );

  const ficheirosUpload = [];
  let sessaoCaixaId = null;
  let consumoAnulavel = null;
  let consumoMultibanco = null;
  let consumoDinheiro = null;

  try {
    // Sanidade da preparacao: as 9 tabelas do schema e o seed aplicado.
    await t.test('Preparacao: schema com 9 tabelas e seed aplicado', async () => {
      const tabelas = await bd.query(
        'SELECT table_name AS nome FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
        [TEST_DB.database]
      );
      assert.deepEqual(
        tabelas.map((r) => r.nome).sort(),
        [
          'artigos',
          'categorias',
          'consumo_itens',
          'consumos',
          'movimentos_caixa',
          'movimentos_stock',
          'sessoes_caixa',
          'stocks',
          'utilizadores'
        ]
      );

      const contagens = await uma(
        `SELECT (SELECT COUNT(*) FROM utilizadores) AS utilizadores,
                (SELECT COUNT(*) FROM categorias)   AS categorias,
                (SELECT COUNT(*) FROM artigos)      AS artigos,
                (SELECT COUNT(*) FROM stocks)       AS stocks`
      );
      assert.equal(contagens.utilizadores, 2); // admin + funcionario
      assert.equal(contagens.categorias, 6);
      assert.equal(contagens.artigos, 24);
      assert.equal(contagens.stocks, 24);
    });

    // --- 1. Login (password) e login por PIN no GIM -------------------------
    const agente = request.agent(app);

    await t.test('1a. Login com o utilizador do seed cria sessao', async () => {
      const res = await agente
        .post('/login')
        .type('form')
        .send({ username: ADMIN.username, password: ADMIN.password });

      assert.equal(res.status, 302);
      // O admin entra no backoffice; o funcionario iria para /gim (ver 1c).
      assert.equal(res.headers.location, '/admin');

      // A sessao esta mesmo activa: o GIM responde sem redirecionar para /login.
      const gim = await agente.get('/gim');
      assert.equal(gim.status, 200);
    });

    await t.test('1b. Login por PIN no GIM autentica o mesmo utilizador', async () => {
      const agentePin = request.agent(app);
      const res = await agentePin.post('/gim/pin').type('form').send({ pin: ADMIN.pin });

      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/gim');

      const catalogo = await agentePin.get('/api/gim/artigos');
      assert.equal(catalogo.status, 200);
      assert.equal(catalogo.body.categorias.length, 6);
      assert.equal(catalogo.body.artigos.length, 24);

      // PIN errado nao autentica: volta ao /login com aviso e sem sessao.
      const agenteMau = request.agent(app);
      const mau = await agenteMau.post('/gim/pin').type('form').send({ pin: '9999' });
      assert.equal(mau.status, 302);
      assert.equal(mau.headers.location, '/login');

      const paginaLogin = await agenteMau.get('/login');
      assert.equal(paginaLogin.status, 200);
      assert.ok(paginaLogin.text.includes('PIN invalido.'), 'a pagina devia mostrar o aviso de PIN invalido');

      // E continua sem acesso ao GIM.
      const bloqueado = await agenteMau.get('/api/gim/artigos');
      assert.equal(bloqueado.status, 401);
    });

    // --- 2. Abertura de caixa ----------------------------------------------
    await t.test('2. Abrir sessao de caixa com fundo inicial de 50.00', async () => {
      const res = await agente.post('/caixa/abrir').type('form').send({ fundo_inicial: '50.00' });
      assert.equal(res.status, 302);

      const sessao = await uma("SELECT * FROM sessoes_caixa WHERE estado = 'aberta'");
      assert.ok(sessao, 'devia existir uma sessao de caixa aberta');
      assert.equal(sessao.fundo_inicial, 50);
      assert.equal(sessao.fechada_em, null);
      sessaoCaixaId = sessao.id;
    });

    // --- 3. Consumo com varios artigos ---------------------------------------
    await t.test('3. POST /api/consumos desconta stock e grava tudo corretamente', async () => {
      const cafe = await artigoPorNome('Cafe'); // 0.70, stock 200
      const imperial = await artigoPorNome('Imperial'); // 1.20, stock 150
      assert.equal(cafe.preco, 0.7);
      assert.equal(cafe.quantidade, 200);
      assert.equal(imperial.preco, 1.2);
      assert.equal(imperial.quantidade, 150);

      // 3 x 0.70 = 2.10 ; 2 x 1.20 = 2.40 ; total = 4.50 (sem IVA)
      // Cliente entrega 5.00 -> troco 0.50
      const res = await agente.post('/api/consumos').send({
        itens: [
          { artigo_id: cafe.id, quantidade: 3 },
          { artigo_id: imperial.id, quantidade: 2 }
        ],
        metodo_pagamento: 'dinheiro',
        valor_dinheiro: 5
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.consumo.total, 4.5);
      assert.equal(res.body.consumo.troco, 0.5);
      assert.equal(res.body.consumo.valor_dinheiro, 5);
      assert.equal(res.body.consumo.valor_multibanco, 0);
      assert.deepEqual(res.body.avisos, []);

      consumoAnulavel = res.body.consumo;

      // Stock decrementado EXATAMENTE.
      assert.equal((await artigoPorNome('Cafe')).quantidade, 197);
      assert.equal((await artigoPorNome('Imperial')).quantidade, 148);

      // Movimentos de stock do tipo 'consumo' com quantidade_apos correto.
      const movCafe = await uma(
        "SELECT * FROM movimentos_stock WHERE artigo_id = ? AND tipo = 'consumo' ORDER BY id DESC LIMIT 1",
        [cafe.id]
      );
      assert.equal(movCafe.quantidade, 3);
      assert.equal(movCafe.quantidade_apos, 197);
      assert.equal(movCafe.motivo, `Movimento #${consumoAnulavel.numero}`);

      const movImperial = await uma(
        "SELECT * FROM movimentos_stock WHERE artigo_id = ? AND tipo = 'consumo' ORDER BY id DESC LIMIT 1",
        [imperial.id]
      );
      assert.equal(movImperial.quantidade, 2);
      assert.equal(movImperial.quantidade_apos, 148);

      // Cabecalho do consumo gravado e associado a sessao de caixa aberta.
      const consumo = await uma('SELECT * FROM consumos WHERE id = ?', [consumoAnulavel.id]);
      assert.equal(consumo.total, 4.5);
      assert.equal(consumo.troco, 0.5);
      assert.equal(consumo.estado, 'concluida');
      assert.equal(consumo.metodo_pagamento, 'dinheiro');
      assert.equal(consumo.sessao_caixa_id, sessaoCaixaId);

      // Itens com snapshot de nome e preco unitario.
      const itens = await bd.query('SELECT * FROM consumo_itens WHERE consumo_id = ? ORDER BY id', [
        consumoAnulavel.id
      ]);
      assert.equal(itens.length, 2);
      assert.equal(itens[0].nome_snapshot, 'Cafe');
      assert.equal(itens[0].preco_unit, 0.7);
      assert.equal(itens[0].quantidade, 3);
      assert.equal(itens[0].subtotal, 2.1);
      assert.equal(itens[1].nome_snapshot, 'Imperial');
      assert.equal(itens[1].preco_unit, 1.2);
      assert.equal(itens[1].subtotal, 2.4);
    });

    // --- 4. Stock negativo: avisa, nunca bloqueia ---------------------------
    await t.test('4. Consumo acima do stock nao e bloqueado e devolve avisos', async () => {
      const gelado = await artigoPorNome('Gelado premium'); // 2.50, stock 20
      assert.equal(gelado.quantidade, 20);

      // 25 unidades com apenas 20 em stock -> -5, mas o consumo tem de passar.
      const res = await agente.post('/api/consumos').send({
        itens: [{ artigo_id: gelado.id, quantidade: 25 }],
        metodo_pagamento: 'multibanco'
      });

      assert.equal(res.status, 201, 'o consumo nunca pode ser bloqueado por falta de stock');
      assert.equal(res.body.consumo.total, 62.5);
      assert.equal(res.body.consumo.valor_multibanco, 62.5);
      assert.equal(res.body.consumo.valor_dinheiro, 0);
      assert.equal(res.body.consumo.troco, 0, 'nao ha troco em multibanco');

      assert.ok(Array.isArray(res.body.avisos) && res.body.avisos.length === 1, 'devia trazer 1 aviso');
      assert.match(res.body.avisos[0], /Gelado premium/);
      assert.match(res.body.avisos[0], /negativo/i);

      consumoMultibanco = res.body.consumo;

      // O stock ficou mesmo negativo e o movimento foi registado.
      assert.equal((await artigoPorNome('Gelado premium')).quantidade, -5);
      const mov = await uma(
        "SELECT * FROM movimentos_stock WHERE artigo_id = ? AND tipo = 'consumo' ORDER BY id DESC LIMIT 1",
        [gelado.id]
      );
      assert.equal(mov.quantidade_apos, -5);
    });

    // --- 5. Preco adulterado pelo cliente ----------------------------------
    await t.test('5. Preco enviado pelo cliente e ignorado: vale o preco da BD', async () => {
      const cola = await artigoPorNome('Coca-Cola'); // 1.50
      assert.equal(cola.preco, 1.5);

      const res = await agente.post('/api/consumos').send({
        itens: [{ artigo_id: cola.id, quantidade: 2, preco: 0.01, preco_unit: 0.01, subtotal: 0.02 }],
        metodo_pagamento: 'dinheiro'
      });

      assert.equal(res.status, 201);
      // 2 x 1.50 = 3.00 (preco da BD), nunca 2 x 0.01 = 0.02.
      assert.equal(res.body.consumo.total, 3);
      assert.equal(res.body.consumo.troco, 0);

      consumoDinheiro = res.body.consumo;

      const item = await uma('SELECT * FROM consumo_itens WHERE consumo_id = ?', [consumoDinheiro.id]);
      assert.equal(item.preco_unit, 1.5, 'o preco gravado tem de ser o da BD');
      assert.equal(item.subtotal, 3);
    });

    // --- 6. Sem comprovativo -----------------------------------------------
    // A aplicacao e de controlo INTERNO: nao emite talao nem comprovativo.
    // A rota antiga tem de estar mesmo morta (404), nao apenas escondida.
    await t.test('6. GET /gim/consumo/:id/talao ja nao existe (404)', async () => {
      const res = await agente.get(`/gim/consumo/${consumoAnulavel.id}/talao`);

      assert.equal(res.status, 404, 'a rota do talao tem de estar removida');
      assert.ok(!res.text.includes('bi-printer'), 'nao pode sobrar botao de imprimir');
      assert.ok(!res.text.includes('Comprovativo'), 'nao pode sobrar a palavra Comprovativo');
    });

    // --- 7. Anulacao de consumo ----------------------------------------------
    await t.test('7. Anular consumo repoe o stock e marca o consumo como anulado', async () => {
      const res = await agente.post(`/admin/consumos/${consumoAnulavel.id}/anular`).type('form').send({});
      assert.equal(res.status, 302);

      const consumo = await uma('SELECT * FROM consumos WHERE id = ?', [consumoAnulavel.id]);
      assert.equal(consumo.estado, 'anulada');

      // Stock reposto exatamente aos valores originais do seed.
      assert.equal((await artigoPorNome('Cafe')).quantidade, 200);
      assert.equal((await artigoPorNome('Imperial')).quantidade, 150);

      // Reposicao registada como movimento de 'entrada'.
      const cafe = await artigoPorNome('Cafe');
      const mov = await uma(
        "SELECT * FROM movimentos_stock WHERE artigo_id = ? AND tipo = 'entrada' ORDER BY id DESC LIMIT 1",
        [cafe.id]
      );
      assert.equal(mov.quantidade, 3);
      assert.equal(mov.quantidade_apos, 200);
      assert.equal(mov.motivo, `Anulacao do movimento #${consumoAnulavel.numero}`);

      // Anular duas vezes e conflito.
      const repetida = await agente
        .post(`/admin/consumos/${consumoAnulavel.id}/anular`)
        .set('Accept', 'application/json')
        .send({});
      assert.equal(repetida.status, 409);
    });

    // --- 8. Movimentos de caixa e fecho ------------------------------------
    await t.test('8. Fecho de caixa: multibanco nao entra no esperado', async () => {
      await agente
        .post('/caixa/movimento')
        .type('form')
        .send({ tipo: 'entrada', valor: '10.00', descricao: 'Reforco de trocos' });

      await agente
        .post('/caixa/movimento')
        .type('form')
        .send({ tipo: 'sangria', valor: '20.00', descricao: 'Deposito no cofre' });

      const movimentos = await bd.query('SELECT * FROM movimentos_caixa WHERE sessao_caixa_id = ? ORDER BY id', [
        sessaoCaixaId
      ]);
      assert.equal(movimentos.length, 2);
      assert.equal(movimentos[0].tipo, 'entrada');
      assert.equal(movimentos[0].valor, 10);
      assert.equal(movimentos[1].tipo, 'sangria');
      assert.equal(movimentos[1].valor, 20);

      // Consumos concluidos na sessao: o de multibanco (62.50) e o de dinheiro (3.00).
      // O primeiro consumo (4.50) foi anulado e NAO conta.
      const estado = await caixaService.estadoAtual();
      assert.equal(estado.resumo.n_consumos, 2);
      assert.equal(estado.resumo.consumos_dinheiro, 3);
      assert.equal(estado.resumo.consumos_multibanco, 62.5);
      assert.equal(estado.resumo.fundo_inicial, 50);
      assert.equal(estado.resumo.entradas, 10);
      assert.equal(estado.resumo.saidas, 0);
      assert.equal(estado.resumo.sangrias, 20);

      // esperado = 50 (fundo) + 3.00 (consumos em dinheiro) + 10 (entradas) - 20 (sangria) = 43.00
      // Nao ha movimentos internos nesta sessao, logo o agregado `interno` e 0.
      // Os 62.50 de multibanco NAO entram no dinheiro fisico em caixa.
      assert.equal(estado.resumo.movimentos_internos, 0);
      assert.equal(estado.resumo.esperado, 43);
      assert.notEqual(estado.resumo.esperado, 43 + 62.5, 'multibanco nao pode entrar no esperado');

      // Fecho com 40.00 contados -> diferenca de -3.00.
      const res = await agente.post('/caixa/fechar').type('form').send({ total_contado: '40.00' });
      assert.equal(res.status, 302);

      const sessao = await uma('SELECT * FROM sessoes_caixa WHERE id = ?', [sessaoCaixaId]);
      assert.equal(sessao.estado, 'fechada');
      assert.equal(sessao.total_contado, 40);
      assert.equal(sessao.diferenca, -3);
      assert.ok(sessao.fechada_em instanceof Date);
    });

    // --- 9. Upload de imagem via multer -------------------------------------
    await t.test('9. Criar artigo com upload de imagem guarda ficheiro e caminho na BD', async () => {
      const categoria = await uma("SELECT id FROM categorias WHERE nome = 'Snacks'");

      const res = await agente
        .post('/admin/artigos')
        .field('nome', 'Bolo caseiro')
        .field('preco', '1.75')
        .field('categoria_id', String(categoria.id))
        .field('ativo', 'on')
        .field('stock_inicial', '10')
        .field('stock_minimo', '2')
        .field('unidade', 'un')
        .attach('imagem', PNG_1X1, { filename: 'bolo.png', contentType: 'image/png' });

      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/admin/artigos');

      const artigo = await uma('SELECT * FROM artigos WHERE nome = ?', ['Bolo caseiro']);
      assert.ok(artigo, 'o artigo devia ter sido criado');
      assert.equal(artigo.preco, 1.75);
      assert.ok(artigo.imagem, 'o nome do ficheiro devia ficar gravado na BD');
      assert.match(artigo.imagem, /^[0-9a-f]{32}\.png$/, 'nome aleatorio, sem o nome original do cliente');

      // O ficheiro existe mesmo em disco, com o conteudo enviado.
      const caminho = path.join(env.uploads.dir, artigo.imagem);
      ficheirosUpload.push(caminho);
      assert.ok(fs.existsSync(caminho), `ficheiro ${caminho} devia existir`);
      assert.deepEqual(fs.readFileSync(caminho), PNG_1X1);

      // Stock inicial aplicado com o respetivo movimento.
      const stock = await uma('SELECT * FROM stocks WHERE artigo_id = ?', [artigo.id]);
      assert.equal(stock.quantidade, 10);
      assert.equal(stock.stock_minimo, 2);

      // Ficheiro de tipo nao permitido e recusado (e nada e gravado).
      const recusado = await agente
        .post('/admin/artigos')
        .field('nome', 'Artigo com PDF')
        .field('preco', '1.00')
        .attach('imagem', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' });
      assert.equal(recusado.status, 302);
      assert.equal(await uma('SELECT id FROM artigos WHERE nome = ?', ['Artigo com PDF']), null);
    });

    // --- 10. Relatorios -----------------------------------------------------
    await t.test('10. Relatorios batem certo com os numeros conferidos a mao', async () => {
      const hoje = require('../../src/utils').hojeISO();

      // Consumos concluidos de hoje: 62.50 (multibanco) + 3.00 (dinheiro) = 65.50.
      // O consumo de 4.50 esta anulada e nao conta em lado nenhum.
      const resumo = await relatoriosRepo.resumoConsumos(hoje, hoje);
      assert.equal(resumo.n_consumos, 2);
      assert.equal(resumo.total, 65.5);
      assert.equal(resumo.dinheiro, 3);
      assert.equal(resumo.multibanco, 62.5);
      assert.equal(resumo.ticket_medio, 32.75); // 65.50 / 2

      // Top artigos: 25 x Gelado premium, 2 x Coca-Cola. Nada do consumo anulado.
      const top = await relatoriosRepo.topArtigos(hoje, hoje, 10);
      assert.equal(top.length, 2);
      assert.equal(top[0].nome, 'Gelado premium');
      assert.equal(Number(top[0].quantidade), 25);
      assert.equal(Number(top[0].total), 62.5);
      assert.equal(top[1].nome, 'Coca-Cola');
      assert.equal(Number(top[1].quantidade), 2);
      assert.equal(Number(top[1].total), 3);
      assert.ok(!top.some((a) => a.nome === 'Cafe'), 'o consumo anulado nao pode aparecer no top');

      // Stock baixo: so o Gelado premium (-5 <= 5). Todos os outros estao acima do minimo.
      const stocksRepo = require('../../src/repositories/stocks.repo');
      const baixo = await stocksRepo.alertasStockBaixo();
      assert.equal(baixo.length, 1);
      assert.equal(baixo[0].artigo_nome, 'Gelado premium');
      assert.equal(Number(baixo[0].quantidade), -5);

      // Consumos por categoria: Gelados 62.50 e Bebidas 3.00.
      const porCategoria = await relatoriosRepo.consumosPorCategoria(hoje, hoje);
      const mapa = new Map(porCategoria.map((c) => [c.categoria, Number(c.total)]));
      assert.equal(mapa.get('Gelados'), 62.5);
      assert.equal(mapa.get('Bebidas'), 3);
      assert.equal(mapa.size, 2);
    });

    // --- 11. Separacao de perfis: funcionario so vende ----------------------
    await t.test('11. Funcionario vende numa caixa aberta pelo admin, sem acesso a gestao', async () => {
      const funcionarioBd = await uma('SELECT id, role FROM utilizadores WHERE username = ?', [
        FUNCIONARIO.username
      ]);
      assert.ok(funcionarioBd, 'o seed devia ter criado o utilizador de consumo');
      assert.equal(funcionarioBd.role, 'funcionario');

      // O responsavel abre a caixa (a anterior foi fechada no passo 8).
      const abertura = await agente.post('/caixa/abrir').type('form').send({ fundo_inicial: '25.00' });
      assert.equal(abertura.status, 302);
      const sessaoNova = await uma("SELECT id FROM sessoes_caixa WHERE estado = 'aberta'");
      assert.ok(sessaoNova, 'o admin devia ter aberto uma nova sessao de caixa');

      // O funcionario entra e cai no GIM (nunca no backoffice).
      const balcao = request.agent(app);
      const login = await balcao
        .post('/login')
        .type('form')
        .send({ username: FUNCIONARIO.username, password: FUNCIONARIO.password });
      assert.equal(login.status, 302);
      assert.equal(login.headers.location, '/gim');

      // Gestao e caixa estao vedadas -- 403, nao redirect para /login.
      for (const rota of ['/admin', '/admin/artigos', '/admin/relatorios', '/caixa']) {
        const bloqueado = await balcao.get(rota);
        assert.equal(bloqueado.status, 403, `${rota} devia dar 403 ao funcionario`);
      }
      const sangria = await balcao
        .post('/caixa/movimento')
        .type('form')
        .send({ tipo: 'sangria', valor: '10.00', descricao: 'tentativa' });
      assert.equal(sangria.status, 403);

      // Mas o GIM funciona: catalogo + consumo associada a caixa aberta pelo admin.
      const catalogo = await balcao.get('/api/gim/artigos');
      assert.equal(catalogo.status, 200);

      const agua = await artigoPorNome('Agua 0.5L'); // 0.80
      const stockAntes = Number(agua.quantidade);

      const consumo = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: agua.id, quantidade: 2 }],
        metodo_pagamento: 'dinheiro',
        valor_dinheiro: 2
      });

      assert.equal(consumo.status, 201);
      assert.equal(consumo.body.consumo.total, 1.6);
      assert.equal(consumo.body.consumo.troco, 0.4);

      // Gravada em nome do funcionario e no turno aberto pelo admin.
      const gravada = await uma('SELECT * FROM consumos WHERE id = ?', [consumo.body.consumo.id]);
      assert.equal(gravada.utilizador_id, funcionarioBd.id);
      assert.equal(gravada.sessao_caixa_id, sessaoNova.id);
      assert.equal(gravada.estado, 'concluida');

      // E o stock foi descontado na mesma.
      assert.equal(Number((await artigoPorNome('Agua 0.5L')).quantidade), stockAntes - 2);

      // O fecho continua a ser do responsavel.
      const fecho = await agente.post('/caixa/fechar').type('form').send({ total_contado: '26.60' });
      assert.equal(fecho.status, 302);
    });

    // --- 12. Alerta de stock baixo no GIM -----------------------------------
    // ACRESCENTADO NO FIM de proposito: os totais dos passos anteriores estao
    // verificados a mao e nao podem ser invalidados por consumos extra.
    await t.test('12. GIM sinaliza stock baixo no catalogo e avisa ao concluir o consumo', async () => {
      const balcao = request.agent(app);
      const login = await balcao
        .post('/login')
        .type('form')
        .send({ username: FUNCIONARIO.username, password: FUNCIONARIO.password });
      assert.equal(login.status, 302);

      // Given: Tremocos tem minimo 8 no seed. Coloca-se o stock em 10 (acima
      // do minimo) para que seja o CONSUMO a empurra-lo para baixo do minimo.
      const tremocos = await artigoPorNome('Tremocos');
      assert.equal(Number(tremocos.stock_minimo), 8);
      await bd.query('UPDATE stocks SET quantidade = 10 WHERE artigo_id = ?', [tremocos.id]);

      // O catalogo expoe o minimo e ainda nao ha alerta.
      const antes = await balcao.get('/api/gim/artigos');
      assert.equal(antes.status, 200);
      const artigoAntes = antes.body.artigos.find((a) => a.nome === 'Tremocos');
      assert.equal(artigoAntes.stock, 10);
      assert.equal(artigoAntes.stock_minimo, 8);
      assert.equal(artigoAntes.stock_baixo, false);

      // When: vende 3 -> fica com 7, abaixo do minimo de 8.
      const consumo = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: tremocos.id, quantidade: 3 }],
        metodo_pagamento: 'multibanco'
      });

      // Then: o consumo passa e traz um aviso classificado como stock_baixo.
      assert.equal(consumo.status, 201, 'o alerta de stock nunca pode bloquear o consumo');
      assert.equal(consumo.body.consumo.total, 4.5); // 3 x 1.50
      assert.equal(consumo.body.avisos_stock.length, 1);
      assert.equal(consumo.body.avisos_stock[0].tipo, 'stock_baixo');
      assert.equal(consumo.body.avisos_stock[0].artigo, 'Tremocos');
      assert.equal(consumo.body.avisos_stock[0].quantidade, 7);
      assert.equal(consumo.body.avisos_stock[0].stock_minimo, 8);
      assert.match(consumo.body.avisos[0], /Tremocos/);

      // E o catalogo passa a sinalizar o artigo (o GIM refresca apos o consumo).
      const depois = await balcao.get('/api/gim/artigos');
      const artigoDepois = depois.body.artigos.find((a) => a.nome === 'Tremocos');
      assert.equal(artigoDepois.stock, 7);
      assert.equal(artigoDepois.stock_baixo, true);

      // A regra do GIM e a MESMA do backoffice: o artigo aparece nos alertas
      // de /admin/stocks (que consulta quantidade <= stock_minimo na BD).
      const emFalta = await bd.query(
        'SELECT a.nome FROM stocks s JOIN artigos a ON a.id = s.artigo_id WHERE a.ativo = 1 AND s.quantidade <= s.stock_minimo'
      );
      assert.ok(
        emFalta.some((r) => r.nome === 'Tremocos'),
        'o backoffice tem de considerar o mesmo artigo em falta'
      );

      // O funcionario continua sem acesso a gestao (o painel de alertas do GIM
      // nao lhe da nenhum atalho para la).
      const gestao = await balcao.get('/admin/stocks');
      assert.equal(gestao.status, 403);
    });

    // --- 13. Movimentos internos: contam como dinheiro esperado em caixa -----
    // ACRESCENTADO NO FIM de proposito (ver nota do passo 12).
    await t.test('13. Movimento interno conta para o dinheiro esperado no fecho de caixa', async () => {
      const balcao = request.agent(app);
      await balcao
        .post('/login')
        .type('form')
        .send({ username: FUNCIONARIO.username, password: FUNCIONARIO.password });

      // Given: nao ha caixa aberta neste ponto (foi fechada no passo 11).
      const semCaixa = await uma("SELECT id FROM sessoes_caixa WHERE estado = 'aberta'");
      assert.equal(semCaixa, null);

      const agua = await artigoPorNome('Agua 0.5L'); // 0.80
      const stockAntes = Number(agua.quantidade);

      // When: o funcionario regista um movimento SEM metodo de pagamento.
      const mov = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: agua.id, quantidade: 3 }]
      });

      // Then: registado como interno, com total, sem dinheiro e sem troco.
      assert.equal(mov.status, 201, 'o registo nao pode exigir caixa aberta');
      assert.equal(mov.body.consumo.total, 2.4); // 3 x 0.80
      assert.equal(mov.body.consumo.metodo_pagamento, 'interno');
      assert.equal(mov.body.consumo.valor_dinheiro, 0);
      assert.equal(mov.body.consumo.troco, 0);

      const gravado = await uma('SELECT * FROM consumos WHERE id = ?', [mov.body.consumo.id]);
      assert.equal(gravado.metodo_pagamento, 'interno');
      assert.equal(Number(gravado.valor_dinheiro), 0);
      assert.equal(Number(gravado.valor_multibanco), 0);
      assert.equal(Number(gravado.troco), 0);
      assert.equal(gravado.sessao_caixa_id, null, 'sem caixa aberta o movimento fica sem sessao');
      assert.equal(gravado.estado, 'concluida');

      // O stock e descontado tal como antes.
      assert.equal(Number((await artigoPorNome('Agua 0.5L')).quantidade), stockAntes - 3);

      // Nao ha comprovativo nenhum para abrir: a rota foi removida.
      const talao = await balcao.get(`/gim/consumo/${mov.body.consumo.id}/talao`);
      assert.equal(talao.status, 404);

      // O GIM avisa (sem bloquear) que nao ha caixa aberta.
      const gimSemCaixa = await balcao.get('/gim');
      assert.equal(gimSemCaixa.status, 200);
      assert.match(gimSemCaixa.text, /Nao ha caixa aberta/);
      assert.match(gimSemCaixa.text, /Avise o responsavel/);
      assert.ok(
        !gimSemCaixa.text.includes('gim-aviso-caixa-btn'),
        'o funcionario nao pode ter atalho para abrir caixa'
      );

      // E o ecra de caixa (so do admin) sinaliza o dinheiro que ficou fora de
      // qualquer sessao. Neste ponto ha 2 movimentos sem caixa:
      //   4.50 (Tremocos, passo 12) + 2.40 (agua, agora) = 6.90
      const semSessao = await uma(
        "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM consumos WHERE sessao_caixa_id IS NULL AND estado = 'concluida'"
      );
      assert.equal(Number(semSessao.n), 2);
      assert.equal(Number(semSessao.total), 6.9);

      const ecraCaixa = await agente.get('/caixa');
      assert.equal(ecraCaixa.status, 200);
      assert.match(ecraCaixa.text, /movimentos sem caixa associada/);
      assert.ok(ecraCaixa.text.includes('6.90'), 'o aviso tem de mostrar o total fora de caixa');

      // E agora o essencial (CASO DO CLIENTE): com a caixa aberta, os
      // movimentos internos ENTRAM no valor esperado pelo seu total.
      const abertura = await agente.post('/caixa/abrir').type('form').send({ fundo_inicial: '30.00' });
      assert.equal(abertura.status, 302);

      const movComCaixa = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: agua.id, quantidade: 5 }] // 5 x 0.80 = 4.00
      });
      assert.equal(movComCaixa.status, 201);
      assert.equal(movComCaixa.body.consumo.total, 4);

      // esperado = 30 (fundo) + 4.00 (movimentos internos) = 34.00
      let estado = await caixaService.estadoAtual();
      assert.equal(estado.resumo.movimentos_internos, 4);
      assert.equal(estado.resumo.consumos_dinheiro, 0);
      assert.equal(estado.resumo.consumos_multibanco, 0);
      assert.equal(estado.resumo.esperado, 34);

      // Um movimento ANULADO nao pode contar para o esperado.
      const anulavel = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: agua.id, quantidade: 2 }] // 1.60
      });
      assert.equal(anulavel.status, 201);
      estado = await caixaService.estadoAtual();
      assert.equal(estado.resumo.esperado, 35.6, '34.00 + 1.60 enquanto esta concluido');

      const anulacao = await agente.post(`/admin/consumos/${anulavel.body.consumo.id}/anular`).type('form').send({});
      assert.equal(anulacao.status, 302);
      estado = await caixaService.estadoAtual();
      assert.equal(estado.resumo.movimentos_internos, 4, 'o movimento anulado sai do agregado');
      assert.equal(estado.resumo.esperado, 34, 'movimentos anulados nao contam para o esperado');

      // O ecra de caixa mostra as parcelas do esperado, auditaveis a olho.
      const resumoHtml = await agente.get('/caixa');
      assert.equal(resumoHtml.status, 200);
      assert.match(resumoHtml.text, /Movimentos internos/);
      assert.match(resumoHtml.text, /Dinheiro esperado em caixa/);
      assert.ok(resumoHtml.text.includes('34.00'), 'o esperado 34.00 tem de aparecer no ecra');

      // Fecha com exatamente o esperado: sem diferenca.
      const fecho = await agente.post('/caixa/fechar').type('form').send({ total_contado: '34.00' });
      assert.equal(fecho.status, 302);

      const sessaoFechada = await uma(
        "SELECT * FROM sessoes_caixa WHERE estado = 'fechada' ORDER BY id DESC LIMIT 1"
      );
      assert.equal(Number(sessaoFechada.fundo_inicial), 30);
      assert.equal(Number(sessaoFechada.total_contado), 34);
      assert.equal(
        Number(sessaoFechada.diferenca),
        0,
        'fundo 30 + movimentos internos 4 = 34 esperado'
      );

      // O detalhe da sessao fechada conta a mesma historia (historico coerente).
      const detalhe = await agente.get(`/caixa/sessao/${sessaoFechada.id}`);
      assert.equal(detalhe.status, 200);
      assert.match(detalhe.text, /Como se chegou ao dinheiro esperado/);
      assert.ok(detalhe.text.includes('34.00'));
    });

    // --- 13b. Caso exato relatado pelo cliente ------------------------------
    await t.test('13b. CASO DO CLIENTE: fundo 20 + movimentos internos 5.00 => esperado 25.00', async () => {
      const balcao = request.agent(app);
      await balcao
        .post('/login')
        .type('form')
        .send({ username: FUNCIONARIO.username, password: FUNCIONARIO.password });

      // Given: caixa aberta com 20.00 de fundo.
      const abertura = await agente.post('/caixa/abrir').type('form').send({ fundo_inicial: '20.00' });
      assert.equal(abertura.status, 302);

      // When: movimentos internos que somam EXATAMENTE 5.00
      //   Coca-Cola 1.50 x 2 = 3.00  +  Imperial 1.20 x 1 = 1.20
      //   + Agua 0.5L 0.80 x 1 = 0.80   ->  3.00 + 1.20 + 0.80 = 5.00
      const cola = await artigoPorNome('Coca-Cola');
      const imperial = await artigoPorNome('Imperial');
      const agua = await artigoPorNome('Agua 0.5L');
      assert.equal(Number(cola.preco), 1.5);
      assert.equal(Number(imperial.preco), 1.2);
      assert.equal(Number(agua.preco), 0.8);

      const um = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: cola.id, quantidade: 2 }]
      });
      assert.equal(um.body.consumo.total, 3);

      const dois = await balcao.post('/api/consumos').send({
        itens: [
          { artigo_id: imperial.id, quantidade: 1 },
          { artigo_id: agua.id, quantidade: 1 }
        ]
      });
      assert.equal(dois.body.consumo.total, 2);

      // Then: 20 + 5 = 25 (era 20 antes da correcao — o bug relatado).
      const estado = await caixaService.estadoAtual();
      assert.equal(estado.resumo.fundo_inicial, 20);
      assert.equal(estado.resumo.movimentos_internos, 5);
      assert.equal(estado.resumo.esperado, 25);

      // E com 25.00 contados a diferenca e zero.
      const fecho = await agente.post('/caixa/fechar').type('form').send({ total_contado: '25.00' });
      assert.equal(fecho.status, 302);

      const sessao = await uma("SELECT * FROM sessoes_caixa WHERE estado = 'fechada' ORDER BY id DESC LIMIT 1");
      assert.equal(Number(sessao.fundo_inicial), 20);
      assert.equal(Number(sessao.total_contado), 25);
      assert.equal(Number(sessao.diferenca), 0);
    });

    // --- 14. Backoffice: listagem sem coluna de metodo de pagamento ---------
    // Read-only: nao cria registos, logo nao invalida nenhum total acima.
    await t.test('14. /admin/consumos mostra "Movimentos Internos" e ja nao tem coluna Tipo', async () => {
      const res = await agente.get('/admin/consumos');
      assert.equal(res.status, 200);

      // A area passou a chamar-se Movimentos Internos (titulo + menu).
      assert.match(res.text, /Movimentos Internos/);

      // A coluna "Tipo" saiu do cabecalho da tabela.
      assert.doesNotMatch(res.text, /<th[^>]*>\s*Tipo\s*<\/th>/);

      // E o filtro por metodo de pagamento tambem.
      assert.ok(!res.text.includes('id="fMetodo"'), 'o filtro de pagamento devia ter saido');
      assert.ok(!res.text.includes('name="metodo"'), 'nao devia sobrar nenhum campo metodo');

      // A tabela continua alinhada: 7 colunas no cabecalho.
      const cabecalho = res.text.match(/<thead>[\s\S]*?<\/thead>/);
      assert.ok(cabecalho, 'a tabela devia ter cabecalho');
      assert.equal((cabecalho[0].match(/<th[\s>]/g) || []).length, 7);

      // O dado nao desapareceu: continua no detalhe de um registo com pagamento.
      const antiga = await uma("SELECT id FROM consumos WHERE metodo_pagamento = 'multibanco' LIMIT 1");
      assert.ok(antiga, 'o seed do fluxo devia ter deixado uma venda antiga por multibanco');
      const detalhe = await agente.get(`/admin/consumos/${antiga.id}`);
      assert.equal(detalhe.status, 200);
      assert.match(detalhe.text, /multibanco/);

      // Um movimento interno mostra o rotulo proprio, sem valores de dinheiro.
      const interna = await uma("SELECT id FROM consumos WHERE metodo_pagamento = 'interno' LIMIT 1");
      const detalheInterno = await agente.get(`/admin/consumos/${interna.id}`);
      assert.equal(detalheInterno.status, 200);
      assert.match(detalheInterno.text, /movimento interno/);
      assert.doesNotMatch(detalheInterno.text, /Troco/);

      // O parametro ?metodo= continua a funcionar (URLs guardadas) e agora e
      // sinalizado ao utilizador, para nao filtrar em silencio.
      const filtrada = await agente.get('/admin/consumos?metodo=multibanco');
      assert.equal(filtrada.status, 200);
      assert.match(filtrada.text, /A mostrar apenas os registos com pagamento/);
    });

    // --- 15. Preco de custo, snapshot e margem ------------------------------
    // Passos novos ficam sempre NO FIM: os totais dos passos anteriores estao
    // conferidos a mao e qualquer registo novo pelo meio invalidava-os.
    let artigoCusto = null;
    let consumoComCusto = null;

    await t.test('15a. O seed traz preco_custo em todos os artigos', async () => {
      const colunas = await bd.query('SHOW COLUMNS FROM artigos LIKE ?', ['preco_custo']);
      assert.equal(colunas.length, 1, 'artigos.preco_custo tem de existir');

      const itens = await bd.query('SHOW COLUMNS FROM consumo_itens LIKE ?', ['custo_unit']);
      assert.equal(itens.length, 1, 'consumo_itens.custo_unit tem de existir');

      // Custos concretos do seed (bar de campo: custo entre ~30% e ~47%).
      const imperial = await uma('SELECT preco, preco_custo FROM artigos WHERE nome = ?', ['Imperial']);
      assert.equal(Number(imperial.preco), 1.2);
      assert.equal(Number(imperial.preco_custo), 0.4);

      const cafe = await uma('SELECT preco, preco_custo FROM artigos WHERE nome = ?', ['Cafe']);
      assert.equal(Number(cafe.preco_custo), 0.22);

      // Nenhum artigo do seed ficou sem custo nem com custo acima do preco.
      const maus = await bd.query(
        "SELECT nome FROM artigos WHERE nome <> 'Bolo caseiro' AND preco > 0 AND (preco_custo <= 0 OR preco_custo >= preco)"
      );
      assert.deepEqual(maus.map((m) => m.nome), []);
    });

    await t.test('15b. O custo_unit e gravado no consumo a partir da BD, nao do cliente', async () => {
      artigoCusto = await artigoPorNome('Cerveja garrafa 33cl'); // 1.50 / custo 0.60

      // O cliente tenta impor preco E custo: ambos tem de ser ignorados.
      const res = await agente.post('/api/consumos').send({
        itens: [
          { artigo_id: artigoCusto.id, quantidade: 4, preco_unit: 0.01, custo_unit: 0.01, subtotal: 0.04 }
        ]
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.consumo.total, 6); // 4 x 1.50, o preco da BD
      consumoComCusto = res.body.consumo;

      const item = await uma('SELECT * FROM consumo_itens WHERE consumo_id = ?', [consumoComCusto.id]);
      assert.equal(Number(item.preco_unit), 1.5);
      assert.equal(Number(item.custo_unit), 0.6, 'o custo gravado tem de ser o da BD');
      assert.equal(Number(item.subtotal), 6);

      // Margem desta linha: (1.50 - 0.60) x 4 = 3.60
      assert.equal(Number(item.subtotal) - Number(item.custo_unit) * Number(item.quantidade), 3.6);
    });

    await t.test('15c. Alterar o preco_custo do artigo NAO muda a margem ja registada', async () => {
      // Given: o custo do artigo sobe de 0.60 para 0.95, escrito com VIRGULA
      // no formulario do backoffice (formato pt-PT).
      const res = await agente
        .post(`/admin/artigos/${artigoCusto.id}`)
        .field('nome', 'Cerveja garrafa 33cl')
        .field('preco', '1.50')
        .field('preco_custo', '0,95')
        .field('ativo', 'on')
        .field('stock_minimo', '24')
        .field('unidade', 'un');

      assert.equal(res.status, 302);

      // O artigo passou mesmo a 0.95 (a virgula foi aceite).
      const artigo = await uma('SELECT preco, preco_custo FROM artigos WHERE id = ?', [artigoCusto.id]);
      assert.equal(Number(artigo.preco_custo), 0.95);

      // Then: o consumo ANTERIOR continua com o custo de 0.60.
      const item = await uma('SELECT * FROM consumo_itens WHERE consumo_id = ?', [consumoComCusto.id]);
      assert.equal(Number(item.custo_unit), 0.6, 'o historico nao pode ser reescrito');

      // E um consumo NOVO ja usa o custo novo.
      const novo = await agente
        .post('/api/consumos')
        .send({ itens: [{ artigo_id: artigoCusto.id, quantidade: 1 }] });
      assert.equal(novo.status, 201);

      const itemNovo = await uma('SELECT * FROM consumo_itens WHERE consumo_id = ?', [
        novo.body.consumo.id
      ]);
      assert.equal(Number(itemNovo.custo_unit), 0.95);
    });

    await t.test('15d. Relatorios: custo e margem batem certo com a BD', async () => {
      const { hojeISO, calcularMargem } = require('../../src/utils');
      const hoje = hojeISO();

      const custos = await relatoriosRepo.custoConsumos(hoje, hoje);
      const controlo = await uma(
        `SELECT COALESCE(SUM(vi.custo_unit * vi.quantidade), 0) AS custo,
                COALESCE(SUM(vi.subtotal), 0) AS venda
         FROM consumo_itens vi
         JOIN consumos v ON v.id = vi.consumo_id
         WHERE v.estado = 'concluida' AND v.criado_em BETWEEN ? AND ?`,
        [`${hoje} 00:00:00`, `${hoje} 23:59:59`]
      );

      assert.equal(custos.custo, Number(controlo.custo));
      assert.equal(custos.venda, Number(controlo.venda));
      assert.ok(custos.custo > 0, 'os consumos de hoje ja tem custo associado');

      // A margem e simplesmente venda - custo (sem IVA em lado nenhum).
      const margem = calcularMargem(custos.venda, custos.custo);
      assert.equal(margem.margem, Math.round((custos.venda - custos.custo) * 100) / 100);
      assert.ok(margem.percentagem !== null && Number.isFinite(margem.percentagem));

      // Margem por artigo: a cerveja do passo 15b tem o custo ANTIGO (4 x 0.60)
      // somado ao novo (1 x 0.95) = 3.35 de custo em 5 unidades.
      const porArtigo = await relatoriosRepo.margemPorArtigo(hoje, hoje);
      const cerveja = porArtigo.find((a) => a.nome === 'Cerveja garrafa 33cl');
      assert.ok(cerveja, 'a cerveja consumida devia aparecer na margem por artigo');
      assert.equal(Number(cerveja.quantidade), 5);
      assert.equal(Number(cerveja.total), 7.5); // 5 x 1.50
      assert.equal(Number(cerveja.custo), 3.35); // 4 x 0.60 + 1 x 0.95
    });

    await t.test('15e. Backoffice mostra custo/margem e nunca NaN com preco 0', async () => {
      // Given: um artigo oferecido (preco 0) — divisao por zero na margem %
      const criado = await agente
        .post('/admin/artigos')
        .field('nome', 'Oferta da casa')
        .field('preco', '0')
        .field('preco_custo', '0,35')
        .field('ativo', 'on')
        .field('stock_minimo', '0')
        .field('unidade', 'un');
      assert.equal(criado.status, 302);

      const oferta = await uma('SELECT * FROM artigos WHERE nome = ?', ['Oferta da casa']);
      assert.equal(Number(oferta.preco), 0);
      assert.equal(Number(oferta.preco_custo), 0.35, 'o custo com virgula foi gravado como 0.35');

      // When
      const lista = await agente.get('/admin/artigos');

      // Then
      assert.equal(lista.status, 200);
      assert.match(lista.text, /<th[^>]*>Custo<\/th>/);
      assert.match(lista.text, /<th[^>]*>Margem<\/th>/);
      assert.ok(!lista.text.includes('NaN'), 'preco 0 nao pode produzir NaN na listagem');
      assert.ok(!lista.text.includes('Infinity'), 'preco 0 nao pode produzir Infinity na listagem');

      // E os relatorios continuam a responder, tambem sem NaN/Infinity.
      const relatorios = await agente.get('/admin/relatorios');
      assert.equal(relatorios.status, 200);
      assert.match(relatorios.text, /Rentabilidade do periodo/);
      assert.match(relatorios.text, /Margem por artigo/);
      assert.ok(!relatorios.text.includes('NaN'));
      assert.ok(!relatorios.text.includes('Infinity'));

      // O GIM continua sem qualquer vestigio de custo ou margem: o ecra de
      // registo e operado por um funcionario e a margem e informacao de gestao.
      const catalogo = await agente.get('/api/gim/artigos');
      assert.equal(catalogo.status, 200);
      const qualquer = catalogo.body.artigos[0];
      assert.ok(!('preco_custo' in qualquer), 'o catalogo do GIM nao pode expor o custo');
      assert.ok(!('custo' in qualquer));
      assert.ok(!('margem' in qualquer));
    });

    // --- 16. Compatibilidade das rotas antigas /pos ---------------------------
    // Passo novo, no fim de proposito: nao mexe em nada do que vem acima.
    await t.test('16. As rotas antigas /pos redirecionam (308) para /gim', async () => {
      // Given/When: um atalho antigo gravado num tablet do balcao.
      const ecra = await agente.get('/pos');

      // Then: redirect permanente, sem 404.
      assert.equal(ecra.status, 308);
      assert.equal(ecra.headers.location, '/gim');

      // E o catalogo antigo tambem.
      const catalogoAntigo = await agente.get('/api/pos/artigos');
      assert.equal(catalogoAntigo.status, 308);
      assert.equal(catalogoAntigo.headers.location, '/api/gim/artigos');

      // Seguir o redirect chega mesmo ao ecra novo, com os estaticos certos.
      const destino = await agente.get('/gim');
      assert.equal(destino.status, 200);
      assert.match(destino.text, /\/css\/gim\.css/);
      assert.match(destino.text, /\/js\/gim\.js/);
      assert.ok(!destino.text.includes('/css/pos.css'));
      assert.ok(!destino.text.includes('/js/pos.js'));
    });

    // --- 17. Gestao de utilizadores no backoffice ---------------------------
    // Passos NOVOS, no fim de proposito: criam registos e nao podem invalidar
    // os totais dos passos anteriores, que estao verificados a mao.
    const RITA = {
      nome: 'Rita Balcao',
      username: 'rita.balcao',
      password: 'segredo-forte-1',
      pin: '5150',
      role: 'funcionario'
    };
    let ritaId = null;

    await t.test('17a. Admin cria um utilizador: hashes bcrypt na BD, nada em claro', async () => {
      const res = await agente
        .post('/admin/utilizadores')
        .type('form')
        .send({ ...RITA, ativo: '1' });

      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/admin/utilizadores');

      const criado = await uma('SELECT * FROM utilizadores WHERE username = ?', [RITA.username]);
      assert.ok(criado, 'o utilizador devia ter sido gravado');
      ritaId = criado.id;

      assert.equal(criado.nome, RITA.nome);
      assert.equal(criado.role, 'funcionario');
      assert.equal(Number(criado.ativo), 1);

      // bcrypt com SALT_ROUNDS = 12 (ver auth.service.hashPassword).
      assert.match(criado.password_hash, /^\$2[aby]\$12\$/);
      assert.match(criado.pin_hash, /^\$2[aby]\$12\$/);
      // E nada, em coluna nenhuma, guarda a credencial em claro.
      assert.notEqual(criado.password_hash, RITA.password);
      assert.notEqual(criado.pin_hash, RITA.pin);
      assert.ok(criado.password_hash.indexOf(RITA.password) === -1);
      assert.ok(criado.pin_hash.indexOf(RITA.pin) === -1);

      const emClaro = await uma(
        'SELECT COUNT(*) AS n FROM utilizadores WHERE password_hash = ? OR pin_hash = ?',
        [RITA.password, RITA.pin]
      );
      assert.equal(Number(emClaro.n), 0, 'nenhuma linha pode ter password/PIN em claro');

      // Aparece na listagem, sem credenciais nem hashes no HTML.
      const lista = await agente.get('/admin/utilizadores');
      assert.equal(lista.status, 200);
      assert.ok(lista.text.indexOf(RITA.nome) !== -1);
      assert.ok(lista.text.indexOf(RITA.password) === -1);
      assert.ok(lista.text.indexOf(RITA.pin) === -1);
      assert.ok(lista.text.indexOf('$2a$') === -1);
    });

    await t.test('17b. O utilizador novo entra por password e por PIN, como ELE proprio', async () => {
      // Login por password.
      const porPassword = request.agent(app);
      const login = await porPassword
        .post('/login')
        .type('form')
        .send({ username: RITA.username, password: RITA.password });

      assert.equal(login.status, 302);
      assert.equal(login.headers.location, '/gim', 'e funcionario: vai para o GIM');

      // Login por PIN, num agente novo. A prova de identidade nao e o ecra: e
      // o dono do movimento que fica gravado na base de dados.
      const porPin = request.agent(app);
      const pin = await porPin.post('/gim/pin').type('form').send({ pin: RITA.pin });
      assert.equal(pin.status, 302);
      assert.equal(pin.headers.location, '/gim');

      const cha = await artigoPorNome('Cha'); // 0.90
      const movimento = await porPin.post('/api/consumos').send({
        itens: [{ artigo_id: cha.id, quantidade: 1 }]
      });
      assert.equal(movimento.status, 201);

      const gravado = await uma('SELECT * FROM consumos WHERE id = ?', [movimento.body.consumo.id]);
      assert.equal(
        gravado.utilizador_id,
        ritaId,
        'o PIN tem de autenticar a PESSOA CERTA, senao o controlo interno nao vale nada'
      );
    });

    await t.test('17c. Um segundo utilizador com o PIN repetido e rejeitado', async () => {
      const antes = await uma('SELECT COUNT(*) AS n FROM utilizadores');

      const res = await agente
        .post('/admin/utilizadores')
        .type('form')
        .send({
          nome: 'Clone do PIN',
          username: 'clone.pin',
          password: 'outra-password-99',
          pin: RITA.pin, // exactamente o mesmo PIN
          role: 'funcionario',
          ativo: '1'
        });

      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/admin/utilizadores/novo', 'volta ao formulario');

      const depois = await uma('SELECT COUNT(*) AS n FROM utilizadores');
      assert.equal(Number(depois.n), Number(antes.n), 'nao pode ter sido criado nada');
      assert.equal(await uma('SELECT id FROM utilizadores WHERE username = ?', ['clone.pin']), null);

      // A mensagem chega ao admin, e e clara.
      const formulario = await agente.get('/admin/utilizadores/novo');
      assert.ok(
        formulario.text.indexOf('Ja existe um utilizador activo com esse PIN.') !== -1,
        'o admin tem de perceber porque foi recusado'
      );
    });

    await t.test('17d. O admin nao se pode desactivar nem despromover a si proprio', async () => {
      const eu = await uma('SELECT * FROM utilizadores WHERE username = ?', [ADMIN.username]);

      // Auto-desactivacao pela rota de desactivar.
      const desactivar = await agente
        .post(`/admin/utilizadores/${eu.id}/desactivar`)
        .type('form')
        .send({});
      assert.equal(desactivar.status, 302);

      const depoisDesactivar = await uma('SELECT ativo, role FROM utilizadores WHERE id = ?', [eu.id]);
      assert.equal(Number(depoisDesactivar.ativo), 1, 'o admin tem de continuar activo');

      const pagina = await agente.get('/admin/utilizadores');
      assert.ok(pagina.text.indexOf('Nao pode desactivar a sua propria conta.') !== -1);

      // Auto-despromocao pelo formulario de edicao.
      const despromover = await agente
        .post(`/admin/utilizadores/${eu.id}`)
        .type('form')
        .send({
          nome: eu.nome,
          username: eu.username,
          password: '',
          pin: '',
          role: 'funcionario',
          ativo: '1'
        });
      assert.equal(despromover.status, 302);

      const depoisDespromover = await uma('SELECT ativo, role FROM utilizadores WHERE id = ?', [eu.id]);
      assert.equal(depoisDespromover.role, 'admin', 'o admin tem de continuar admin');
      assert.equal(Number(depoisDespromover.ativo), 1);

      // E o sistema continua com pelo menos um admin activo.
      const admins = await uma(
        "SELECT COUNT(*) AS n FROM utilizadores WHERE role = 'admin' AND ativo = 1"
      );
      assert.ok(Number(admins.n) >= 1, 'nunca pode ficar o sistema sem administrador activo');

      // As credenciais do admin continuam a funcionar (nada foi corrompido).
      const reentrada = request.agent(app);
      const login = await reentrada
        .post('/login')
        .type('form')
        .send({ username: ADMIN.username, password: ADMIN.password });
      assert.equal(login.status, 302);
      assert.equal(login.headers.location, '/admin');
    });

    await t.test('17e. Editar sem password/PIN nao apaga os hashes existentes', async () => {
      const antes = await uma('SELECT * FROM utilizadores WHERE id = ?', [ritaId]);

      const res = await agente
        .post(`/admin/utilizadores/${ritaId}`)
        .type('form')
        .send({
          nome: 'Rita Balcao (turno da tarde)',
          username: RITA.username,
          password: '',
          pin: '',
          role: 'funcionario',
          ativo: '1'
        });
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/admin/utilizadores');

      const depois = await uma('SELECT * FROM utilizadores WHERE id = ?', [ritaId]);
      assert.equal(depois.nome, 'Rita Balcao (turno da tarde)');
      assert.equal(depois.password_hash, antes.password_hash, 'o hash da password nao pode mudar');
      assert.equal(depois.pin_hash, antes.pin_hash, 'o hash do PIN nao pode mudar');
      assert.ok(depois.pin_hash, 'o PIN nao pode ter sido apagado');

      // E as credenciais antigas continuam mesmo a funcionar.
      const porPin = request.agent(app);
      const pin = await porPin.post('/gim/pin').type('form').send({ pin: RITA.pin });
      assert.equal(pin.status, 302);
      assert.equal(pin.headers.location, '/gim');
    });

    // --- 18. "Os meus movimentos": filtro imposto no servidor ---------------
    await t.test('18. O funcionario so ve os SEUS movimentos e nao entra no backoffice', async () => {
      const balcao = request.agent(app);
      const login = await balcao
        .post('/login')
        .type('form')
        .send({ username: RITA.username, password: RITA.password });
      assert.equal(login.status, 302);

      const funcionarioBd = await uma('SELECT id FROM utilizadores WHERE username = ?', [
        FUNCIONARIO.username
      ]);

      // Um movimento dela, agora.
      const gelado = await artigoPorNome('Gelado'); // 1.50
      const meu = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: gelado.id, quantidade: 2 }]
      });
      assert.equal(meu.status, 201);
      assert.equal(meu.body.consumo.total, 3);
      const meuId = meu.body.consumo.id;
      const meuNumero = meu.body.consumo.numero;

      // Um movimento de OUTRA pessoa, hoje tambem.
      const outroBalcao = request.agent(app);
      await outroBalcao
        .post('/login')
        .type('form')
        .send({ username: FUNCIONARIO.username, password: FUNCIONARIO.password });
      const agua = await artigoPorNome('Agua 0.5L');
      const doOutro = await outroBalcao.post('/api/consumos').send({
        itens: [{ artigo_id: agua.id, quantidade: 1 }]
      });
      assert.equal(doOutro.status, 201);
      const numeroDoOutro = doOutro.body.consumo.numero;

      // O ecra mostra o dela e NAO mostra o do colega.
      const meus = await balcao.get('/gim/meus-movimentos');
      assert.equal(meus.status, 200);
      assert.ok(meus.text.indexOf(`#${meuNumero}`) !== -1, 'devia mostrar o movimento dela');
      assert.ok(
        meus.text.indexOf(`#${numeroDoOutro}`) === -1,
        'NAO pode mostrar o movimento de outra pessoa'
      );

      // Mexer no URL nao muda nada: o dono vem da sessao.
      for (const querystring of ['?utilizador_id=1', `?utilizador_id=${funcionarioBd.id}`, '?id=1']) {
        const forcado = await balcao.get(`/gim/meus-movimentos${querystring}`);
        assert.equal(forcado.status, 200);
        assert.ok(
          forcado.text.indexOf(`#${numeroDoOutro}`) === -1,
          `${querystring} nao pode revelar movimentos de outra pessoa`
        );
        assert.ok(forcado.text.indexOf(`#${meuNumero}`) !== -1);
      }

      // Nao mostra custo nem margem (informacao de gestao).
      for (const proibido of ['custo', 'Custo', 'margem', 'Margem']) {
        assert.ok(meus.text.indexOf(proibido) === -1, `o ecra nao pode mostrar "${proibido}"`);
      }

      // O BACKOFFICE continua vedado: o funcionario anula pelo GIM (passo 20),
      // nunca por /admin/*.
      const anular = await balcao.post(`/admin/consumos/${meuId}/anular`).type('form').send({});
      assert.equal(anular.status, 403, 'o funcionario nao entra no backoffice');

      const aindaConcluido = await uma('SELECT estado FROM consumos WHERE id = ?', [meuId]);
      assert.equal(aindaConcluido.estado, 'concluida', 'o movimento nao podia ter sido anulado');

      // E a gestao de utilizadores tambem esta vedada.
      const VEDADAS = [
        '/admin/utilizadores',
        '/admin/utilizadores/novo',
        `/admin/utilizadores/${ritaId}/editar`
      ];
      for (const rota of VEDADAS) {
        const bloqueado = await balcao.get(rota);
        assert.equal(bloqueado.status, 403, `${rota} devia dar 403 ao funcionario`);
      }
      const criarProibido = await balcao
        .post('/admin/utilizadores')
        .type('form')
        .send({
          nome: 'Intruso',
          username: 'intruso',
          password: 'password-1234',
          pin: '1111',
          role: 'admin'
        });
      assert.equal(criarProibido.status, 403);
      assert.equal(await uma('SELECT id FROM utilizadores WHERE username = ?', ['intruso']), null);

      // Sem sessao nao ha ecra nenhum.
      const anonimo = await request(app).get('/gim/meus-movimentos');
      assert.equal(anonimo.status, 302);
      assert.match(anonimo.headers.location, /^\/login\?next=/);
    });

    // --- 19. Desactivar um utilizador (soft-delete) --------------------------
    await t.test('19. Desactivar mantem o historico e fecha os dois logins', async () => {
      const movimentosAntes = await uma('SELECT COUNT(*) AS n FROM consumos WHERE utilizador_id = ?', [
        ritaId
      ]);
      assert.ok(Number(movimentosAntes.n) > 0, 'a Rita ja registou movimentos');

      const res = await agente.post(`/admin/utilizadores/${ritaId}/desactivar`).type('form').send({});
      assert.equal(res.status, 302);

      // Soft-delete: a linha continua la, so muda `ativo`.
      const depois = await uma('SELECT * FROM utilizadores WHERE id = ?', [ritaId]);
      assert.ok(depois, 'nunca pode haver DELETE fisico: o historico aponta para ca');
      assert.equal(Number(depois.ativo), 0);

      // O historico ficou intacto.
      const movimentosDepois = await uma(
        'SELECT COUNT(*) AS n FROM consumos WHERE utilizador_id = ?',
        [ritaId]
      );
      assert.equal(Number(movimentosDepois.n), Number(movimentosAntes.n));

      // E ja nao entra: nem por password, nem por PIN.
      const porPassword = request.agent(app);
      const login = await porPassword
        .post('/login')
        .type('form')
        .send({ username: RITA.username, password: RITA.password });
      assert.equal(login.status, 401);

      const porPin = request.agent(app);
      const pin = await porPin.post('/gim/pin').type('form').send({ pin: RITA.pin });
      assert.equal(pin.status, 302);
      assert.equal(pin.headers.location, '/login', 'PIN de utilizador desactivado nao autentica');
      const bloqueado = await porPin.get('/api/gim/artigos');
      assert.equal(bloqueado.status, 401);
    });

    // --- 20. Anular o proprio movimento com a caixa aberta -------------------
    // Passo NOVO, no fim de proposito: mexe em stock e em sessoes de caixa, e
    // os totais dos passos anteriores estao conferidos a mao.
    //
    // Usa o funcionario do SEED (a Rita foi desactivada no passo 19).
    await t.test('20. O operador anula movimentos seus so enquanto a caixa esta aberta', async () => {
      const balcao = request.agent(app);
      const login = await balcao
        .post('/login')
        .type('form')
        .send({ username: FUNCIONARIO.username, password: FUNCIONARIO.password });
      assert.equal(login.status, 302);

      // Garantir que NAO ha caixa aberta, para comecar pelo caso do orfao.
      const abertaInicial = await uma("SELECT id FROM sessoes_caixa WHERE estado = 'aberta'");
      if (abertaInicial) {
        const fecho = await agente.post('/caixa/fechar').type('form').send({ total_contado: '0' });
        assert.equal(fecho.status, 302);
      }

      // (a) SEM caixa: o movimento fica orfao e o operador NAO o pode anular.
      const cafe = await artigoPorNome('Cafe');
      const orfao = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: cafe.id, quantidade: 1 }]
      });
      assert.equal(orfao.status, 201);
      const orfaoId = orfao.body.consumo.id;
      assert.equal(
        (await uma('SELECT sessao_caixa_id FROM consumos WHERE id = ?', [orfaoId])).sessao_caixa_id,
        null,
        'sem caixa aberta o consumo fica orfao'
      );

      const recusaOrfao = await balcao
        .post(`/gim/meus-movimentos/${orfaoId}/anular`)
        .type('form')
        .send({});
      assert.equal(recusaOrfao.status, 403, 'consumo orfao nao e anulavel pelo operador');
      assert.equal(
        (await uma('SELECT estado FROM consumos WHERE id = ?', [orfaoId])).estado,
        'concluida'
      );

      // (b) COM a caixa aberta: anula e o stock volta mesmo.
      const abertura = await agente.post('/caixa/abrir').type('form').send({ fundo_inicial: '0' });
      assert.equal(abertura.status, 302);

      const antes = await artigoPorNome('Cafe');
      const meu = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: cafe.id, quantidade: 3 }]
      });
      assert.equal(meu.status, 201);
      const meuId = meu.body.consumo.id;

      const depoisDoConsumo = await artigoPorNome('Cafe');
      assert.equal(Number(depoisDoConsumo.quantidade), Number(antes.quantidade) - 3);

      // O botao aparece no ecra (a accao e possivel).
      const ecra = await balcao.get('/gim/meus-movimentos');
      assert.equal(ecra.status, 200);
      assert.ok(
        ecra.text.indexOf(`/gim/meus-movimentos/${meuId}/anular`) !== -1,
        'devia haver botao de anular para um movimento seu com a caixa aberta'
      );

      const anulou = await balcao.post(`/gim/meus-movimentos/${meuId}/anular`).type('form').send({});
      assert.equal(anulou.status, 302);
      assert.equal(
        (await uma('SELECT estado FROM consumos WHERE id = ?', [meuId])).estado,
        'anulada'
      );

      const reposto = await artigoPorNome('Cafe');
      assert.equal(Number(reposto.quantidade), Number(antes.quantidade), 'o stock tem de voltar');

      // Nao anula duas vezes (nem repoe stock outra vez).
      const segunda = await balcao.post(`/gim/meus-movimentos/${meuId}/anular`).type('form').send({});
      assert.equal(segunda.status, 403);
      assert.equal(
        Number((await artigoPorNome('Cafe')).quantidade),
        Number(antes.quantidade),
        'o stock nao pode ser reposto duas vezes'
      );

      // (c) Movimento de OUTRA pessoa: 403, mesmo com a caixa aberta.
      const doAdmin = await agente.post('/api/consumos').send({
        itens: [{ artigo_id: cafe.id, quantidade: 1 }]
      });
      assert.equal(doAdmin.status, 201);
      const idDoAdmin = doAdmin.body.consumo.id;

      const alheio = await balcao
        .post(`/gim/meus-movimentos/${idDoAdmin}/anular`)
        .type('form')
        .send({ utilizador_id: '1', id: String(meuId) });
      assert.equal(alheio.status, 403, 'nao pode anular movimentos de outra pessoa');
      assert.equal(
        (await uma('SELECT estado FROM consumos WHERE id = ?', [idDoAdmin])).estado,
        'concluida'
      );

      // (d) Depois do FECHO, o mesmo operador ja nao lhe pode tocar.
      const paraDepois = await balcao.post('/api/consumos').send({
        itens: [{ artigo_id: cafe.id, quantidade: 1 }]
      });
      assert.equal(paraDepois.status, 201);
      const idParaDepois = paraDepois.body.consumo.id;

      const fecho = await agente.post('/caixa/fechar').type('form').send({ total_contado: '0' });
      assert.equal(fecho.status, 302);

      const tarde = await balcao
        .post(`/gim/meus-movimentos/${idParaDepois}/anular`)
        .type('form')
        .send({});
      assert.equal(tarde.status, 403, 'com a caixa fechada o registo fica selado');
      assert.equal(
        (await uma('SELECT estado FROM consumos WHERE id = ?', [idParaDepois])).estado,
        'concluida'
      );

      // O ecra ja nao mostra o botao, e explica porque.
      const ecraDepois = await balcao.get('/gim/meus-movimentos');
      assert.ok(ecraDepois.text.indexOf(`/gim/meus-movimentos/${idParaDepois}/anular`) === -1);
      assert.match(ecraDepois.text, /Caixa ja fechada/);

      // (e) O ADMIN continua sem restricoes: anula o de caixa ja fechada.
      const peloAdmin = await agente
        .post(`/admin/consumos/${idParaDepois}/anular`)
        .type('form')
        .send({});
      assert.equal(peloAdmin.status, 302);
      assert.equal(
        (await uma('SELECT estado FROM consumos WHERE id = ?', [idParaDepois])).estado,
        'anulada'
      );

      // E tambem o orfao, que o operador nunca poderia tocar.
      const orfaoPeloAdmin = await agente
        .post(`/admin/consumos/${orfaoId}/anular`)
        .type('form')
        .send({});
      assert.equal(orfaoPeloAdmin.status, 302);
      assert.equal(
        (await uma('SELECT estado FROM consumos WHERE id = ?', [orfaoId])).estado,
        'anulada'
      );
    });
  } finally {
    // Limpeza garantida, mesmo com falhas acima.
    for (const ficheiro of ficheirosUpload) {
      fs.promises.unlink(ficheiro).catch(() => {});
    }
    await bd.end().catch(() => {});
    await require('../../src/config/db').close().catch(() => {});

    const limpeza = await ligar(undefined).catch(() => null);
    if (limpeza) {
      await limpeza.query(`DROP DATABASE IF EXISTS \`${TEST_DB.database}\``).catch(() => {});
      await limpeza.end().catch(() => {});
    }
  }
});
