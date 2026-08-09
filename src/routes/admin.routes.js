'use strict';

const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const relatoriosCtrl = require('../controllers/relatorios.controller');
const stocksCtrl = require('../controllers/stocks.controller');

const router = express.Router();

// Todo o backoffice e exclusivo do perfil admin.
// Sem sessao -> requireAdmin delega em requireAuth (redirect para /login?next=...).
// Com sessao de funcionario -> 403 (pagina HTML) ou 403 JSON em rotas /api/*.
router.use(requireAdmin);

router.get('/', relatoriosCtrl.dashboard);
router.get('/relatorios', relatoriosCtrl.relatorios);
router.get('/movimentos', stocksCtrl.historicoMovimentos);

router.use('/categorias', require('./categorias.routes'));
router.use('/artigos', require('./artigos.routes'));
router.use('/stocks', require('./stocks.routes'));
router.use('/vendas', require('./vendas.routes'));

module.exports = router;
