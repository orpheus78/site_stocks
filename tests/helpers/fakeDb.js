'use strict';

const path = require('path');

/**
 * Fake do modulo src/config/db.js para testes de integracao HTTP sem MariaDB real.
 *
 * `handlers` e uma lista ordenada de { pattern: RegExp, handler: (params, sql) => rows|result }.
 * O primeiro padrao que corresponder ao SQL e usado. Isto permite simular
 * repositorios reais sem qualquer ligacao a base de dados.
 */
function createFakeDb(handlers = []) {
  function encontrar(sql) {
    return handlers.find((h) => h.pattern.test(sql));
  }

  async function query(sql, params = []) {
    const h = encontrar(sql);
    if (!h) {
      throw new Error(`fakeDb: nenhum handler configurado para SQL: ${sql.trim().slice(0, 120)}`);
    }
    return h.handler(params, sql);
  }

  async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows && rows.length ? rows[0] : null;
  }

  async function transaction(fn) {
    const conn = {
      query: (sql, params) => query(sql, params),
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {}
    };
    // Sem rollback real: erros do fn propagam-se tal como na implementacao real.
    return fn(conn);
  }

  return {
    query,
    queryOne,
    transaction,
    pool: { end: async () => {} },
    testConnection: async () => true,
    close: async () => {}
  };
}

/**
 * Substitui o modulo src/config/db.js no cache do require por um fake,
 * limpa o resto do cache de src/ (para que tudo seja re-exigido a usar o fake)
 * e devolve uma instancia fresca da app Express.
 *
 * Tecnica necessaria porque a aplicacao nao usa injecao de dependencias:
 * repositorios fazem sempre `require('../config/db')` diretamente.
 */
function loadAppWithFakeDb(handlers = []) {
  const dbPath = require.resolve('../../src/config/db');
  const fakeDb = createFakeDb(handlers);

  Object.keys(require.cache).forEach((key) => {
    if (key.includes(`${path.sep}src${path.sep}`)) {
      delete require.cache[key];
    }
  });

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: fakeDb,
    children: [],
    paths: []
  };

  // eslint-disable-next-line global-require
  const app = require('../../src/app');
  return { app, fakeDb };
}

module.exports = { createFakeDb, loadAppWithFakeDb };
