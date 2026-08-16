'use strict';

const artigosRepo = require('../repositories/artigos.repo');
const categoriasRepo = require('../repositories/categorias.repo');
const caixaRepo = require('../repositories/caixa.repo');
const consumosService = require('../services/consumos.service');
const stockService = require('../services/stock.service');

/**
 * Ecra de registo de MOVIMENTOS INTERNOS (o antigo ecra de consumo).
 *
 * O registo NUNCA e bloqueado por nao haver caixa aberta: o funcionario nao
 * tem permissao para abrir caixa e nao pode ficar parado ao balcao. Mas como
 * os movimentos internos passaram a contar para o dinheiro esperado em caixa,
 * um movimento registado sem sessao fica fora de qualquer fecho — por isso
 * mostra-se um aviso (com atalho para /caixa apenas ao admin).
 */
async function ecra(req, res) {
  const sessao = await caixaRepo.sessaoAberta();

  res.render('gim/index', {
    titulo: 'Movimentos Internos',
    layoutSemNav: true,
    bodyClass: 'gim-body',
    estilos: ['/css/gim.css'],
    scripts: ['/js/gim.js'],
    caixaAberta: Boolean(sessao)
  });
}

/**
 * Catalogo para o GIM: categorias + artigos ativos com stock atual.
 *
 * Alem do stock, cada artigo traz `stock_minimo` e o booleano derivado
 * `stock_baixo`, para o GIM poder sinalizar no tile os artigos a acabar sem
 * ter de conhecer a regra de negocio (que vive no stock.service).
 */
async function catalogo(req, res) {
  const [categorias, artigos] = await Promise.all([
    categoriasRepo.listar({ apenasAtivas: true }),
    artigosRepo.listar({ apenasAtivos: true })
  ]);

  res.json({
    categorias: categorias.map((c) => ({ id: c.id, nome: c.nome, cor: c.cor, ordem: c.ordem })),
    artigos: artigos.map((a) => {
      // Artigo sem linha de stock -> stock/minimo a null e sem alerta.
      const estado = stockService.estadoStockArtigo(a.quantidade, a.stock_minimo);
      return {
        id: a.id,
        categoria_id: a.categoria_id,
        nome: a.nome,
        preco: Number(a.preco),
        imagem: a.imagem ? `/uploads/${a.imagem}` : null,
        stock: estado.stock,
        unidade: a.unidade || 'un',
        stock_minimo: estado.stock_minimo,
        stock_baixo: estado.stock_baixo
      };
    })
  });
}

async function criarConsumo(req, res) {
  const { itens, metodo_pagamento, valor_dinheiro, valor_multibanco } = req.body;

  const consumo = await consumosService.criarConsumo({
    itens,
    pagamento: { metodo_pagamento, valor_dinheiro, valor_multibanco },
    utilizadorId: req.session.utilizador.id
  });

  res.status(201).json({
    ok: true,
    consumo,
    // Nao existe comprovativo: esta aplicacao e de controlo interno e nao
    // emite qualquer documento para o cliente.
    // `avisos`: lista de mensagens (contrato historico, mantido para nao
    // partir clientes existentes). `avisos_stock`: as mesmas mensagens com
    // `tipo` ('stock_baixo' | 'stock_negativo') para o GIM as poder distinguir.
    avisos: consumo.avisosStock,
    avisos_stock: consumo.avisosStockDetalhe
  });
}

module.exports = { ecra, catalogo, criarConsumo };
