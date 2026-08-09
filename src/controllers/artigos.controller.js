'use strict';

const artigosRepo = require('../repositories/artigos.repo');
const categoriasRepo = require('../repositories/categorias.repo');
const stocksRepo = require('../repositories/stocks.repo');
const stockService = require('../services/stock.service');
const { setFlash } = require('../middleware/auth');
const { removerImagem } = require('../middleware/upload');
const { round2, boolCampo } = require('../utils');

async function listar(req, res) {
  const categoriaId = req.query.categoria ? Number(req.query.categoria) : null;
  const [artigos, categorias] = await Promise.all([
    artigosRepo.listar({ categoriaId }),
    categoriasRepo.listar()
  ]);
  res.render('admin/artigos/index', { titulo: 'Artigos', artigos, categorias, categoriaId });
}

async function formularioCriar(req, res) {
  const categorias = await categoriasRepo.listar();
  res.render('admin/artigos/form', { titulo: 'Novo artigo', artigo: null, categorias });
}

async function criar(req, res) {
  if (req.uploadErro) {
    setFlash(req, 'danger', req.uploadErro);
    return res.redirect('/admin/artigos/novo');
  }

  const { categoria_id, nome, preco, ativo, ordem, stock_inicial, stock_minimo, unidade } = req.body;

  const artigoId = await artigosRepo.criar({
    categoria_id: categoria_id ? Number(categoria_id) : null,
    nome,
    preco: round2(preco),
    imagem: req.file ? req.file.filename : null,
    ativo: boolCampo(ativo, true),
    ordem: Number(ordem) || 0
  });

  await stocksRepo.garantirLinha(artigoId, {
    unidade: unidade || 'un',
    stock_minimo: round2(stock_minimo || 0)
  });
  await stocksRepo.atualizarParametros(artigoId, {
    stock_minimo: round2(stock_minimo || 0),
    unidade: unidade || 'un'
  });

  if (Number(stock_inicial) > 0) {
    await stockService.movimentoManual({
      artigoId,
      tipo: 'entrada',
      quantidade: round2(stock_inicial),
      motivo: 'Stock inicial',
      utilizadorId: req.session.utilizador.id
    });
  }

  setFlash(req, 'success', 'Artigo criado.');
  res.redirect('/admin/artigos');
}

async function formularioEditar(req, res) {
  const [artigo, categorias] = await Promise.all([
    artigosRepo.porId(req.params.id),
    categoriasRepo.listar()
  ]);
  if (!artigo) return res.status(404).render('errors/404', { titulo: 'Artigo nao encontrado' });
  res.render('admin/artigos/form', { titulo: 'Editar artigo', artigo, categorias });
}

async function atualizar(req, res) {
  const artigo = await artigosRepo.porId(req.params.id);
  if (!artigo) return res.status(404).render('errors/404', { titulo: 'Artigo nao encontrado' });

  if (req.uploadErro) {
    setFlash(req, 'danger', req.uploadErro);
    return res.redirect(`/admin/artigos/${artigo.id}/editar`);
  }

  const { categoria_id, nome, preco, ativo, ordem, stock_minimo, unidade, remover_imagem } = req.body;

  let imagem = artigo.imagem;
  if (req.file) {
    imagem = req.file.filename;
    removerImagem(artigo.imagem);
  } else if (remover_imagem) {
    removerImagem(artigo.imagem);
    imagem = null;
  }

  await artigosRepo.atualizar(artigo.id, {
    categoria_id: categoria_id ? Number(categoria_id) : null,
    nome,
    preco: round2(preco),
    imagem,
    ativo: boolCampo(ativo),
    ordem: Number(ordem) || 0
  });

  await stocksRepo.garantirLinha(artigo.id);
  await stocksRepo.atualizarParametros(artigo.id, {
    stock_minimo: round2(stock_minimo || 0),
    unidade: unidade || 'un'
  });

  setFlash(req, 'success', 'Artigo atualizado.');
  res.redirect('/admin/artigos');
}

async function remover(req, res) {
  const artigo = await artigosRepo.porId(req.params.id);
  if (!artigo) return res.status(404).render('errors/404', { titulo: 'Artigo nao encontrado' });

  // Artigos ja vendidos nunca sao eliminados: preservam o historico e os relatorios.
  if (await artigosRepo.temVendas(artigo.id)) {
    await artigosRepo.desativar(artigo.id);
    setFlash(req, 'warning', 'Artigo com movimentos registados: foi desativado em vez de eliminado.');
  } else {
    await artigosRepo.remover(artigo.id);
    removerImagem(artigo.imagem);
    setFlash(req, 'success', 'Artigo eliminado.');
  }
  res.redirect('/admin/artigos');
}

module.exports = { listar, formularioCriar, criar, formularioEditar, atualizar, remover };
