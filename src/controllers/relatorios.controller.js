'use strict';

const relatoriosService = require('../services/relatorios.service');
const { hojeISO, diasAtrasISO } = require('../utils');

async function dashboard(req, res) {
  const dados = await relatoriosService.dashboard();
  res.render('admin/dashboard', { titulo: 'Dashboard', ...dados });
}

async function relatorios(req, res) {
  const de = req.query.de || diasAtrasISO(30);
  const ate = req.query.ate || hojeISO();
  const dados = await relatoriosService.periodo(de, ate, { topN: 15 });
  res.render('admin/relatorios/index', { titulo: 'Relatorios', ...dados });
}

module.exports = { dashboard, relatorios };
