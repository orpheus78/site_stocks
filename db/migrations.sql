-- ---------------------------------------------------------------------------
-- MIGRACOES para bases de dados JA EXISTENTES.
--
-- O db/schema.sql so faz `CREATE TABLE IF NOT EXISTS`: nao altera tabelas que
-- ja existam. Este ficheiro corre SEMPRE a seguir ao schema (db/apply-schema.js)
-- e tem de ser IDEMPOTENTE — cada instrucao pode correr as vezes que forem.
--
-- Aplicar com:  npm run db:schema
-- ---------------------------------------------------------------------------

-- 2026-08: rename tecnico "venda" -> "consumo".
-- As tabelas `vendas`/`venda_itens` passaram a `consumos`/`consumo_itens` e a
-- coluna `venda_id` passou a `consumo_id`; o tipo de movimento de stock
-- 'venda' passou a 'consumo'. NAO ha migracao de dados: bases anteriores a
-- este rename tem de ser recriadas do zero (`npm run db:reset`), por decisao
-- explicita (o sistema estava em fase de testes). As migracoes historicas
-- deste ficheiro, que ainda referiam `vendas`, foram removidas por deixarem
-- de ser aplicaveis.
--
-- Unica migracao activa: garantir o ENUM de metodo_pagamento em bases criadas
-- por versoes anteriores do schema (valores antigos mantidos para preservar o
-- historico de vendas com dinheiro/multibanco/misto; 'interno' e o valor dos
-- movimentos internos, que nao tem cobranca ao balcao).
ALTER TABLE consumos
  MODIFY COLUMN metodo_pagamento
    ENUM('dinheiro','multibanco','misto','interno') NOT NULL DEFAULT 'interno';

-- 2026-08: preco de custo e margem.
-- `artigos.preco_custo` e o custo de compra POR UNIDADE (sem IVA);
-- `consumo_itens.custo_unit` e o SNAPSHOT desse custo no momento do consumo.
--
-- Porque estao aqui, se a BD vai ser recriada com `npm run db:reset`?
-- Porque o schema so faz CREATE TABLE IF NOT EXISTS: numa base que ja exista
-- (a de desenvolvimento de quem nao correr o reset, ou uma instalacao ja em
-- uso) as colunas novas NUNCA apareceriam e a aplicacao rebentaria com
-- ER_BAD_FIELD_ERROR. O custo de as manter aqui e zero: `ADD COLUMN IF NOT
-- EXISTS` (MariaDB) e idempotente e nao toca em nada quando a coluna ja veio
-- do schema. Os valores por defeito (0.00) sao deliberados: um custo
-- desconhecido vale zero e aparece como margem de 100%, que e visivel no
-- backoffice e convida a preencher — ao contrario de NULL, que obrigaria
-- todos os SUM() de margem a tratamento especial.
ALTER TABLE artigos
  ADD COLUMN IF NOT EXISTS preco_custo DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER preco;

ALTER TABLE consumo_itens
  ADD COLUMN IF NOT EXISTS custo_unit DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER preco_unit;
