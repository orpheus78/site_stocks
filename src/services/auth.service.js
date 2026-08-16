'use strict';

const bcrypt = require('bcryptjs');
const utilizadoresRepo = require('../repositories/utilizadores.repo');
const { AppError } = require('./AppError');

const SALT_ROUNDS = 12;

function sessaoDoUtilizador(u) {
  return { id: u.id, nome: u.nome, username: u.username, role: u.role };
}

async function autenticar(username, password) {
  const utilizador = await utilizadoresRepo.porUsername(username);
  // Comparacao sempre executada para nao revelar existencia do username pelo tempo de resposta.
  const hash = utilizador ? utilizador.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(password, hash);
  if (!utilizador || !ok || !utilizador.ativo) {
    throw new AppError('Credenciais invalidas.', 401);
  }
  return sessaoDoUtilizador(utilizador);
}

/** Login rapido no GIM: procura o utilizador ativo cujo PIN corresponde. */
async function autenticarPorPin(pin) {
  const candidatos = await utilizadoresRepo.ativosComPin();
  for (const u of candidatos) {
    if (await bcrypt.compare(pin, u.pin_hash)) return sessaoDoUtilizador(u);
  }
  throw new AppError('PIN invalido.', 401);
}

const hashPassword = (valor) => bcrypt.hash(valor, SALT_ROUNDS);

module.exports = { autenticar, autenticarPorPin, hashPassword, SALT_ROUNDS };
