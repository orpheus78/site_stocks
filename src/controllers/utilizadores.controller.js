'use strict';

const utilizadoresService = require('../services/utilizadores.service');
const { setFlash } = require('../middleware/auth');
const { AppError } = require('../services/AppError');
const { boolCampo } = require('../utils');

/**
 * Erros de REGRA DE NEGOCIO (PIN repetido, username duplicado, ultimo admin)
 * voltam para o formulario com uma flash message, tal como o resto do
 * backoffice faz na validacao. Qualquer outro erro sobe para o handler central.
 *
 * As mensagens vem do servico e nunca contem password nem PIN.
 */
async function comFlash(req, res, destinoErro, accao) {
  try {
    await accao();
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      setFlash(req, 'danger', err.message);
      return res.redirect(destinoErro);
    }
    throw err;
  }
  return null;
}

async function listar(req, res) {
  const utilizadores = await utilizadoresService.listar();
  res.render('admin/utilizadores/index', {
    titulo: 'Utilizadores',
    utilizadores,
    // Para a view saber que linha e a do proprio (nao mostrar "Desactivar").
    utilizadorAtualId: req.session.utilizador.id
  });
}

function formularioCriar(req, res) {
  res.render('admin/utilizadores/form', { titulo: 'Novo utilizador', alvo: null });
}

async function criar(req, res) {
  const { nome, username, password, pin, role } = req.body;

  const erro = await comFlash(req, res, '/admin/utilizadores/novo', async () => {
    await utilizadoresService.criar({
      nome,
      username,
      password,
      pin,
      role,
      ativo: boolCampo(req.body.ativo, true)
    });
    setFlash(req, 'success', `Utilizador «${String(nome).trim()}» criado.`);
    res.redirect('/admin/utilizadores');
  });
  return erro;
}

async function formularioEditar(req, res) {
  // Vem sem password_hash nem pin_hash: nao ha credenciais a caminho do ecra.
  const alvo = await utilizadoresService.porId(req.params.id);
  if (!alvo) return res.status(404).render('errors/404', { titulo: 'Utilizador nao encontrado' });
  return res.render('admin/utilizadores/form', { titulo: `Editar ${alvo.nome}`, alvo });
}

async function atualizar(req, res) {
  const id = Number(req.params.id);
  const { nome, username, password, pin, role } = req.body;

  return comFlash(req, res, `/admin/utilizadores/${id}/editar`, async () => {
    await utilizadoresService.atualizar(
      id,
      { nome, username, password, pin, role, ativo: boolCampo(req.body.ativo, false) },
      req.session.utilizador.id
    );
    setFlash(req, 'success', 'Utilizador actualizado.');
    res.redirect('/admin/utilizadores');
  });
}

async function desactivar(req, res) {
  const id = Number(req.params.id);

  return comFlash(req, res, '/admin/utilizadores', async () => {
    const resultado = await utilizadoresService.desactivar(id, req.session.utilizador.id);
    setFlash(
      req,
      resultado.jaEstava ? 'warning' : 'success',
      resultado.jaEstava
        ? `«${resultado.nome}» ja estava desactivado.`
        : `«${resultado.nome}» foi desactivado. O historico dos movimentos dele mantem-se.`
    );
    res.redirect('/admin/utilizadores');
  });
}

async function activar(req, res) {
  const id = Number(req.params.id);

  return comFlash(req, res, '/admin/utilizadores', async () => {
    const resultado = await utilizadoresService.activar(id);
    setFlash(req, 'success', `«${resultado.nome}» foi reactivado.`);
    res.redirect('/admin/utilizadores');
  });
}

module.exports = {
  listar,
  formularioCriar,
  criar,
  formularioEditar,
  atualizar,
  desactivar,
  activar
};
