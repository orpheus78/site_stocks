'use strict';

const db = require('../config/db');
const vendasRepo = require('../repositories/vendas.repo');
const artigosRepo = require('../repositories/artigos.repo');
const caixaRepo = require('../repositories/caixa.repo');
const stockService = require('./stock.service');
const { AppError } = require('./AppError');
const { round2 } = require('../utils');

/**
 * `interno` e o metodo do ecra de MOVIMENTOS INTERNOS (nao ha cobranca ao
 * balcao): o consumo e registado com o total, sem valor_dinheiro, sem
 * multibanco e sem troco. O `total` CONTA para o dinheiro esperado no fecho
 * de caixa (ver caixa.repo.totaisVendas / caixa.service.calcularResumo).
 * Os restantes metodos existem para o HISTORICO e para clientes antigos da API.
 */
const METODO_INTERNO = 'interno';
const METODOS = ['dinheiro', 'multibanco', 'misto', METODO_INTERNO];

/**
 * Calcula os valores de pagamento a partir do total e do que o cliente entregou.
 * Os precos NUNCA vem do cliente: sao sempre lidos da BD.
 *
 * Sem `metodo_pagamento` no payload assume-se `interno` (o POS deixou de
 * enviar metodo: o ecra e de registo de movimentos, nao de venda com dinheiro).
 */
function calcularPagamento(total, { metodo_pagamento, valor_dinheiro = 0, valor_multibanco = 0 }) {
  const metodo = metodo_pagamento === undefined || metodo_pagamento === null || metodo_pagamento === ''
    ? METODO_INTERNO
    : metodo_pagamento;

  if (!METODOS.includes(metodo)) {
    throw new AppError('Metodo de pagamento invalido.', 400);
  }

  // Movimento interno: nao ha cobranca, logo nunca ha troco nem multibanco.
  // O `total` entra no dinheiro esperado em caixa pela via do agregado
  // `interno` (ver caixa.repo.totaisVendas), nao pelo valor_dinheiro.
  if (metodo === METODO_INTERNO) {
    return { metodo_pagamento: METODO_INTERNO, valor_dinheiro: 0, valor_multibanco: 0, troco: 0 };
  }

  const metodo_pagamento_final = metodo;
  let dinheiro = round2(valor_dinheiro);
  let multibanco = round2(valor_multibanco);

  if (metodo_pagamento_final === 'multibanco') {
    multibanco = total;
    dinheiro = 0;
  } else if (metodo_pagamento_final === 'dinheiro') {
    multibanco = 0;
    if (dinheiro <= 0) dinheiro = total; // valor certo
  } else {
    if (multibanco <= 0 || dinheiro <= 0) {
      throw new AppError('Pagamento misto exige valor em dinheiro e em multibanco.', 400);
    }
  }

  const entregue = round2(dinheiro + multibanco);
  if (entregue + 0.001 < total) {
    throw new AppError('Valor entregue inferior ao total da venda.', 400);
  }

  // Troco apenas sobre a componente de dinheiro: o multibanco e uma cobranca
  // fixa (nao ha "troco de cartao"), pelo que o troco nunca pode exceder o
  // valor de dinheiro efetivamente entregue pelo cliente.
  const excedente = round2(entregue - total);
  const troco = metodo_pagamento_final === 'multibanco' ? 0 : Math.min(dinheiro, Math.max(excedente, 0));
  return {
    metodo_pagamento: metodo_pagamento_final,
    valor_dinheiro: dinheiro,
    valor_multibanco: multibanco,
    troco: round2(troco)
  };
}

/**
 * Agrega itens repetidos do mesmo artigo e valida artigo_id/quantidade.
 * Funcao pura (sem BD) para ser testavel isoladamente.
 *
 * @param {Array<{artigo_id: number, quantidade: number}>} itens
 * @returns {Map<number, number>} artigoId -> quantidade total agregada
 */
function agregarItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new AppError('O movimento tem de ter pelo menos um artigo.', 400);
  }

  const agregados = new Map();
  for (const item of itens) {
    const artigoId = Number(item.artigo_id);
    const quantidade = round2(item.quantidade);
    if (!Number.isInteger(artigoId) || artigoId <= 0) throw new AppError('Artigo invalido no movimento.', 400);
    if (!(quantidade > 0)) throw new AppError('Quantidade invalida no movimento.', 400);
    agregados.set(artigoId, round2((agregados.get(artigoId) || 0) + quantidade));
  }
  return agregados;
}

/** Subtotal de uma linha: preco unitario (sem IVA) vezes quantidade, arredondado a 2 casas. */
function calcularSubtotal(precoUnit, quantidade) {
  return round2(round2(precoUnit) * quantidade);
}

/** Soma dos subtotais das linhas do carrinho: o total da venda (sem IVA em lado nenhum). */
function calcularTotalCarrinho(linhas) {
  return linhas.reduce((acc, linha) => round2(acc + linha.subtotal), 0);
}

/**
 * Descreve o aviso de stock a devolver ao POS depois de descontar um artigo.
 *
 * Funcao pura (sem BD) para ser testavel isoladamente. Devolve `null` quando
 * nao ha nada a assinalar. Os avisos sao SEMPRE informativos: a venda ja foi
 * registada e nunca e bloqueada por causa de stock.
 *
 * @param {string} nome nome do artigo (snapshot da venda)
 * @param {number} artigoId
 * @param {{atual: number, negativo: boolean, baixo: boolean, stockMinimo: number, unidade: string}} resultado
 * @returns {{tipo: 'stock_baixo'|'stock_negativo', mensagem: string, artigo_id: number, artigo: string, quantidade: number, stock_minimo: number, unidade: string}|null}
 */
function descreverAvisoStock(nome, artigoId, resultado) {
  const base = {
    artigo_id: artigoId,
    artigo: nome,
    quantidade: resultado.atual,
    stock_minimo: resultado.stockMinimo,
    unidade: resultado.unidade || 'un'
  };

  // Stock negativo e o caso mais grave e ja implica stock baixo: um so aviso
  // por artigo, para nao encher o ecra de toasts a meio do servico.
  if (resultado.negativo) {
    return {
      tipo: 'stock_negativo',
      mensagem: `${nome} ficou com stock negativo (${resultado.atual}).`,
      ...base
    };
  }

  if (resultado.baixo) {
    return {
      tipo: 'stock_baixo',
      mensagem: `${nome}: restam ${resultado.atual} ${base.unidade} (minimo ${resultado.stockMinimo}). Avise o responsavel.`,
      ...base
    };
  }

  return null;
}

/**
 * Cria uma venda: cabecalho + itens + desconto de stock + movimentos,
 * tudo numa unica transacao.
 */
async function criarVenda({ itens, pagamento, utilizadorId }) {
  const agregados = agregarItens(itens);

  const sessao = await caixaRepo.sessaoAberta();

  return db.transaction(async (conn) => {
    const linhas = [];

    for (const [artigoId, quantidade] of agregados) {
      const artigo = await artigosRepo.porId(artigoId, conn);
      if (!artigo) throw new AppError(`Artigo ${artigoId} nao encontrado.`, 404);
      const precoUnit = round2(artigo.preco);
      const subtotal = calcularSubtotal(precoUnit, quantidade);
      linhas.push({
        artigo_id: artigo.id,
        nome_snapshot: artigo.nome,
        preco_unit: precoUnit,
        quantidade,
        subtotal
      });
    }

    // Sem IVA: o total e simplesmente a soma dos subtotais.
    const total = calcularTotalCarrinho(linhas);
    const valores = calcularPagamento(total, pagamento || {});
    const numero = await vendasRepo.proximoNumero(conn);

    const vendaId = await vendasRepo.criar(
      {
        numero,
        total,
        ...valores,
        utilizador_id: utilizadorId,
        sessao_caixa_id: sessao ? sessao.id : null
      },
      conn
    );

    const avisosStock = []; // mensagens de texto (contrato historico de `avisos`)
    const avisosStockDetalhe = []; // mesmas mensagens + `tipo` e contexto
    for (const linha of linhas) {
      await vendasRepo.criarItem({ venda_id: vendaId, ...linha }, conn);
      const resultado = await stockService.aplicarMovimento(conn, {
        artigoId: linha.artigo_id,
        tipo: 'venda',
        quantidade: linha.quantidade,
        motivo: `Movimento #${numero}`,
        utilizadorId
      });

      // Um aviso por artigo, do mais grave para o menos grave: stock negativo
      // ja implica stock baixo, e nao vale a pena repetir o mesmo artigo duas
      // vezes num ecra de balcao onde o operador tem pressa.
      const aviso = descreverAvisoStock(linha.nome_snapshot, linha.artigo_id, resultado);
      if (aviso) {
        avisosStock.push(aviso.mensagem);
        avisosStockDetalhe.push(aviso);
      }
    }

    return { id: vendaId, numero, total, ...valores, avisosStock, avisosStockDetalhe };
  });
}

/** Anula uma venda concluida e repoe o stock dos seus itens. */
async function anularVenda(vendaId, utilizadorId) {
  return db.transaction(async (conn) => {
    const venda = await vendasRepo.porIdParaAtualizar(vendaId, conn);
    if (!venda) throw new AppError('Movimento nao encontrado.', 404);
    if (venda.estado === 'anulada') throw new AppError('Movimento ja se encontra anulado.', 409);

    const itens = await vendasRepo.itensDaVenda(vendaId, conn);
    for (const item of itens) {
      if (!item.artigo_id) continue; // artigo entretanto eliminado: nada a repor
      await stockService.aplicarMovimento(conn, {
        artigoId: item.artigo_id,
        tipo: 'entrada',
        quantidade: Number(item.quantidade),
        motivo: `Anulacao do movimento #${venda.numero}`,
        utilizadorId
      });
    }

    await vendasRepo.anular(vendaId, conn);
    return { id: vendaId, numero: venda.numero };
  });
}

async function detalhe(vendaId) {
  const venda = await vendasRepo.porId(vendaId);
  if (!venda) return null;
  const itens = await vendasRepo.itensDaVenda(vendaId);
  return { venda, itens };
}

async function listar(filtros) {
  return vendasRepo.listar(filtros);
}

module.exports = {
  criarVenda,
  anularVenda,
  detalhe,
  listar,
  calcularPagamento,
  agregarItens,
  calcularSubtotal,
  calcularTotalCarrinho,
  descreverAvisoStock
};
