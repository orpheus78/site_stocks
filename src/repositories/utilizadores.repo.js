'use strict';

const { run } = require('./base');

const CAMPOS = 'id, nome, username, password_hash, pin_hash, role, ativo, criado_em';

// Campos seguros para listagens/formularios: NUNCA incluem password_hash nem
// pin_hash. `tem_pin` diz apenas SE existe PIN, nunca qual e o hash.
const CAMPOS_SEGUROS =
  'id, nome, username, role, ativo, criado_em, (pin_hash IS NOT NULL) AS tem_pin';

async function porUsername(username, conn) {
  const rows = await run(conn).query(
    `SELECT ${CAMPOS} FROM utilizadores WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function porId(id, conn) {
  const rows = await run(conn).query(`SELECT ${CAMPOS} FROM utilizadores WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/** Utilizadores ativos com PIN definido (para login rapido no GIM). */
async function ativosComPin(conn) {
  return run(conn).query(
    `SELECT ${CAMPOS} FROM utilizadores WHERE ativo = 1 AND pin_hash IS NOT NULL ORDER BY nome`
  );
}

/**
 * TODOS os utilizadores com PIN, activos ou nao.
 *
 * Serve a validacao de unicidade do PIN (ver utilizadores.service). Os hashes
 * bcrypt tem salts diferentes, por isso dois PINs iguais dao hashes diferentes
 * e NAO e possivel um indice unico na coluna -- a comparacao tem de ser feita
 * um a um no servico. Inclui os desactivados de proposito: se um utilizador
 * desactivado ficasse com o PIN de outro, bastava reactiva-lo para o login por
 * PIN passar a devolver a pessoa errada.
 */
async function todosComPin(conn) {
  return run(conn).query(
    `SELECT ${CAMPOS} FROM utilizadores WHERE pin_hash IS NOT NULL ORDER BY id`
  );
}

/** Listagem para o backoffice. Sem hashes: nada de credenciais no ecra. */
async function listar(conn) {
  return run(conn).query(`SELECT ${CAMPOS_SEGUROS} FROM utilizadores ORDER BY nome`);
}

/** Um utilizador sem credenciais, para preencher o formulario de edicao. */
async function porIdSemCredenciais(id, conn) {
  const rows = await run(conn).query(
    `SELECT ${CAMPOS_SEGUROS} FROM utilizadores WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/** Quantos administradores activos existem (protecao do ultimo admin). */
async function contarAdminsAtivos(conn) {
  const rows = await run(conn).query(
    "SELECT COUNT(*) AS total FROM utilizadores WHERE role = 'admin' AND ativo = 1"
  );
  return Number(rows[0].total);
}

/** Cria um utilizador. Os hashes ja vem calculados pelo servico (bcrypt). */
async function criar({ nome, username, password_hash, pin_hash, role, ativo }, conn) {
  const res = await run(conn).query(
    `INSERT INTO utilizadores (nome, username, password_hash, pin_hash, role, ativo)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nome, username, password_hash, pin_hash || null, role, ativo ? 1 : 0]
  );
  return res.insertId;
}

/**
 * Actualiza os dados NAO sensiveis. A password e o PIN tem UPDATEs proprios
 * (ver abaixo): so assim "campo em branco = nao alterar" nunca pode apagar,
 * por distraccao, o hash que ja la estava.
 */
async function atualizar(id, { nome, username, role, ativo }, conn) {
  await run(conn).query(
    'UPDATE utilizadores SET nome = ?, username = ?, role = ?, ativo = ? WHERE id = ?',
    [nome, username, role, ativo ? 1 : 0, id]
  );
}

async function atualizarPasswordHash(id, passwordHash, conn) {
  await run(conn).query('UPDATE utilizadores SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

async function atualizarPinHash(id, pinHash, conn) {
  await run(conn).query('UPDATE utilizadores SET pin_hash = ? WHERE id = ?', [pinHash, id]);
}

/**
 * Soft-delete: nunca ha DELETE fisico. A tabela `consumos` referencia
 * `utilizador_id` e apagar destruiria o historico (e violaria a FK).
 * Um utilizador com ativo = 0 nao entra por password (ver auth.service) nem
 * aparece no login por PIN (ver ativosComPin).
 */
async function definirAtivo(id, ativo, conn) {
  await run(conn).query('UPDATE utilizadores SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
}

module.exports = {
  porUsername,
  porId,
  porIdSemCredenciais,
  ativosComPin,
  todosComPin,
  listar,
  contarAdminsAtivos,
  criar,
  atualizar,
  atualizarPasswordHash,
  atualizarPinHash,
  definirAtivo
};
