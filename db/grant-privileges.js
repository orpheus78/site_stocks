'use strict';

/**
 * Concede ao utilizador aplicacional privilegios sobre todas as bases de dados
 * do padrao `bar_%`. Idempotente: pode correr sempre que se arranca o ambiente.
 * Uso: npm run db:grants (invocado por `npm run db:up`)
 *
 * PORQUE E NECESSARIO
 * O contentor MariaDB cria MARIADB_USER apenas com privilegios sobre
 * MARIADB_DATABASE. Mas:
 *   - `db/apply-schema.js` faz `CREATE DATABASE IF NOT EXISTS`;
 *   - os testes E2E criam e destroem uma base de dados propria (`bar_test`).
 * Conceder `bar_%` permite ambos sem correr a aplicacao como root.
 *
 * Alternativa rejeitada: colocar isto em /docker-entrypoint-initdb.d. Esses
 * scripts so correm na primeira criacao do volume e exigem um bind mount, que
 * o Docker Desktop no macOS nao permite a partir de diretorios OneDrive.
 */

const mariadb = require('mariadb');
const env = require('./../src/config/env');

const ROOT_PASSWORD = process.env.DB_ROOT_PASSWORD;

async function main() {
  if (!ROOT_PASSWORD) {
    console.error('[db:grants] DB_ROOT_PASSWORD em falta no .env. Ver .env.example.');
    process.exit(1);
  }

  const conn = await mariadb.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: 'root',
    password: ROOT_PASSWORD,
    connectTimeout: 10000
  });

  try {
    // O utilizador e lido de configuracao controlada, nao de input externo.
    // O `\\_` escapa o underscore para que `bar_%` seja um padrao de prefixo
    // literal ("bar_" + qualquer coisa) e nao "bar" + qualquer caracter.
    await conn.query(`GRANT ALL PRIVILEGES ON \`bar\\_%\`.* TO ?@'%'`, [env.db.user]);
    await conn.query('FLUSH PRIVILEGES');
    console.log(`[db:grants] privilegios sobre 'bar_%' concedidos a '${env.db.user}'.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[db:grants] erro:', err.message);
  process.exit(1);
});
