'use strict';

const stockService = require('../services/stock.service');
const movRepo = require('../repositories/movimentosStock.repo');
const artigosRepo = require('../repositories/artigos.repo');
const { setFlash } = require('../middleware/auth');

async function listar(req, res) {
  const apenasBaixo = req.query.baixo === '1';
  const termo = req.query.q || null;
  const stocks = await stockService.listarStocks({ apenasBaixo, termo });
  res.render('admin/stocks/index', { titulo: 'Stocks', stocks, apenasBaixo, termo });
}

/** Entrada / saida / ajuste manual de stock. */
async function movimento(req, res) {
  const { artigo_id, tipo, quantidade, motivo } = req.body;
  await stockService.movimentoManual({
    artigoId: Number(artigo_id),
    tipo,
    quantidade: Number(quantidade),
    motivo,
    utilizadorId: req.session.utilizador.id
  });
  setFlash(req, 'success', 'Movimento de stock registado.');
  res.redirect('/admin/stocks');
}

async function atualizarParametros(req, res) {
  const { stock_minimo, unidade } = req.body;
  await stockService.atualizarParametros(Number(req.params.artigoId), { stock_minimo, unidade });
  setFlash(req, 'success', 'Parametros de stock atualizados.');
  res.redirect('/admin/stocks');
}

async function historicoMovimentos(req, res) {
  const filtros = {
    artigoId: req.query.artigo ? Number(req.query.artigo) : null,
    tipo: req.query.tipo || null,
    de: req.query.de || null,
    ate: req.query.ate || null,
    limite: 300
  };
  const [movimentos, artigos] = await Promise.all([
    movRepo.listar(filtros),
    artigosRepo.listar()
  ]);
  res.render('admin/movimentos/index', {
    titulo: 'Movimentos de stock',
    movimentos,
    artigos,
    filtros
  });
}

module.exports = { listar, movimento, atualizarParametros, historicoMovimentos };
