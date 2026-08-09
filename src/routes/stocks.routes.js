'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const ctrl = require('../controllers/stocks.controller');

const router = express.Router();

router.get('/', ctrl.listar);

router.post(
  '/movimento',
  [
    body('artigo_id').isInt({ min: 1 }).withMessage('Artigo invalido.'),
    body('tipo').isIn(['entrada', 'saida', 'ajuste']).withMessage('Tipo de movimento invalido.'),
    body('quantidade').isFloat().withMessage('Quantidade invalida.'),
    body('motivo').optional({ checkFalsy: true }).trim().isLength({ max: 255 })
  ],
  validate,
  ctrl.movimento
);

router.post(
  '/:artigoId/parametros',
  [
    param('artigoId').isInt({ min: 1 }),
    body('stock_minimo').isFloat({ min: 0 }).withMessage('Stock minimo invalido.'),
    body('unidade').trim().notEmpty().isLength({ max: 10 }).withMessage('Unidade invalida.')
  ],
  validate,
  ctrl.atualizarParametros
);

module.exports = router;
