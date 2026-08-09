'use strict';

const relatoriosRepo = require('../repositories/relatorios.repo');
const stocksRepo = require('../repositories/stocks.repo');
const { hojeISO, diasAtrasISO } = require('../utils');

async function periodo(de, ate, { topN = 10 } = {}) {
  const inicio = de || hojeISO();
  const fim = ate || hojeISO();

  const [resumo, porDia, top, porCategoria, stockBaixo] = await Promise.all([
    relatoriosRepo.resumoVendas(inicio, fim),
    relatoriosRepo.vendasPorDia(inicio, fim),
    relatoriosRepo.topArtigos(inicio, fim, topN),
    relatoriosRepo.vendasPorCategoria(inicio, fim),
    stocksRepo.alertasStockBaixo()
  ]);

  return { de: inicio, ate: fim, resumo, porDia, top, porCategoria, stockBaixo };
}

async function dashboard() {
  const hoje = hojeISO();
  const [hojeResumo, semana, top5, stockBaixo] = await Promise.all([
    relatoriosRepo.resumoVendas(hoje, hoje),
    relatoriosRepo.vendasPorDia(diasAtrasISO(6), hoje),
    relatoriosRepo.topArtigos(hoje, hoje, 5),
    stocksRepo.alertasStockBaixo()
  ]);

  return { hoje, resumoHoje: hojeResumo, ultimos7Dias: semana, top5, stockBaixo };
}

module.exports = { periodo, dashboard };
