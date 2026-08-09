'use strict';

const caixaRepo = require('../repositories/caixa.repo');
const { AppError } = require('./AppError');
const { round2 } = require('../utils');

const TIPOS_MOVIMENTO = ['entrada', 'saida', 'sangria'];

async function estadoAtual() {
  const sessao = await caixaRepo.sessaoAberta();
  // Os movimentos sem sessao existem independentemente de haver caixa aberta:
  // sao um alerta permanente para o responsavel.
  const semSessao = await caixaRepo.totaisSemSessao();

  if (!sessao) return { sessao: null, movimentos: [], totais: null, resumo: null, semSessao };

  const [movimentos, totais] = await Promise.all([
    caixaRepo.movimentosDaSessao(sessao.id),
    caixaRepo.totaisVendas(sessao.id)
  ]);

  return { sessao, movimentos, totais, resumo: calcularResumo(sessao, movimentos, totais), semSessao };
}

/**
 * Dinheiro esperado em caixa =
 *   fundo inicial
 *   + dinheiro recebido em vendas antigas (liquido de troco)
 *   + total dos movimentos internos
 *   + entradas manuais - saidas - sangrias.
 *
 * Os movimentos internos CONTAM para o dinheiro esperado (regra confirmada
 * pelo cliente: fundo 20 + movimentos 5 => esperado 25).
 * O multibanco continua fora do valor fisico de caixa.
 */
function calcularResumo(sessao, movimentos, totais) {
  let entradas = 0;
  let saidas = 0;
  let sangrias = 0;
  for (const m of movimentos) {
    const valor = round2(m.valor);
    if (m.tipo === 'entrada') entradas = round2(entradas + valor);
    else if (m.tipo === 'saida') saidas = round2(saidas + valor);
    else sangrias = round2(sangrias + valor);
  }

  const fundo = round2(sessao.fundo_inicial);
  const vendasDinheiro = round2(totais.dinheiro);
  // `interno` pode nao vir de chamadores antigos: trata-se como 0, nunca NaN.
  const internos = round2(totais.interno || 0);
  const esperado = round2(fundo + vendasDinheiro + internos + entradas - saidas - sangrias);

  return {
    fundo_inicial: fundo,
    vendas_dinheiro: vendasDinheiro,
    vendas_multibanco: round2(totais.multibanco),
    vendas_total: round2(totais.total),
    movimentos_internos: internos,
    n_vendas: totais.n_vendas,
    entradas,
    saidas,
    sangrias,
    esperado
  };
}

async function abrir({ utilizadorId, fundoInicial }) {
  const aberta = await caixaRepo.sessaoAberta();
  if (aberta) throw new AppError('Ja existe uma sessao de caixa aberta.', 409);

  const fundo = round2(fundoInicial);
  if (fundo < 0) throw new AppError('O fundo inicial nao pode ser negativo.', 400);

  const id = await caixaRepo.abrir({ utilizador_id: utilizadorId, fundo_inicial: fundo });
  return { id, fundo_inicial: fundo };
}

async function registarMovimento({ tipo, valor, descricao }) {
  if (!TIPOS_MOVIMENTO.includes(tipo)) throw new AppError('Tipo de movimento invalido.', 400);

  const sessao = await caixaRepo.sessaoAberta();
  if (!sessao) throw new AppError('Nao existe caixa aberta.', 409);

  const montante = round2(valor);
  if (!(montante > 0)) throw new AppError('O valor tem de ser positivo.', 400);

  await caixaRepo.registarMovimento({
    sessao_caixa_id: sessao.id,
    tipo,
    valor: montante,
    descricao
  });
  return { sessaoId: sessao.id };
}

async function fechar({ totalContado }) {
  const estado = await estadoAtual();
  if (!estado.sessao) throw new AppError('Nao existe caixa aberta.', 409);

  const contado = round2(totalContado);
  if (contado < 0) throw new AppError('O valor contado nao pode ser negativo.', 400);

  const diferenca = round2(contado - estado.resumo.esperado);
  await caixaRepo.fechar(estado.sessao.id, { total_contado: contado, diferenca });

  return {
    id: estado.sessao.id,
    total_contado: contado,
    esperado: estado.resumo.esperado,
    diferenca
  };
}

async function detalheSessao(id) {
  const sessao = await caixaRepo.porId(id);
  if (!sessao) return null;
  const [movimentos, totais] = await Promise.all([
    caixaRepo.movimentosDaSessao(id),
    caixaRepo.totaisVendas(id)
  ]);
  return { sessao, movimentos, totais, resumo: calcularResumo(sessao, movimentos, totais) };
}

async function historico(limite) {
  return caixaRepo.historico(limite);
}

module.exports = {
  estadoAtual,
  abrir,
  registarMovimento,
  fechar,
  detalheSessao,
  historico,
  calcularResumo
};
