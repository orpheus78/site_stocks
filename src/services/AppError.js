'use strict';

/** Erro de negocio: mapeado para 4xx pelo error handler central. */
class AppError extends Error {
  constructor(mensagem, status = 400, detalhes = null) {
    super(mensagem);
    this.name = 'AppError';
    this.status = status;
    this.detalhes = detalhes;
  }
}

module.exports = { AppError };
