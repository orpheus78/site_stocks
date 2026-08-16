'use strict';

const db = require('../config/db');
const stocksRepo = require('../repositories/stocks.repo');
const movRepo = require('../repositories/movimentosStock.repo');
const artigosRepo = require('../repositories/artigos.repo');
const { AppError } = require('./AppError');
const { round2 } = require('../utils');

const TIPOS = ['entrada', 'saida', 'ajuste', 'consumo'];

/**
 * Calculo puro da nova quantidade de stock apos um movimento.
 * Extraido para ser testavel isoladamente, sem BD.
 *
 * @param {'entrada'|'saida'|'ajuste'|'consumo'} tipo
 * @param {number} atual  quantidade atual em stock
 * @param {number} quantidade  entrada: soma; saida/consumo: subtrai; ajuste: define o valor absoluto
 * @returns {number} nova quantidade (arredondada a 2 casas)
 */
function calcularNovaQuantidade(tipo, atual, quantidade) {
  const qtd = round2(quantidade);
  const base = round2(atual);
  let nova;
  if (tipo === 'entrada') nova = base + qtd;
  else if (tipo === 'saida' || tipo === 'consumo') nova = base - qtd;
  else nova = qtd; // ajuste: valor absoluto de inventario
  return round2(nova);
}

/** Verdadeiro quando a quantidade resultante indica stock negativo (aviso, nunca bloqueio). */
function isStockNegativo(quantidade) {
  return quantidade < 0;
}

/** Verdadeiro quando a quantidade em stock atingiu ou ficou abaixo do minimo definido. */
function isStockBaixo(quantidade, stockMinimo) {
  return Number(quantidade) <= Number(stockMinimo);
}

/**
 * Estado de stock de um artigo, normalizado para ser exposto ao GIM.
 *
 * Esta e a UNICA derivacao de "stock baixo" usada na aplicacao (a mesma regra
 * `quantidade <= stock_minimo` do backoffice e das queries de alertas), para
 * nao existirem duas definicoes divergentes.
 *
 * Um artigo sem linha de stock (`quantidade === null`) nao tem minimo definido:
 * nao ha alerta possivel, logo nunca e considerado stock baixo.
 *
 * @param {number|null|undefined} quantidade
 * @param {number|null|undefined} stockMinimo
 * @returns {{stock: number|null, stock_minimo: number|null, stock_baixo: boolean}}
 */
function estadoStockArtigo(quantidade, stockMinimo) {
  const semStock = { stock: null, stock_minimo: null, stock_baixo: false };
  if (quantidade === null || quantidade === undefined || quantidade === '') return semStock;

  const qtd = Number(quantidade);
  if (!Number.isFinite(qtd)) return semStock;

  // Sem minimo configurado assume-se 0: so alerta quando esgota mesmo.
  const minimoBruto = stockMinimo === null || stockMinimo === undefined ? 0 : Number(stockMinimo);
  const minimo = Number.isFinite(minimoBruto) ? minimoBruto : 0;

  return { stock: qtd, stock_minimo: minimo, stock_baixo: isStockBaixo(qtd, minimo) };
}

/**
 * Aplica um movimento de stock dentro de uma ligacao/transacao existente.
 *
 * DECISAO DE NEGOCIO: o stock PODE ficar negativo.
 * Num bar de campo de futebol o registo de consumo nunca pode ser bloqueado por
 * divergencias de inventario (ex.: entrada de mercadoria ainda por registar).
 * O movimento e sempre registado e a quantidade resultante negativa fica
 * visivel nos alertas de stock para correcao posterior.
 *
 * @param {'entrada'|'saida'|'ajuste'|'consumo'} tipo
 * @param {number} quantidade  entrada: soma; saida/consumo: subtrai; ajuste: define o valor absoluto
 */
async function aplicarMovimento(conn, { artigoId, tipo, quantidade, motivo, utilizadorId }) {
  if (!TIPOS.includes(tipo)) throw new AppError(`Tipo de movimento invalido: ${tipo}`, 400);

  const qtd = round2(quantidade);
  if (tipo !== 'ajuste' && qtd <= 0) {
    throw new AppError('A quantidade do movimento tem de ser positiva.', 400);
  }

  await stocksRepo.garantirLinha(artigoId, {}, conn);
  const stock = await stocksRepo.porArtigoParaAtualizar(artigoId, conn);
  if (!stock) throw new AppError('Artigo sem registo de stock.', 404);

  const atual = Number(stock.quantidade);
  const stockMinimo = Number(stock.stock_minimo || 0);
  const novaQuantidade = calcularNovaQuantidade(tipo, atual, qtd);
  await stocksRepo.definirQuantidade(artigoId, novaQuantidade, conn);

  const quantidadeMovimento = tipo === 'ajuste' ? round2(novaQuantidade - atual) : qtd;
  await movRepo.registar(
    {
      artigo_id: artigoId,
      tipo,
      quantidade: quantidadeMovimento,
      quantidade_apos: novaQuantidade,
      motivo,
      utilizador_id: utilizadorId
    },
    conn
  );

  if (isStockNegativo(novaQuantidade)) {
    console.warn(`[stock] ATENCAO: artigo ${artigoId} ficou com stock negativo (${novaQuantidade}).`);
  }

  return {
    anterior: atual,
    atual: novaQuantidade,
    negativo: isStockNegativo(novaQuantidade),
    // Contexto para quem precisa de avisar (GIM): minimo, unidade e se ficou
    // abaixo do minimo. Nunca bloqueia nada -- e apenas informacao.
    stockMinimo,
    unidade: stock.unidade || 'un',
    baixo: isStockBaixo(novaQuantidade, stockMinimo)
  };
}

/** Movimento manual a partir do backoffice (abre a sua propria transacao). */
async function movimentoManual({ artigoId, tipo, quantidade, motivo, utilizadorId }) {
  const artigo = await artigosRepo.porId(artigoId);
  if (!artigo) throw new AppError('Artigo nao encontrado.', 404);

  return db.transaction((conn) =>
    aplicarMovimento(conn, { artigoId, tipo, quantidade, motivo, utilizadorId })
  );
}

async function listarStocks(filtros) {
  return stocksRepo.listar(filtros);
}

async function atualizarParametros(artigoId, { stock_minimo, unidade }) {
  await stocksRepo.garantirLinha(artigoId);
  await stocksRepo.atualizarParametros(artigoId, { stock_minimo: round2(stock_minimo), unidade });
}

async function alertas() {
  return stocksRepo.alertasStockBaixo();
}

module.exports = {
  aplicarMovimento,
  movimentoManual,
  listarStocks,
  atualizarParametros,
  alertas,
  calcularNovaQuantidade,
  isStockNegativo,
  isStockBaixo,
  estadoStockArtigo
};
