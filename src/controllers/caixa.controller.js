'use strict';

const caixaService = require('../services/caixa.service');
const { setFlash } = require('../middleware/auth');

async function ecra(req, res) {
  const [estado, historico] = await Promise.all([
    caixaService.estadoAtual(),
    caixaService.historico(20)
  ]);

  res.render('caixa/index', {
    titulo: 'Caixa',
    estado,
    historico
  });
}

async function abrir(req, res) {
  await caixaService.abrir({
    utilizadorId: req.session.utilizador.id,
    fundoInicial: req.body.fundo_inicial
  });
  setFlash(req, 'success', 'Caixa aberta.');
  res.redirect('/caixa');
}

async function movimento(req, res) {
  await caixaService.registarMovimento({
    tipo: req.body.tipo,
    valor: req.body.valor,
    descricao: req.body.descricao
  });
  setFlash(req, 'success', 'Movimento de caixa registado.');
  res.redirect('/caixa');
}

async function fechar(req, res) {
  const resultado = await caixaService.fechar({ totalContado: req.body.total_contado });
  const sinal = resultado.diferenca === 0 ? 'sem diferenca' : `diferenca de ${resultado.diferenca.toFixed(2)} €`;
  setFlash(req, resultado.diferenca === 0 ? 'success' : 'warning', `Caixa fechada (${sinal}).`);
  res.redirect('/caixa');
}

async function detalhe(req, res) {
  const dados = await caixaService.detalheSessao(req.params.id);
  if (!dados) return res.status(404).render('errors/404', { titulo: 'Sessao nao encontrada' });
  res.render('caixa/detalhe', { titulo: `Sessao de caixa #${dados.sessao.id}`, ...dados });
}

module.exports = { ecra, abrir, movimento, fechar, detalhe };
