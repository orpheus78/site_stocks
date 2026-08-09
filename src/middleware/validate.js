'use strict';

const { validationResult } = require('express-validator');
const { setFlash } = require('./auth');

/**
 * Handler central de express-validator.
 * - Pedidos /api/* respondem 422 com a lista de erros.
 * - Formularios voltam para tras com flash message.
 */
function validate(req, res, next) {
  const resultado = validationResult(req);
  if (resultado.isEmpty()) return next();

  const erros = resultado.array().map((e) => ({ campo: e.path, mensagem: e.msg }));

  if (req.path.startsWith('/api/')) {
    return res.status(422).json({ erro: 'Dados invalidos', erros });
  }

  setFlash(req, 'danger', erros.map((e) => e.mensagem).join(' | '));
  return res.redirect(req.get('referer') || '/');
}

module.exports = { validate };
