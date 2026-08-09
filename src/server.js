'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');

async function arrancar() {
  // A ligacao a BD e testada mas nao impede o arranque (ver README).
  await db.testConnection();

  const servidor = app.listen(env.port, () => {
    console.log(`[app] ${env.nodeEnv} | http://localhost:${env.port}`);
  });

  const encerrar = (sinal) => async () => {
    console.log(`[app] ${sinal} recebido, a encerrar...`);
    servidor.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', encerrar('SIGTERM'));
  process.on('SIGINT', encerrar('SIGINT'));
}

process.on('unhandledRejection', (err) => console.error('[app] unhandledRejection:', err));

arrancar().catch((err) => {
  console.error('[app] falha no arranque:', err);
  process.exit(1);
});
