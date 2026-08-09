-- Schema da aplicacao de gestao do bar do campo de futebol.
-- MariaDB 11 / InnoDB / utf8mb4.
-- NOTA: nao existe IVA em lado nenhum. O preco do artigo e o valor final.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS utilizadores (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome          VARCHAR(120) NOT NULL,
  username      VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  pin_hash      VARCHAR(255) NULL,
  role          ENUM('admin','funcionario') NOT NULL DEFAULT 'funcionario',
  ativo         TINYINT(1) NOT NULL DEFAULT 1,
  criado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_utilizadores_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categorias (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome   VARCHAR(80) NOT NULL,
  cor    VARCHAR(7) NOT NULL DEFAULT '#0d6efd',
  ordem  INT NOT NULL DEFAULT 0,
  ativo  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categorias_nome (nome),
  KEY ix_categorias_ordem (ordem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artigos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  categoria_id INT UNSIGNED NULL,
  nome         VARCHAR(120) NOT NULL,
  preco        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  imagem       VARCHAR(255) NULL,
  ativo        TINYINT(1) NOT NULL DEFAULT 1,
  ordem        INT NOT NULL DEFAULT 0,
  criado_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_artigos_categoria (categoria_id),
  KEY ix_artigos_ativo_ordem (ativo, ordem),
  CONSTRAINT fk_artigos_categoria FOREIGN KEY (categoria_id)
    REFERENCES categorias (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stocks (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  artigo_id     INT UNSIGNED NOT NULL,
  quantidade    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  stock_minimo  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  unidade       VARCHAR(10) NOT NULL DEFAULT 'un',
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stocks_artigo (artigo_id),
  CONSTRAINT fk_stocks_artigo FOREIGN KEY (artigo_id)
    REFERENCES artigos (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movimentos_stock (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  artigo_id       INT UNSIGNED NOT NULL,
  tipo            ENUM('entrada','saida','ajuste','venda') NOT NULL,
  quantidade      DECIMAL(10,2) NOT NULL,
  quantidade_apos DECIMAL(10,2) NOT NULL,
  motivo          VARCHAR(255) NULL,
  utilizador_id   INT UNSIGNED NULL,
  criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mov_stock_criado_em (criado_em),
  KEY ix_mov_stock_artigo (artigo_id),
  KEY ix_mov_stock_tipo (tipo),
  CONSTRAINT fk_mov_stock_artigo FOREIGN KEY (artigo_id)
    REFERENCES artigos (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mov_stock_utilizador FOREIGN KEY (utilizador_id)
    REFERENCES utilizadores (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes_caixa (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  utilizador_id INT UNSIGNED NOT NULL,
  fundo_inicial DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  aberta_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fechada_em    DATETIME NULL,
  total_contado DECIMAL(10,2) NULL,
  diferenca     DECIMAL(10,2) NULL,
  estado        ENUM('aberta','fechada') NOT NULL DEFAULT 'aberta',
  PRIMARY KEY (id),
  KEY ix_sessoes_caixa_estado (estado),
  KEY ix_sessoes_caixa_aberta_em (aberta_em),
  CONSTRAINT fk_sessoes_caixa_utilizador FOREIGN KEY (utilizador_id)
    REFERENCES utilizadores (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movimentos_caixa (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sessao_caixa_id INT UNSIGNED NOT NULL,
  tipo            ENUM('entrada','saida','sangria') NOT NULL,
  valor           DECIMAL(10,2) NOT NULL,
  descricao       VARCHAR(255) NOT NULL DEFAULT '',
  criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mov_caixa_sessao (sessao_caixa_id),
  KEY ix_mov_caixa_criado_em (criado_em),
  CONSTRAINT fk_mov_caixa_sessao FOREIGN KEY (sessao_caixa_id)
    REFERENCES sessoes_caixa (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendas (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero            INT UNSIGNED NOT NULL,
  total             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  metodo_pagamento  ENUM('dinheiro','multibanco','misto','interno') NOT NULL DEFAULT 'interno',
  valor_dinheiro    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  valor_multibanco  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  troco             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estado            ENUM('concluida','anulada') NOT NULL DEFAULT 'concluida',
  utilizador_id     INT UNSIGNED NULL,
  sessao_caixa_id   INT UNSIGNED NULL,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vendas_numero (numero),
  KEY ix_vendas_criado_em (criado_em),
  KEY ix_vendas_estado (estado),
  KEY ix_vendas_sessao (sessao_caixa_id),
  CONSTRAINT fk_vendas_utilizador FOREIGN KEY (utilizador_id)
    REFERENCES utilizadores (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_vendas_sessao FOREIGN KEY (sessao_caixa_id)
    REFERENCES sessoes_caixa (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS venda_itens (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  venda_id      INT UNSIGNED NOT NULL,
  artigo_id     INT UNSIGNED NULL,
  nome_snapshot VARCHAR(120) NOT NULL,
  preco_unit    DECIMAL(10,2) NOT NULL,
  quantidade    DECIMAL(10,2) NOT NULL,
  subtotal      DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_venda_itens_venda (venda_id),
  KEY ix_venda_itens_artigo (artigo_id),
  CONSTRAINT fk_venda_itens_venda FOREIGN KEY (venda_id)
    REFERENCES vendas (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_venda_itens_artigo FOREIGN KEY (artigo_id)
    REFERENCES artigos (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
