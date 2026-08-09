'use strict';

const express = require('express');
const db = require('../config/db');
const { areaInicial } = require('../middleware/auth');

const router = express.Router();

// Encaminha cada perfil para a sua area: admin -> backoffice, funcionario -> POS.
router.get('/', (req, res) => {
  const user = req.session && req.session.utilizador;
  res.redirect(user ? areaInicial(user) : '/login');
});

/** Liveness: a app esta viva (nao depende da BD). */
router.get('/health', (req, res) => {
  res.json({ estado: 'ok', uptime: Math.round(process.uptime()) });
});

/** Readiness: so esta pronta se a BD responder. */
router.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ estado: 'ok', bd: 'ok' });
  } catch (err) {
    res.status(503).json({ estado: 'indisponivel', bd: 'erro', detalhe: err.message });
  }
});

router.use(require('./auth.routes'));
router.use(require('./pos.routes'));
router.use(require('./caixa.routes'));
router.use('/admin', require('./admin.routes'));

module.exports = router;
