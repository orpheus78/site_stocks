'use strict';

const express = require('express');
const { param } = require('express-validator');
const { validate } = require('../middleware/validate');
const ctrl = require('../controllers/vendas.controller');

const router = express.Router();

router.get('/', ctrl.listar);
router.get('/:id', [param('id').isInt({ min: 1 })], validate, ctrl.detalhe);
router.post('/:id/anular', [param('id').isInt({ min: 1 })], validate, ctrl.anular);

module.exports = router;
