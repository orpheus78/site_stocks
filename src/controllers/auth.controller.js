'use strict';

const authService = require('../services/auth.service');
const { setFlash, areaInicial } = require('../middleware/auth');

/** So aceita redirects internos (evita open redirect). */
function destinoSeguro(valor, fallback) {
  if (typeof valor === 'string' && valor.startsWith('/') && !valor.startsWith('//')) return valor;
  return fallback;
}

/**
 * Destino apos login, em funcao do perfil.
 *
 * O `next` so e respeitado para admin. Um funcionario que tenha batido em
 * /admin ou /caixa (e sido mandado para o login) seria devolvido a uma area
 * sem permissoes e apanharia um 403 imediatamente a seguir ao login -- por
 * isso vai sempre para o GIM, a unica area a que tem acesso.
 */
function destinoAposLogin(utilizador, next) {
  const inicial = areaInicial(utilizador);
  if (utilizador.role !== 'admin') return inicial;
  return destinoSeguro(next, inicial);
}

function paginaLogin(req, res) {
  if (req.session.utilizador) return res.redirect(destinoAposLogin(req.session.utilizador, req.query.next));
  res.render('auth/login', {
    titulo: 'Entrar',
    layoutSemNav: true,
    // Teclado do PIN: so faz sentido nesta pagina, por isso nao vai no layout.
    scripts: ['/js/pin-teclado.js'],
    next: destinoSeguro(req.query.next, ''),
    erro: null
  });
}

async function login(req, res, next) {
  const { username, password } = req.body;
  const pedido = destinoSeguro(req.body.next, '');
  let utilizador;
  try {
    utilizador = await authService.autenticar(username, password);
  } catch (err) {
    return res.status(401).render('auth/login', {
      titulo: 'Entrar',
      layoutSemNav: true,
      scripts: ['/js/pin-teclado.js'],
      next: pedido,
      erro: 'Utilizador ou password invalidos.'
    });
  }

  const destino = destinoAposLogin(utilizador, pedido);

  // Regenerar o ID de sessao apos autenticacao (defesa contra session fixation).
  // O erro tem de ir para `next`: um `throw` dentro deste callback nao e
  // apanhado pelo Express e derrubaria o processo (uncaughtException).
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.utilizador = utilizador;
    res.redirect(destino);
  });
}

/**
 * Login rapido por PIN no GIM (usado por ecra touch).
 * Vai sempre para /gim, independentemente do perfil: o PIN e por definicao a
 * entrada de balcao. Um admin que queira o backoffice entra por password.
 */
async function loginPorPin(req, res, next) {
  const { pin } = req.body;
  let utilizador;
  try {
    utilizador = await authService.autenticarPorPin(pin);
  } catch (err) {
    // O formulario do PIN e um POST HTML normal (ver views/auth/login.ejs),
    // por isso a resposta e um redirect com flash. Nao se usa `res.status(401)`
    // porque `res.redirect()` sobrepoe sempre o status para 302 -- ficaria
    // codigo morto a dar a impressao de que a API devolve 401.
    setFlash(req, 'danger', 'PIN invalido.');
    return res.redirect('/login');
  }

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.utilizador = utilizador;
    res.redirect('/gim');
  });
}

function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie('bar.sid');
    res.redirect('/login');
  });
}

module.exports = { paginaLogin, login, loginPorPin, logout };
