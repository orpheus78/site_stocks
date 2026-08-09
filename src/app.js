'use strict';

const express = require('express');
const session = require('express-session');
const multer = require('multer');

const env = require('./config/env');
const rotas = require('./routes');
const { locals } = require('./middleware/auth');
const { layout } = require('./middleware/layout');
const { AppError } = require('./services/AppError');
const { eur, round2, dataHoraPT, hojeISO } = require('./utils');

const app = express();

app.set('view engine', 'ejs');
app.set('views', env.paths.views);
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.static(env.paths.public, { maxAge: env.isProduction ? '7d' : 0 }));

app.use(
  session({
    name: 'bar.sid',
    secret: env.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.session.cookieSecure,
      maxAge: 12 * 60 * 60 * 1000 // turno de bar: 12h
    }
  })
);

app.use(layout);
app.use(locals);

// Helpers disponiveis em todas as views.
app.locals.eur = eur;
app.locals.round2 = round2;
app.locals.dataHoraPT = dataHoraPT;
app.locals.hojeISO = hojeISO;
app.locals.appNome = 'Bar do Campo';

app.use(rotas);

// 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota nao encontrada' });
  res.status(404).render('errors/404', { titulo: 'Pagina nao encontrada' });
});

// Error handler central
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let mensagem = 'Ocorreu um erro inesperado.';

  if (err instanceof AppError) {
    mensagem = err.message;
  } else if (err instanceof multer.MulterError) {
    status = 400;
    mensagem = 'Erro no upload do ficheiro.';
  } else if (err && err.code && String(err.code).startsWith('ER_')) {
    status = 500;
    mensagem = 'Erro na base de dados.';
    console.error('[bd]', err.code, err.sqlMessage || err.message);
  }

  if (status >= 500) console.error('[erro]', err);

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ erro: mensagem });
  }

  res.status(status).render('errors/500', {
    titulo: status >= 500 ? 'Erro do servidor' : 'Pedido invalido',
    status,
    mensagem,
    detalhe: env.isProduction ? null : err.stack
  });
});

module.exports = app;
