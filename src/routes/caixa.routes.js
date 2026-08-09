'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/caixa.controller');

const router = express.Router();

// A caixa (abertura, sangrias e fecho) e responsabilidade do admin.
// O funcionario apenas vende no POS; ver README, seccao "Perfis e permissoes".
router.get('/caixa', requireAdmin, ctrl.ecra);

router.post(
  '/caixa/abrir',
  requireAdmin,
  [body('fundo_inicial').isFloat({ min: 0 }).withMessage('Fundo inicial invalido.')],
  validate,
  ctrl.abrir
);

router.post(
  '/caixa/movimento',
  requireAdmin,
  [
    body('tipo').isIn(['entrada', 'saida', 'sangria']).withMessage('Tipo de movimento invalido.'),
    body('valor').isFloat({ gt: 0 }).withMessage('Valor invalido.'),
    body('descricao').trim().isLength({ max: 255 })
  ],
  validate,
  ctrl.movimento
);

router.post(
  '/caixa/fechar',
  requireAdmin,
  [body('total_contado').isFloat({ min: 0 }).withMessage('Valor contado invalido.')],
  validate,
  ctrl.fechar
);

router.get('/caixa/sessao/:id', requireAdmin, [param('id').isInt({ min: 1 })], validate, ctrl.detalhe);

module.exports = router;
