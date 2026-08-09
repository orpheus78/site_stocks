'use strict';

const categoriasRepo = require('../repositories/categorias.repo');
const { setFlash } = require('../middleware/auth');
const { boolCampo } = require('../utils');

async function listar(req, res) {
  const categorias = await categoriasRepo.listar();
  res.render('admin/categorias/index', { titulo: 'Categorias', categorias });
}

async function formularioCriar(req, res) {
  res.render('admin/categorias/form', { titulo: 'Nova categoria', categoria: null });
}

async function criar(req, res) {
  const { nome, cor, ordem, ativo } = req.body;
  await categoriasRepo.criar({
    nome,
    cor: cor || '#0d6efd',
    ordem: Number(ordem) || 0,
    ativo: boolCampo(ativo, true)
  });
  setFlash(req, 'success', 'Categoria criada.');
  res.redirect('/admin/categorias');
}

async function formularioEditar(req, res) {
  const categoria = await categoriasRepo.porId(req.params.id);
  if (!categoria) return res.status(404).render('errors/404', { titulo: 'Categoria nao encontrada' });
  res.render('admin/categorias/form', { titulo: 'Editar categoria', categoria });
}

async function atualizar(req, res) {
  const categoria = await categoriasRepo.porId(req.params.id);
  if (!categoria) return res.status(404).render('errors/404', { titulo: 'Categoria nao encontrada' });

  const { nome, cor, ordem, ativo } = req.body;
  await categoriasRepo.atualizar(categoria.id, {
    nome,
    cor: cor || categoria.cor,
    ordem: Number(ordem) || 0,
    ativo: boolCampo(ativo)
  });
  setFlash(req, 'success', 'Categoria atualizada.');
  res.redirect('/admin/categorias');
}

async function remover(req, res) {
  const categoria = await categoriasRepo.porId(req.params.id);
  if (!categoria) return res.status(404).render('errors/404', { titulo: 'Categoria nao encontrada' });

  const nArtigos = await categoriasRepo.contarArtigos(categoria.id);
  if (nArtigos > 0) {
    // Nao apagar categorias em uso: desativar preserva o historico de vendas.
    await categoriasRepo.atualizar(categoria.id, { ...categoria, ativo: false });
    setFlash(req, 'warning', `Categoria tem ${nArtigos} artigo(s); foi desativada em vez de eliminada.`);
  } else {
    await categoriasRepo.remover(categoria.id);
    setFlash(req, 'success', 'Categoria eliminada.');
  }
  res.redirect('/admin/categorias');
}

module.exports = { listar, formularioCriar, criar, formularioEditar, atualizar, remover };
