'use strict';

/**
 * Dados iniciais (idempotente): utilizadores, categorias e artigos de exemplo.
 * Uso: npm run db:seed
 *
 * As credenciais por defeito destinam-se apenas ao primeiro arranque
 * e DEVEM ser alteradas (ver README). Podem ser sobrepostas por ambiente:
 *   SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD / SEED_ADMIN_PIN
 *   SEED_BAR_USERNAME   / SEED_BAR_PASSWORD   / SEED_BAR_PIN
 */

const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

const SALT_ROUNDS = 12;

const ADMIN = {
  nome: 'Administrador',
  username: process.env.SEED_ADMIN_USERNAME || 'admin',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  pin: process.env.SEED_ADMIN_PIN || '1234',
  role: 'admin'
};

// Perfil de venda: so tem acesso ao POS (ver src/middleware/auth.js).
const FUNCIONARIO = {
  nome: 'Funcionario Bar',
  username: process.env.SEED_BAR_USERNAME || 'bar',
  password: process.env.SEED_BAR_PASSWORD || 'bar123',
  pin: process.env.SEED_BAR_PIN || '4321',
  role: 'funcionario'
};

const CATEGORIAS = [
  { nome: 'Bebidas', cor: '#0d6efd', ordem: 1 },
  { nome: 'Cervejas', cor: '#fd7e14', ordem: 2 },
  { nome: 'Cafes', cor: '#6f4e37', ordem: 3 },
  { nome: 'Snacks', cor: '#ffc107', ordem: 4 },
  { nome: 'Sandes', cor: '#198754', ordem: 5 },
  { nome: 'Gelados', cor: '#0dcaf0', ordem: 6 }
];

// preco = valor final ao cliente (sem IVA em lado nenhum)
const ARTIGOS = [
  { categoria: 'Cafes', nome: 'Cafe', preco: 0.70, stock: 200, minimo: 40 },
  { categoria: 'Cafes', nome: 'Cafe duplo', preco: 1.20, stock: 100, minimo: 20 },
  { categoria: 'Cafes', nome: 'Galao', preco: 1.10, stock: 80, minimo: 15 },
  { categoria: 'Cafes', nome: 'Cha', preco: 0.90, stock: 60, minimo: 10 },

  { categoria: 'Bebidas', nome: 'Agua 0.5L', preco: 0.80, stock: 120, minimo: 24 },
  { categoria: 'Bebidas', nome: 'Coca-Cola', preco: 1.50, stock: 96, minimo: 24 },
  { categoria: 'Bebidas', nome: 'Ice Tea', preco: 1.40, stock: 72, minimo: 12 },
  { categoria: 'Bebidas', nome: 'Sumo laranja', preco: 1.60, stock: 48, minimo: 12 },
  { categoria: 'Bebidas', nome: 'Bebida energetica', preco: 2.00, stock: 36, minimo: 12 },

  { categoria: 'Cervejas', nome: 'Imperial', preco: 1.20, stock: 150, minimo: 30 },
  { categoria: 'Cervejas', nome: 'Caneca', preco: 2.00, stock: 80, minimo: 20 },
  { categoria: 'Cervejas', nome: 'Cerveja garrafa 33cl', preco: 1.50, stock: 96, minimo: 24 },
  { categoria: 'Cervejas', nome: 'Cerveja sem alcool', preco: 1.50, stock: 24, minimo: 6 },

  { categoria: 'Snacks', nome: 'Batatas fritas pacote', preco: 1.20, stock: 60, minimo: 12 },
  { categoria: 'Snacks', nome: 'Amendoins', preco: 1.00, stock: 40, minimo: 10 },
  { categoria: 'Snacks', nome: 'Tremocos', preco: 1.50, stock: 30, minimo: 8 },
  { categoria: 'Snacks', nome: 'Chocolate', preco: 1.00, stock: 50, minimo: 10 },

  { categoria: 'Sandes', nome: 'Sandes de fiambre', preco: 2.50, stock: 25, minimo: 5 },
  { categoria: 'Sandes', nome: 'Sandes mista', preco: 2.80, stock: 20, minimo: 5 },
  { categoria: 'Sandes', nome: 'Bifana', preco: 3.00, stock: 30, minimo: 8 },
  { categoria: 'Sandes', nome: 'Cachorro', preco: 2.50, stock: 25, minimo: 6 },
  { categoria: 'Sandes', nome: 'Tosta mista', preco: 3.00, stock: 20, minimo: 5 },

  { categoria: 'Gelados', nome: 'Gelado', preco: 1.50, stock: 40, minimo: 10 },
  { categoria: 'Gelados', nome: 'Gelado premium', preco: 2.50, stock: 20, minimo: 5 }
];

/** Cria o utilizador se ainda nao existir. Idempotente pelo `username` (unico). */
async function seedUtilizador(perfil) {
  const existente = await db.queryOne('SELECT id FROM utilizadores WHERE username = ?', [perfil.username]);
  if (existente) {
    console.log(`[seed] utilizador '${perfil.username}' ja existe.`);
    return existente.id;
  }

  const [passwordHash, pinHash] = await Promise.all([
    bcrypt.hash(perfil.password, SALT_ROUNDS),
    bcrypt.hash(perfil.pin, SALT_ROUNDS)
  ]);

  const res = await db.query(
    'INSERT INTO utilizadores (nome, username, password_hash, pin_hash, role, ativo) VALUES (?, ?, ?, ?, ?, 1)',
    [perfil.nome, perfil.username, passwordHash, pinHash, perfil.role]
  );
  console.log(`[seed] utilizador ${perfil.role} criado ('${perfil.username}'). ALTERAR A PASSWORD!`);
  return res.insertId;
}

async function seedCategorias() {
  const mapa = new Map();
  for (const cat of CATEGORIAS) {
    const existente = await db.queryOne('SELECT id FROM categorias WHERE nome = ?', [cat.nome]);
    if (existente) {
      mapa.set(cat.nome, existente.id);
      continue;
    }
    const res = await db.query('INSERT INTO categorias (nome, cor, ordem, ativo) VALUES (?, ?, ?, 1)', [
      cat.nome,
      cat.cor,
      cat.ordem
    ]);
    mapa.set(cat.nome, res.insertId);
  }
  console.log(`[seed] ${mapa.size} categorias garantidas.`);
  return mapa;
}

async function seedArtigos(categorias, utilizadorId) {
  let criados = 0;
  let ordem = 0;

  for (const art of ARTIGOS) {
    ordem += 1;
    const existente = await db.queryOne('SELECT id FROM artigos WHERE nome = ?', [art.nome]);
    if (existente) continue;

    const res = await db.query(
      'INSERT INTO artigos (categoria_id, nome, preco, ativo, ordem) VALUES (?, ?, ?, 1, ?)',
      [categorias.get(art.categoria) || null, art.nome, art.preco, ordem]
    );
    const artigoId = res.insertId;

    await db.query(
      'INSERT INTO stocks (artigo_id, quantidade, stock_minimo, unidade) VALUES (?, ?, ?, ?)',
      [artigoId, art.stock, art.minimo, 'un']
    );
    await db.query(
      `INSERT INTO movimentos_stock (artigo_id, tipo, quantidade, quantidade_apos, motivo, utilizador_id)
       VALUES (?, 'entrada', ?, ?, 'Stock inicial (seed)', ?)`,
      [artigoId, art.stock, art.stock, utilizadorId]
    );
    criados += 1;
  }

  console.log(`[seed] ${criados} artigos criados (${ARTIGOS.length} definidos).`);
}

async function main() {
  const utilizadorId = await seedUtilizador(ADMIN);
  await seedUtilizador(FUNCIONARIO);
  const categorias = await seedCategorias();
  await seedArtigos(categorias, utilizadorId);
  await db.close();
  console.log('[seed] concluido.');
}

main().catch(async (err) => {
  console.error('[seed] erro:', err.message);
  await db.close();
  process.exit(1);
});
