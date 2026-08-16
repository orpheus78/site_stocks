'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireGim } = require('../middleware/auth');
const ctrl = require('../controllers/gim.controller');
const meusMovimentosCtrl = require('../controllers/meusMovimentos.controller');

const router = express.Router();

router.get('/gim', requireGim, ctrl.ecra);

// Consulta que o operador faz do SEU proprio turno.
router.get('/gim/meus-movimentos', requireGim, meusMovimentosCtrl.listar);

// Anulacao pelo PROPRIO operador, a partir do ecra acima.
//
// Rota deliberadamente SEPARADA de POST /admin/consumos/:id/anular: o
// backoffice continua exclusivo do admin (requireAdmin intacto) e nao foi
// enfraquecido. Aqui entra qualquer perfil do GIM, mas quem nao e admin so
// passa se o servico confirmar, contra a BASE DE DADOS e dentro da transacao,
// que o movimento e dele, esta concluido e a caixa dele ainda esta aberta.
router.post(
  '/gim/meus-movimentos/:id/anular',
  requireGim,
  [param('id').isInt({ min: 1 }).withMessage('Movimento invalido.')],
  validate,
  meusMovimentosCtrl.anular
);

router.get('/api/gim/artigos', requireGim, ctrl.catalogo);

router.post(
  '/api/consumos',
  requireGim,
  [
    body('itens').isArray({ min: 1 }).withMessage('O movimento tem de ter artigos.'),
    body('itens.*.artigo_id').isInt({ min: 1 }).withMessage('Artigo invalido.'),
    body('itens.*.quantidade').isFloat({ gt: 0 }).withMessage('Quantidade invalida.'),
    // O ecra de movimentos internos ja NAO envia metodo: por omissao e
    // `interno` (sem dinheiro, sem troco). Os valores antigos continuam
    // aceites para nao partir o historico nem clientes existentes da API.
    body('metodo_pagamento')
      .optional({ nullable: true })
      .isIn(['dinheiro', 'multibanco', 'misto', 'interno'])
      .withMessage('Metodo de pagamento invalido.'),
    body('valor_dinheiro').optional({ nullable: true }).isFloat({ min: 0 }),
    body('valor_multibanco').optional({ nullable: true }).isFloat({ min: 0 })
  ],
  validate,
  ctrl.criarConsumo
);

// NAO existe rota de comprovativo/talao. A aplicacao e de controlo INTERNO:
// nao emite talao, comprovativo nem qualquer documento para o cliente. Pedidos
// a /gim/consumo/:id/talao (ou a antiga /gim/venda/:id/talao) caem no 404
// geral do app.js, de proposito.

// ---------------------------------------------------------------------------
// COMPATIBILIDADE TEMPORARIA: rotas antigas /pos -> /gim
//
// O ecra passou a chamar-se GIM. Os tablets do balcao podem ter atalhos
// gravados para /pos (e paginas de login em cache a submeter /pos/pin), por
// isso a rota antiga continua a responder com um redirect em vez de 404.
//
// 308 (e nao 301) de proposito: preserva o metodo e o corpo do pedido, logo o
// POST /pos/pin chega intacto a /gim/pin. O 301 transformaria o POST em GET.
//
// Isto e um andaime de migracao: assim que todos os atalhos estiverem
// actualizados, este bloco pode ser removido sem qualquer outro impacto.
// Nao ha guard de sessao aqui de proposito -- e so um redirect; a
// autenticacao e feita na rota de destino.
// ---------------------------------------------------------------------------
router.all('/pos', (req, res) => res.redirect(308, '/gim'));
router.all('/api/pos/artigos', (req, res) => res.redirect(308, '/api/gim/artigos'));
router.all('/pos/pin', (req, res) => res.redirect(308, '/gim/pin'));

module.exports = router;
