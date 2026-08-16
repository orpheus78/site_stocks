'use strict';

const relatoriosRepo = require('../repositories/relatorios.repo');
const stocksRepo = require('../repositories/stocks.repo');
const { hojeISO, diasAtrasISO, calcularMargem } = require('../utils');

/**
 * Junta a cada linha de um agregado (por artigo ou por categoria) a margem
 * correspondente. A conta e a mesma da listagem de artigos
 * (utils.calcularMargem): margem = venda - custo, percentagem sobre a VENDA e
 * `null` quando nao ha venda (nunca NaN nem Infinity no ecra).
 */
function comMargem(linhas) {
  return (linhas || []).map((linha) => {
    const m = calcularMargem(linha.total, linha.custo);
    return { ...linha, custo: m.custo, margem: m.margem, margem_pct: m.percentagem };
  });
}

async function periodo(de, ate, { topN = 10 } = {}) {
  const inicio = de || hojeISO();
  const fim = ate || hojeISO();

  const [resumo, porDia, top, porCategoria, custos, porArtigo, stockBaixo] = await Promise.all([
    relatoriosRepo.resumoConsumos(inicio, fim),
    relatoriosRepo.consumosPorDia(inicio, fim),
    relatoriosRepo.topArtigos(inicio, fim, topN),
    relatoriosRepo.consumosPorCategoria(inicio, fim),
    relatoriosRepo.custoConsumos(inicio, fim),
    relatoriosRepo.margemPorArtigo(inicio, fim),
    stocksRepo.alertasStockBaixo()
  ]);

  // Base da margem do periodo: o `total` dos consumos — o mesmo numero do KPI
  // "Total consumido" e do fecho de caixa — para nao existirem duas contas
  // divergentes na aplicacao.
  const rentabilidade = calcularMargem(resumo.total, custos.custo);

  return {
    de: inicio,
    ate: fim,
    resumo,
    porDia,
    top,
    porCategoria: comMargem(porCategoria),
    rentabilidade,
    margemPorArtigo: comMargem(porArtigo),
    stockBaixo
  };
}

async function dashboard() {
  const hoje = hojeISO();
  const [hojeResumo, semana, top5, stockBaixo] = await Promise.all([
    relatoriosRepo.resumoConsumos(hoje, hoje),
    relatoriosRepo.consumosPorDia(diasAtrasISO(6), hoje),
    relatoriosRepo.topArtigos(hoje, hoje, 5),
    stocksRepo.alertasStockBaixo()
  ]);

  return { hoje, resumoHoje: hojeResumo, ultimos7Dias: semana, top5, stockBaixo };
}

module.exports = { periodo, dashboard, comMargem };
