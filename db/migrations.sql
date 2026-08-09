-- ---------------------------------------------------------------------------
-- MIGRACOES para bases de dados JA EXISTENTES.
--
-- O db/schema.sql so faz `CREATE TABLE IF NOT EXISTS`: nao altera tabelas que
-- ja existam. Este ficheiro corre SEMPRE a seguir ao schema (db/apply-schema.js)
-- e tem de ser IDEMPOTENTE — cada instrucao pode correr as vezes que forem.
--
-- Aplicar com:  npm run db:schema
-- ---------------------------------------------------------------------------

-- 2026-08: ecra de venda passou a "Movimentos Internos" (sem dinheiro).
-- Os movimentos internos sao gravados com metodo_pagamento = 'interno',
-- valor_dinheiro = 0, valor_multibanco = 0 e troco = 0, para NAO entrarem no
-- dinheiro esperado no fecho de caixa. Os valores antigos mantem-se no ENUM
-- para preservar o historico de vendas com dinheiro/multibanco/misto.
ALTER TABLE vendas
  MODIFY COLUMN metodo_pagamento
    ENUM('dinheiro','multibanco','misto','interno') NOT NULL DEFAULT 'interno';
