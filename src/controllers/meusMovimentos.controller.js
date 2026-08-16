'use strict';

const consumosService = require('../services/consumos.service');
const { setFlash } = require('../middleware/auth');
const { AppError } = require('../services/AppError');
const { hojeISO } = require('../utils');

// Tecto de linhas mostradas. Um turno de bar nunca chega perto disto; existe
// para nao trazer meio historico se alguem alargar o periodo a mao no URL.
const LIMITE = 200;

/**
 * Aceita apenas datas no formato YYYY-MM-DD; qualquer outra coisa cai no
 * `fallback`. Evita mandar lixo para o SQL (que ja vai parametrizado) e evita
 * o redirect-para-o-referer do middleware de validacao, que num ecra touch
 * daria um ciclo de navegacao dificil de perceber ao balcao.
 */
function dataOuHoje(valor, fallback) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : fallback;
}

/**
 * Ecra "os meus movimentos": so os registos criados pelo proprio utilizador.
 *
 * O DONO dos movimentos vem SEMPRE de `req.session.utilizador.id`. Nunca de
 * req.query nem de req.body -- se viesse do pedido, bastava um funcionario
 * escrever ?utilizador_id=1 no tablet para ver o turno de outra pessoa.
 *
 * A unica accao possivel daqui e anular um movimento PROPRIO, e so enquanto a
 * caixa em que foi registado continuar aberta (ver `anular` mais abaixo). O
 * botao so aparece quando a accao e mesmo possivel, mas quem decide e o
 * servidor.
 */
async function listar(req, res) {
  const hoje = hojeISO();
  const filtros = {
    de: dataOuHoje(req.query.de, hoje),
    ate: dataOuHoje(req.query.ate, hoje),
    limite: LIMITE
  };

  const utilizador = req.session.utilizador;
  const consumos = await consumosService.listarDoUtilizador(utilizador.id, filtros);

  // O admin nao tem as restricoes do operador: pode anular sempre (desde que
  // ainda esteja concluida). Ver consumos.service.anularConsumo.
  const eAdmin = utilizador.role === 'admin';
  const linhas = consumos.map((c) => ({
    ...c,
    pode_anular: eAdmin ? c.estado === 'concluida' : consumosService.podeOperadorAnular(c, utilizador.id)
  }));

  const concluidos = linhas.filter((c) => c.estado === 'concluida');
  const totalPeriodo = concluidos.reduce((acc, c) => acc + Number(c.total), 0);

  res.render('gim/meus-movimentos', {
    titulo: 'Os meus movimentos',
    // Mesmo enquadramento do GIM: ecra cheio, sem navbar de backoffice
    // (o funcionario nao tem backoffice) e com os estilos touch do GIM.
    layoutSemNav: true,
    bodyClass: 'gim-body',
    estilos: ['/css/gim.css'],
    consumos: linhas,
    filtros,
    totalPeriodo,
    nConcluidos: concluidos.length,
    hoje
  });
}

/**
 * Anulacao feita pelo PROPRIO operador, a partir do ecra dos seus movimentos.
 *
 * O id do consumo vem do URL, mas isso nao chega para nada: a decisao de
 * autorizacao e tomada no servico, contra o que esta na BASE DE DADOS
 * (dono real do consumo, estado real, estado real da sessao de caixa) e
 * dentro da mesma transacao que faz a escrita. Nada do que venha do cliente
 * -- corpo, query string ou sessao HTTP -- influencia essas verificacoes.
 *
 * `exigirDonoId` so e passado quando NAO e admin: o admin mantem o
 * comportamento de sempre (anula qualquer movimento).
 */
async function anular(req, res) {
  const utilizador = req.session.utilizador;
  const opcoes = utilizador.role === 'admin' ? {} : { exigirDonoId: utilizador.id };

  // `req.body` pode ser undefined: em Express 5 o parser de formularios so o
  // preenche quando o pedido traz mesmo um corpo com Content-Type. Um POST
  // sem corpo (curl sem -d, ou um cliente antigo) chegaria aqui a rebentar.
  // Os campos de periodo sao so para devolver o utilizador ao mesmo filtro;
  // nao influenciam a autorizacao, que e decidida no servico contra a BD.
  const corpo = req.body || {};
  const voltar = `/gim/meus-movimentos?de=${encodeURIComponent(dataOuHoje(corpo.de, hojeISO()))}` +
    `&ate=${encodeURIComponent(dataOuHoje(corpo.ate, hojeISO()))}`;

  try {
    const resultado = await consumosService.anularConsumo(
      Number(req.params.id),
      utilizador.id,
      opcoes
    );
    setFlash(req, 'success', `Movimento #${resultado.numero} anulado. O stock foi reposto.`);
  } catch (err) {
    // 403: pagina propria do GIM, com a mensagem do servico e caminho de volta.
    // Nao usa o handler central (errors/500) porque este ecra e de tablet.
    if (err instanceof AppError && err.status === 403) {
      return res.status(403).render('errors/403', {
        titulo: 'Nao e possivel anular',
        mensagem: err.message,
        voltarUrl: '/gim/meus-movimentos',
        voltarTexto: 'Voltar aos meus movimentos'
      });
    }
    throw err;
  }

  return res.redirect(voltar);
}

module.exports = { listar, anular };
