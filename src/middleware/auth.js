'use strict';

function isApiRequest(req) {
  return req.path.startsWith('/api/') || req.xhr || req.get('accept') === 'application/json';
}

function requireAuth(req, res, next) {
  if (req.session && req.session.utilizador) return next();
  if (isApiRequest(req)) {
    return res.status(401).json({ erro: 'Nao autenticado' });
  }
  const destino = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?next=${destino}`);
}

function requireAdmin(req, res, next) {
  const user = req.session && req.session.utilizador;
  if (!user) return requireAuth(req, res, next);
  if (user.role === 'admin') return next();
  if (isApiRequest(req)) {
    return res.status(403).json({ erro: 'Sem permissoes' });
  }
  return res.status(403).render('errors/403', { titulo: 'Sem permissoes' });
}

/**
 * Acesso ao POS: qualquer utilizador autenticado (admin ou funcionario).
 * Mantido separado de requireAuth para permitir evoluir regras do POS
 * sem tocar no resto do backoffice.
 */
function requirePos(req, res, next) {
  const user = req.session && req.session.utilizador;
  if (user && (user.role === 'admin' || user.role === 'funcionario')) return next();
  return requireAuth(req, res, next);
}

/**
 * Area inicial de cada perfil. Fonte unica de verdade para os redirects
 * (login, GET /) e para decidir o que a navegacao mostra.
 *  - admin       -> backoffice (tem acesso a tudo)
 *  - funcionario -> POS (unica area a que tem acesso)
 */
function areaInicial(user) {
  return user && user.role === 'admin' ? '/admin' : '/pos';
}

/** True se o utilizador tem perfil de administrador. */
function isAdmin(user) {
  return Boolean(user && user.role === 'admin');
}

/** Expoe o utilizador e flash messages a todas as views. */
function locals(req, res, next) {
  const user = (req.session && req.session.utilizador) || null;
  res.locals.utilizador = user;
  // Disponivel em todas as views para esconder o que o perfil nao pode abrir.
  // Nota: isto e apenas usabilidade -- a autorizacao real esta nos guards acima.
  res.locals.isAdmin = isAdmin(user);
  res.locals.flash = (req.session && req.session.flash) || null;
  res.locals.currentPath = req.path;
  if (req.session) delete req.session.flash;
  next();
}

function setFlash(req, tipo, mensagem) {
  if (req.session) req.session.flash = { tipo, mensagem };
}

module.exports = { requireAuth, requireAdmin, requirePos, areaInicial, isAdmin, locals, setFlash };
