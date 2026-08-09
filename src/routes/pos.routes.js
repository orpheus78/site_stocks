'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requirePos } = require('../middleware/auth');
const ctrl = require('../controllers/pos.controller');

const router = express.Router();

router.get('/pos', requirePos, ctrl.ecra);
router.get('/api/pos/artigos', requirePos, ctrl.catalogo);

router.post(
  '/api/vendas',
  requirePos,
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
  ctrl.criarVenda
);

router.get('/pos/venda/:id/talao', requirePos, [param('id').isInt({ min: 1 })], validate, ctrl.talao);

module.exports = router;
