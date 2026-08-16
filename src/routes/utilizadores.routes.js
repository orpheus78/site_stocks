'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const ctrl = require('../controllers/utilizadores.controller');

const router = express.Router();

// Minimo razoavel para uma app de rede local com login por password.
const PASSWORD_MIN = 8;

/**
 * Regras comuns a criar e editar.
 *
 * As mensagens sao ESTATICAS de proposito: nunca podem repetir o valor
 * introduzido, senao uma password ou um PIN acabariam numa flash message
 * (e possivelmente num log).
 */
const regrasBase = [
  body('nome').trim().notEmpty().withMessage('Nome obrigatorio.').isLength({ max: 120 }),
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Nome de utilizador obrigatorio.')
    .isLength({ max: 60 })
    .withMessage('Nome de utilizador demasiado longo (max. 60).')
    .matches(/^[A-Za-z0-9._-]+$/)
    .withMessage('Nome de utilizador so pode ter letras, numeros, ponto, hifen e underscore.'),
  body('role').isIn(['admin', 'funcionario']).withMessage('Perfil invalido (admin ou funcionario).')
];

// Na CRIACAO password e PIN sao obrigatorios: sem PIN o utilizador nao entra
// no GIM, que e a razao de existir do perfil de balcao.
const regrasCriar = [
  ...regrasBase,
  body('password')
    .isLength({ min: PASSWORD_MIN, max: 200 })
    .withMessage(`Password obrigatoria, com pelo menos ${PASSWORD_MIN} caracteres.`),
  body('pin').trim().matches(/^[0-9]{4}$/).withMessage('PIN tem de ter exactamente 4 digitos.')
];

// Na EDICAO, password e PIN em branco significam "nao alterar" (ver servico).
const regrasEditar = [
  ...regrasBase,
  body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: PASSWORD_MIN, max: 200 })
    .withMessage(`A nova password tem de ter pelo menos ${PASSWORD_MIN} caracteres.`),
  body('pin')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[0-9]{4}$/)
    .withMessage('PIN tem de ter exactamente 4 digitos.')
];

router.get('/', ctrl.listar);
router.get('/novo', ctrl.formularioCriar);
router.post('/', regrasCriar, validate, ctrl.criar);
router.get('/:id/editar', [param('id').isInt({ min: 1 })], validate, ctrl.formularioEditar);
router.post('/:id', [param('id').isInt({ min: 1 }), ...regrasEditar], validate, ctrl.atualizar);

// Soft-delete: desactivar, nunca apagar (o historico de consumos aponta para ca).
router.post('/:id/desactivar', [param('id').isInt({ min: 1 })], validate, ctrl.desactivar);
router.post('/:id/activar', [param('id').isInt({ min: 1 })], validate, ctrl.activar);

module.exports = router;
