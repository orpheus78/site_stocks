'use strict';

const db = require('../config/db');
const consumosRepo = require('../repositories/consumos.repo');
const artigosRepo = require('../repositories/artigos.repo');
const caixaRepo = require('../repositories/caixa.repo');
const stockService = require('./stock.service');
const { AppError } = require('./AppError');
const { round2, num } = require('../utils');

/**
 * `interno` e o metodo do ecra de MOVIMENTOS INTERNOS (nao ha cobranca ao
 * balcao): o consumo e registado com o total, sem valor_dinheiro, sem
 * multibanco e sem troco. O `total` CONTA para o dinheiro esperado no fecho
 * de caixa (ver caixa.repo.totaisConsumos / caixa.service.calcularResumo).
 * Os restantes metodos existem para o HISTORICO e para clientes antigos da API.
 */
const METODO_INTERNO = 'interno';
const METODOS = ['dinheiro', 'multibanco', 'misto', METODO_INTERNO];

/**
 * Calcula os valores de pagamento a partir do total e do que o cliente entregou.
 * Os precos NUNCA vem do cliente: sao sempre lidos da BD.
 *
 * Sem `metodo_pagamento` no payload assume-se `interno` (o GIM deixou de
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
  // `interno` (ver caixa.repo.totaisConsumos), nao pelo valor_dinheiro.
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
    throw new AppError('Valor entregue inferior ao total do consumo.', 400);
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

/** Soma dos subtotais das linhas do carrinho: o total do consumo (sem IVA em lado nenhum). */
function calcularTotalCarrinho(linhas) {
  return linhas.reduce((acc, linha) => round2(acc + linha.subtotal), 0);
}

/**
 * Descreve o aviso de stock a devolver ao GIM depois de descontar um artigo.
 *
 * Funcao pura (sem BD) para ser testavel isoladamente. Devolve `null` quando
 * nao ha nada a assinalar. Os avisos sao SEMPRE informativos: o consumo ja foi
 * registado e nunca e bloqueado por causa de stock.
 *
 * @param {string} nome nome do artigo (snapshot do consumo)
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
 * Cria um consumo: cabecalho + itens + desconto de stock + movimentos,
 * tudo numa unica transacao.
 */
async function criarConsumo({ itens, pagamento, utilizadorId }) {
  const agregados = agregarItens(itens);

  const sessao = await caixaRepo.sessaoAberta();

  return db.transaction(async (conn) => {
    const linhas = [];

    for (const [artigoId, quantidade] of agregados) {
      const artigo = await artigosRepo.porId(artigoId, conn);
      if (!artigo) throw new AppError(`Artigo ${artigoId} nao encontrado.`, 404);
      const precoUnit = round2(artigo.preco);
      // Snapshot do CUSTO, lido da BD tal como o preco (nunca do cliente).
      // Congelar o custo aqui e o que garante que alterar amanha o preco de
      // compra do artigo nao reescreve a margem dos consumos ja registados.
      const custoUnit = round2(num(artigo.preco_custo, 0));
      const subtotal = calcularSubtotal(precoUnit, quantidade);
      linhas.push({
        artigo_id: artigo.id,
        nome_snapshot: artigo.nome,
        preco_unit: precoUnit,
        custo_unit: custoUnit,
        quantidade,
        subtotal
      });
    }

    // Sem IVA: o total e simplesmente a soma dos subtotais.
    const total = calcularTotalCarrinho(linhas);
    const valores = calcularPagamento(total, pagamento || {});
    const numero = await consumosRepo.proximoNumero(conn);

    const consumoId = await consumosRepo.criar(
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
      await consumosRepo.criarItem({ consumo_id: consumoId, ...linha }, conn);
      const resultado = await stockService.aplicarMovimento(conn, {
        artigoId: linha.artigo_id,
        tipo: 'consumo',
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

    return { id: consumoId, numero, total, ...valores, avisosStock, avisosStockDetalhe };
  });
}

/**
 * MENSAGEM UNICA de recusa da anulacao feita pelo proprio operador.
 *
 * E deliberadamente a mesma para todas as condicoes que falham (nao e teu,
 * ja esta anulado, nao tem caixa, a caixa fechou). Distinguir os casos
 * revelaria a existencia e o estado de movimentos de outras pessoas a quem
 * so tem de saber que nao pode.
 */
const MSG_ANULAR_RECUSADO =
  'So pode anular movimentos seus enquanto a caixa estiver aberta. Peca ao responsavel.';

/**
 * Espelho PURO das condicoes acima, para o ecra decidir se mostra o botao
 * "Anular". E so usabilidade: a autorizacao a serio e a de cima, no servidor,
 * dentro da transacao. Esconder o botao nunca e a proteccao.
 *
 * Recebe uma linha de `listarDoUtilizador` (traz `sessao_estado` do LEFT JOIN).
 */
function podeOperadorAnular(consumo, operadorId) {
  if (!consumo) return false;
  if (Number(consumo.utilizador_id) !== Number(operadorId)) return false;
  if (consumo.estado !== 'concluida') return false;
  if (!consumo.sessao_caixa_id) return false;
  return consumo.sessao_estado === 'aberta';
}

/**
 * Condicoes para um OPERADOR (perfil funcionario) poder anular um consumo.
 * Todas verificadas no servidor, com o consumo ja bloqueado pela transacao:
 *
 *  1. o consumo e dele (`utilizador_id` da BD contra o id da SESSAO);
 *  2. esta `concluida` (nao se anula duas vezes);
 *  3. tem sessao de caixa associada E essa sessao ainda esta aberta.
 *
 * A condicao 3 exclui de proposito os consumos ORFAOS (registados sem caixa
 * aberta, com `sessao_caixa_id` NULL): esses ficaram fora de qualquer fecho e
 * so o admin lhes pode tocar.
 *
 * A sessao e lida com FOR UPDATE para que um fecho de caixa concorrente fique
 * a espera do commit desta transacao -- sem isso haveria uma janela entre a
 * verificacao e a escrita.
 */
async function garantirOperadorPodeAnular(conn, consumo, operadorId) {
  const recusar = () => {
    throw new AppError(MSG_ANULAR_RECUSADO, 403);
  };

  if (Number(consumo.utilizador_id) !== Number(operadorId)) recusar();
  if (consumo.estado !== 'concluida') recusar();
  if (!consumo.sessao_caixa_id) recusar();

  const sessao = await caixaRepo.porIdParaAtualizar(consumo.sessao_caixa_id, conn);
  if (!sessao || sessao.estado !== 'aberta') recusar();
}

/**
 * Anula um consumo concluido e repoe o stock dos seus itens.
 *
 * `opcoes.exigirDonoId` liga as restricoes do OPERADOR (perfil funcionario):
 * so anula movimentos seus, ainda `concluida`, e so enquanto a sessao de caixa
 * em que foram registados continuar aberta. Sem essa opcao (caso do admin) o
 * comportamento e o de sempre: anula qualquer consumo.
 *
 * As verificacoes correm DENTRO da transacao e com as linhas bloqueadas
 * (consumo e sessao de caixa), para nao existir janela entre verificar e
 * escrever.
 */
async function anularConsumo(consumoId, utilizadorId, opcoes = {}) {
  const donoExigido = Number(opcoes.exigirDonoId);
  const comRestricoes = Number.isInteger(donoExigido) && donoExigido > 0;

  return db.transaction(async (conn) => {
    const consumo = await consumosRepo.porIdParaAtualizar(consumoId, conn);
    if (!consumo) throw new AppError('Movimento nao encontrado.', 404);

    // Antes de tudo o resto: quem nao pode, nao pode. A mensagem e sempre a
    // mesma, seja qual for a condicao que falhou -- assim nao revela nada
    // sobre movimentos de outras pessoas.
    if (comRestricoes) {
      await garantirOperadorPodeAnular(conn, consumo, donoExigido);
    }

    if (consumo.estado === 'anulada') throw new AppError('Movimento ja se encontra anulado.', 409);

    const itens = await consumosRepo.itensDaConsumo(consumoId, conn);
    for (const item of itens) {
      if (!item.artigo_id) continue; // artigo entretanto eliminado: nada a repor
      await stockService.aplicarMovimento(conn, {
        artigoId: item.artigo_id,
        tipo: 'entrada',
        quantidade: Number(item.quantidade),
        motivo: `Anulacao do movimento #${consumo.numero}`,
        utilizadorId
      });
    }

    await consumosRepo.anular(consumoId, conn);
    return { id: consumoId, numero: consumo.numero };
  });
}

async function detalhe(consumoId) {
  const consumo = await consumosRepo.porId(consumoId);
  if (!consumo) return null;
  const itens = await consumosRepo.itensDaConsumo(consumoId);
  return { consumo, itens };
}

async function listar(filtros) {
  return consumosRepo.listar(filtros);
}

/**
 * Movimentos de UM utilizador (ecra "os meus movimentos" do GIM).
 *
 * O `utilizadorId` tem de vir da SESSAO do servidor. Esta funcao recusa
 * qualquer valor que nao seja um id inteiro positivo, mas a garantia real esta
 * em quem chama: nunca aceitar este valor da query string nem do body, senao
 * bastava ?utilizador_id=1 para um funcionario ver o turno de outra pessoa.
 *
 * Nao devolve preco de custo nem margem: sao informacao de gestao e nao saem
 * do backoffice (ver consumos.repo.listarDoUtilizador).
 */
async function listarDoUtilizador(utilizadorId, { de, ate, limite = 200 } = {}) {
  const id = Number(utilizadorId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('Utilizador invalido.', 400);
  }
  return consumosRepo.listarDoUtilizador(id, { de, ate, limite });
}

module.exports = {
  criarConsumo,
  anularConsumo,
  podeOperadorAnular,
  MSG_ANULAR_RECUSADO,
  detalhe,
  listar,
  listarDoUtilizador,
  calcularPagamento,
  agregarItens,
  calcularSubtotal,
  calcularTotalCarrinho,
  descreverAvisoStock
};
