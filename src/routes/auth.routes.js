'use strict';

const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const ctrl = require('../controllers/auth.controller');

const router = express.Router();

router.get('/login', ctrl.paginaLogin);

router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Indique o utilizador.').isLength({ max: 60 }),
    body('password').notEmpty().withMessage('Indique a password.').isLength({ max: 200 })
  ],
  validate,
  ctrl.login
);

router.post(
  '/gim/pin',
  [body('pin').trim().isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN invalido.')],
  validate,
  ctrl.loginPorPin
);

router.post('/logout', ctrl.logout);

module.exports = router;
