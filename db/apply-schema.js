'use strict';

/**
 * Cria a base de dados (se necessario), aplica db/schema.sql e, a seguir,
 * db/migrations.sql (alteracoes idempotentes a tabelas ja existentes).
 * Uso: npm run db:schema
 */

const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');
const env = require('../src/config/env');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Migracoes idempotentes para BDs ja existentes (o schema so faz
  // CREATE TABLE IF NOT EXISTS e nunca altera tabelas ja criadas).
  const migracoes = fs.readFileSync(path.join(__dirname, 'migrations.sql'), 'utf8');

  const admin = await mariadb.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true
  });

  // Nome da BD vem de configuracao controlada (nao de input de utilizador).
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.query(`USE \`${env.db.database}\``);
  await admin.query(sql);
  await admin.query(migracoes);
  await admin.end();

  console.log(`[schema] aplicado em ${env.db.database} (schema + migracoes)`);
}

main().catch((err) => {
  console.error('[schema] erro:', err.message);
  process.exit(1);
});
