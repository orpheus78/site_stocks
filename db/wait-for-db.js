'use strict';

/**
 * Espera que a MariaDB do Docker esteja pronta a aceitar ligacoes.
 * Uso: npm run db:wait
 *
 * Existe porque `docker compose up -d` devolve o controlo assim que o
 * contentor arranca, mas o servidor so aceita ligacoes alguns segundos
 * depois (inicializacao do InnoDB). Sem esta espera, `npm run db:schema`
 * falha de forma intermitente.
 */

const mariadb = require('mariadb');
const env = require('../src/config/env');

const TIMEOUT_MS = Number(process.env.DB_WAIT_TIMEOUT_MS || 90000);
const INTERVALO_MS = 1000;

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tentarLigar() {
  const conn = await mariadb.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    connectTimeout: 3001
  });
  try {
    await conn.query('SELECT 1');
  } finally {
    await conn.end();
  }
}

async function main() {
  const limite = Date.now() + TIMEOUT_MS;
  let ultimoErro = null;
  let tentativa = 0;

  while (Date.now() < limite) {
    tentativa += 1;
    try {
      await tentarLigar();
      console.log(`[db:wait] MariaDB pronta em ${env.db.host}:${env.db.port} (tentativa ${tentativa}).`);
      return;
    } catch (err) {
      ultimoErro = err;
      if (tentativa === 1 || tentativa % 5 === 0) {
        console.log(`[db:wait] a aguardar MariaDB (${tentativa})... ${err.message}`);
      }
      await dormir(INTERVALO_MS);
    }
  }

  console.error(`[db:wait] timeout ao fim de ${TIMEOUT_MS}ms. Ultimo erro:`, ultimoErro && ultimoErro.message);
  console.error('[db:wait] O contentor esta a correr? Ver: npm run db:logs');
  process.exit(1);
}

main();
