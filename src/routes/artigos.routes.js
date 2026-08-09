'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { uploadArtigo } = require('../middleware/upload');
const ctrl = require('../controllers/artigos.controller');

const router = express.Router();

const regras = [
  body('nome').trim().notEmpty().withMessage('Nome obrigatorio.').isLength({ max: 120 }),
  body('preco').isFloat({ min: 0 }).withMessage('Preco invalido.'),
  body('categoria_id').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Categoria invalida.'),
  body('ordem').optional({ checkFalsy: true }).isInt({ min: 0 }),
  body('stock_minimo').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Stock minimo invalido.'),
  body('stock_inicial').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Stock inicial invalido.'),
  body('unidade').optional({ checkFalsy: true }).trim().isLength({ max: 10 })
];

router.get('/', ctrl.listar);
router.get('/novo', ctrl.formularioCriar);
router.post('/', uploadArtigo, regras, validate, ctrl.criar);
router.get('/:id/editar', [param('id').isInt({ min: 1 })], validate, ctrl.formularioEditar);
router.post('/:id', uploadArtigo, [param('id').isInt({ min: 1 }), ...regras], validate, ctrl.atualizar);
router.post('/:id/eliminar', [param('id').isInt({ min: 1 })], validate, ctrl.remover);

module.exports = router;
