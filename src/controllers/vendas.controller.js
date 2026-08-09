'use strict';

const vendasService = require('../services/vendas.service');
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
  const vendas = await vendasService.listar(filtros);
  const totalPeriodo = vendas
    .filter((v) => v.estado === 'concluida')
    .reduce((acc, v) => acc + Number(v.total), 0);

  res.render('admin/vendas/index', { titulo: 'Movimentos Internos', vendas, filtros, totalPeriodo });
}

async function detalhe(req, res) {
  const dados = await vendasService.detalhe(req.params.id);
  if (!dados) return res.status(404).render('errors/404', { titulo: 'Movimento nao encontrado' });
  res.render('admin/vendas/detalhe', {
    titulo: `Movimento #${dados.venda.numero}`,
    venda: dados.venda,
    itens: dados.itens
  });
}

async function anular(req, res) {
  const resultado = await vendasService.anularVenda(Number(req.params.id), req.session.utilizador.id);
  setFlash(req, 'success', `Movimento #${resultado.numero} anulado e stock reposto.`);
  res.redirect('/admin/vendas');
}

module.exports = { listar, detalhe, anular };
