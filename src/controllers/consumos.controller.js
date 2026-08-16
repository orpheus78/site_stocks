'use strict';

const consumosService = require('../services/consumos.service');
const { setFlash } = require('../middleware/auth');
const { hojeISO, diasAtrasISO } = require('../utils');

async function listar(req, res) {
  const filtros = {
    de: req.query.de || diasAtrasISO(7),
    ate: req.query.ate || hojeISO(),
    estado: req.query.estado || null,
    metodo: req.query.metodo || null,
    limite: 200
  };
  const consumos = await consumosService.listar(filtros);
  const totalPeriodo = consumos
    .filter((v) => v.estado === 'concluida')
    .reduce((acc, v) => acc + Number(v.total), 0);

  res.render('admin/consumos/index', { titulo: 'Movimentos Internos', consumos, filtros, totalPeriodo });
}

async function detalhe(req, res) {
  const dados = await consumosService.detalhe(req.params.id);
  if (!dados) return res.status(404).render('errors/404', { titulo: 'Movimento nao encontrado' });
  res.render('admin/consumos/detalhe', {
    titulo: `Movimento #${dados.consumo.numero}`,
    consumo: dados.consumo,
    itens: dados.itens
  });
}

async function anular(req, res) {
  const resultado = await consumosService.anularConsumo(Number(req.params.id), req.session.utilizador.id);
  setFlash(req, 'success', `Movimento #${resultado.numero} anulado e stock reposto.`);
  res.redirect('/admin/consumos');
}

module.exports = { listar, detalhe, anular };
