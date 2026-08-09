'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const ctrl = require('../controllers/categorias.controller');

const router = express.Router();

const regras = [
  body('nome').trim().notEmpty().withMessage('Nome obrigatorio.').isLength({ max: 80 }),
  body('cor').optional({ checkFalsy: true }).matches(/^#[0-9a-fA-F]{6}$/).withMessage('Cor invalida (ex.: #0d6efd).'),
  body('ordem').optional({ checkFalsy: true }).isInt({ min: 0 }).withMessage('Ordem invalida.')
];

router.get('/', ctrl.listar);
router.get('/novo', ctrl.formularioCriar);
router.post('/', regras, validate, ctrl.criar);
router.get('/:id/editar', [param('id').isInt({ min: 1 })], validate, ctrl.formularioEditar);
router.post('/:id', [param('id').isInt({ min: 1 }), ...regras], validate, ctrl.atualizar);
router.post('/:id/eliminar', [param('id').isInt({ min: 1 })], validate, ctrl.remover);

module.exports = router;
