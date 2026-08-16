'use strict';

/**
 * Gestao de utilizadores (backoffice, exclusiva do admin).
 *
 * Duas regras aqui sao criticas e nao podem viver na base de dados:
 *
 * 1. UNICIDADE DO PIN. O login por PIN (auth.service.autenticarPorPin) nao
 *    pede username: o PIN identifica a pessoa sozinho. Se dois utilizadores
 *    tiverem o mesmo PIN, o login devolve o primeiro da lista e os movimentos
 *    ficam atribuidos a pessoa errada -- destruindo exactamente o controlo que
 *    esta aplicacao existe para dar. Como os hashes bcrypt tem salts
 *    diferentes, dois PINs iguais dao hashes diferentes e um indice unico na
 *    coluna NAO resolve nada: a verificacao tem de ser feita aqui, comparando
 *    com bcrypt.compare um a um.
 *
 * 2. NAO DEIXAR O SISTEMA SEM ADMIN. Um admin nao se pode desactivar nem
 *    despromover a si proprio, e o ultimo admin activo nao pode ser desactivado
 *    nem despromovido por ninguem. Sem isto ninguem consegue voltar a entrar no
 *    backoffice e so se recupera mexendo na base de dados a mao.
 *
 * Password e PIN sao SEMPRE guardados como hash bcrypt (SALT_ROUNDS = 12,
 * reutilizando hashPassword() de auth.service). Nunca em claro, nunca
 * devolvidos ao ecra, nunca escritos em logs ou mensagens de erro.
 */

const bcrypt = require('bcryptjs');
const utilizadoresRepo = require('../repositories/utilizadores.repo');
const { hashPassword } = require('./auth.service');
const { AppError } = require('./AppError');

const ROLES = ['admin', 'funcionario'];

// Mensagem pedida pelo cliente para o caso normal (colisao com alguem activo).
const MSG_PIN_ATIVO = 'Ja existe um utilizador activo com esse PIN.';
// Colisao com um utilizador DESACTIVADO: tambem tem de ser recusada, senao
// bastava reactiva-lo mais tarde para passarem a existir dois PINs iguais.
const MSG_PIN_INATIVO = 'Ja existe um utilizador desactivado com esse PIN. Escolha outro PIN.';

function normalizarRole(role) {
  if (!ROLES.includes(role)) throw new AppError('Perfil invalido.', 400);
  return role;
}

function normalizarTexto(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim();
}

/**
 * Procura o dono de um PIN entre TODOS os utilizadores que tem PIN.
 * Devolve o utilizador encontrado (ou null). `excluirId` salta o proprio
 * utilizador, para que editar alguem sem lhe mudar o PIN nao choque consigo.
 */
async function donoDoPin(pin, excluirId) {
  const candidatos = await utilizadoresRepo.todosComPin();
  for (const u of candidatos) {
    if (excluirId !== null && excluirId !== undefined && Number(u.id) === Number(excluirId)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(pin, u.pin_hash)) return u;
  }
  return null;
}

async function garantirPinUnico(pin, excluirId) {
  const dono = await donoDoPin(pin, excluirId);
  if (!dono) return;
  // A mensagem NAO revela de quem e o PIN nem qualquer credencial.
  throw new AppError(Number(dono.ativo) === 1 ? MSG_PIN_ATIVO : MSG_PIN_INATIVO, 409);
}

async function garantirUsernameLivre(username, excluirId) {
  const existente = await utilizadoresRepo.porUsername(username);
  if (!existente) return;
  if (excluirId !== null && excluirId !== undefined && Number(existente.id) === Number(excluirId)) return;
  throw new AppError('Ja existe um utilizador com esse nome de utilizador.', 409);
}

/**
 * Protecoes contra auto-bloqueio do backoffice.
 *
 * @param {object} alvo      utilizador tal como esta na BD
 * @param {{role: string, ativo: boolean}} novo estado pretendido
 * @param {number} autorId   quem esta a fazer a alteracao (sessao)
 */
async function garantirNaoSeAutoBloqueia(alvo, novo, autorId) {
  const eraAdmin = alvo.role === 'admin';
  const eraAtivo = Number(alvo.ativo) === 1;
  const perdeAdmin = eraAdmin && novo.role !== 'admin';
  const ficaInativo = !novo.ativo;

  if (Number(alvo.id) === Number(autorId)) {
    if (ficaInativo) {
      throw new AppError('Nao pode desactivar a sua propria conta.', 409);
    }
    if (perdeAdmin) {
      throw new AppError('Nao pode retirar a si proprio o perfil de administrador.', 409);
    }
  }

  // Ultimo admin activo do sistema: desactiva-lo ou despromove-lo deixaria a
  // aplicacao sem ninguem capaz de entrar no backoffice, sem recuperacao
  // possivel pela propria aplicacao.
  if (eraAdmin && eraAtivo && (perdeAdmin || ficaInativo)) {
    const admins = await utilizadoresRepo.contarAdminsAtivos();
    if (admins <= 1) {
      throw new AppError(
        'E o ultimo administrador activo: crie outro administrador antes de o desactivar ou despromover.',
        409
      );
    }
  }
}

// ---------------------------------------------------------------- leitura

/** Listagem para o backoffice. Sem hashes (ver utilizadores.repo). */
async function listar() {
  return utilizadoresRepo.listar();
}

/** Um utilizador para o formulario de edicao. NUNCA traz password nem PIN. */
async function porId(id) {
  return utilizadoresRepo.porIdSemCredenciais(id);
}

// ------------------------------------------------------------------ escrita

async function criar({ nome, username, password, pin, role, ativo }) {
  const perfil = normalizarRole(role);
  const nomeUtilizador = normalizarTexto(username);

  await garantirUsernameLivre(nomeUtilizador, null);
  await garantirPinUnico(pin, null);

  const [passwordHash, pinHash] = await Promise.all([hashPassword(password), hashPassword(pin)]);

  const id = await utilizadoresRepo.criar({
    nome: normalizarTexto(nome),
    username: nomeUtilizador,
    password_hash: passwordHash,
    pin_hash: pinHash,
    role: perfil,
    ativo: ativo ? 1 : 0
  });

  return { id, nome: normalizarTexto(nome), username: nomeUtilizador };
}

/**
 * Actualiza um utilizador.
 *
 * Password e PIN em BRANCO significam "nao alterar": nesse caso nao se toca no
 * hash existente (os UPDATEs de credenciais sao instrucoes separadas no
 * repositorio, por isso nao ha maneira de os apagar sem querer).
 */
async function atualizar(id, { nome, username, password, pin, role, ativo }, autorId) {
  const alvo = await utilizadoresRepo.porId(id);
  if (!alvo) throw new AppError('Utilizador nao encontrado.', 404);

  const perfil = normalizarRole(role);
  const nomeUtilizador = normalizarTexto(username);
  const ficaAtivo = Boolean(ativo);

  await garantirNaoSeAutoBloqueia(alvo, { role: perfil, ativo: ficaAtivo }, autorId);
  await garantirUsernameLivre(nomeUtilizador, alvo.id);

  const novaPassword = typeof password === 'string' && password.length > 0 ? password : null;
  const novoPin = typeof pin === 'string' && pin.length > 0 ? pin : null;

  // Validar o PIN ANTES de escrever seja o que for: se o PIN esta repetido,
  // a edicao inteira e recusada e nada e alterado.
  if (novoPin) await garantirPinUnico(novoPin, alvo.id);

  await utilizadoresRepo.atualizar(alvo.id, {
    nome: normalizarTexto(nome),
    username: nomeUtilizador,
    role: perfil,
    ativo: ficaAtivo
  });

  if (novaPassword) {
    await utilizadoresRepo.atualizarPasswordHash(alvo.id, await hashPassword(novaPassword));
  }
  if (novoPin) {
    await utilizadoresRepo.atualizarPinHash(alvo.id, await hashPassword(novoPin));
  }

  return { id: alvo.id, nome: normalizarTexto(nome) };
}

/**
 * Soft-delete. Nao existe DELETE fisico: a tabela `consumos` referencia
 * `utilizador_id` e apagar destruiria o historico de quem registou o que.
 */
async function desactivar(id, autorId) {
  const alvo = await utilizadoresRepo.porId(id);
  if (!alvo) throw new AppError('Utilizador nao encontrado.', 404);

  if (Number(alvo.ativo) !== 1) {
    return { id: alvo.id, nome: alvo.nome, jaEstava: true };
  }

  await garantirNaoSeAutoBloqueia(alvo, { role: alvo.role, ativo: false }, autorId);
  await utilizadoresRepo.definirAtivo(alvo.id, 0);
  return { id: alvo.id, nome: alvo.nome, jaEstava: false };
}

/**
 * Reactivar. E seguro do ponto de vista do PIN porque a unicidade e verificada
 * contra TODOS os utilizadores com PIN (activos e desactivados), logo um
 * utilizador desactivado nunca chega a ficar com o PIN de outra pessoa.
 */
async function activar(id) {
  const alvo = await utilizadoresRepo.porId(id);
  if (!alvo) throw new AppError('Utilizador nao encontrado.', 404);
  await utilizadoresRepo.definirAtivo(alvo.id, 1);
  return { id: alvo.id, nome: alvo.nome };
}

module.exports = {
  listar,
  porId,
  criar,
  atualizar,
  desactivar,
  activar,
  donoDoPin,
  ROLES,
  MSG_PIN_ATIVO,
  MSG_PIN_INATIVO
};
