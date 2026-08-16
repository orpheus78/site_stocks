# Testes end-to-end (E2E) com MariaDB real

**Estado: NÃO EXECUTADOS.**

Antes de implementar este conjunto de testes verificou-se a disponibilidade de
MariaDB e Docker no ambiente de desenvolvimento:

```
which mariadb mysql mariadbd mysqld docker   -> nada encontrado
docker ps                                     -> comando 'docker' nao existe
docker --version                              -> comando 'docker' nao existe
```

Não existe nenhuma instância de MariaDB local nem Docker disponível nesta
máquina, pelo que — seguindo a instrução de **não instalar nada** — os testes
E2E ficaram por implementar/correr.

## O que devia ser coberto (para implementação futura)

Quando houver MariaDB ou Docker disponível, criar `tests/e2e/consumos.e2e.test.js`
(ou equivalente) cobrindo o fluxo real completo:

1. Criar uma base de dados de teste dedicada (ex.: `bar_test`), nunca reutilizar
   a base de dados de desenvolvimento/produção.
2. Aplicar `db/schema.sql` e um seed mínimo de teste (utilizador, categoria,
   artigo com preço e stock conhecidos).
3. Ler credenciais **exclusivamente de variáveis de ambiente** (ex.:
   `TEST_DB_HOST`, `TEST_DB_USER`, `TEST_DB_PASSWORD`, `TEST_DB_NAME`) —
   nunca hardcoded no código de teste.
4. Fluxo a validar:
   - Login com utilizador de teste.
   - Abrir caixa com fundo inicial conhecido.
   - `POST /api/consumos` com um artigo e quantidade conhecidos.
   - Confirmar que o `stock.quantidade` foi decrementado corretamente na BD.
   - Confirmar que foi criado um registo em `movimentos_stock` do tipo
     `consumo` com `quantidade_apos` correto.
   - Confirmar que `GET /gim/consumo/:id/talao` responde **404**: a aplicação é
     de controlo interno e não emite talão/comprovativo.
   - Anular o consumo (`POST /admin/consumos/:id/anular`) e confirmar que o stock
     é reposto (movimento `entrada` criado, quantidade de volta ao valor
     original).
   - Fechar a caixa e confirmar que `esperado`/`diferenca` batem certo:
     `fundo + movimentos internos + dinheiro de vendas antigas + entradas
     − saídas − sangrias` (o multibanco fica de fora).
5. **Limpar a base de dados de teste no fim** (idealmente `DROP DATABASE` ou
   truncar todas as tabelas usadas), mesmo que o teste falhe (usar
   `after`/`finally`).
6. Nunca correr contra a base de dados de produção nem usar dados reais de
   clientes/consumos.

Sugestão de guarda no próprio ficheiro de teste, para que a suite principal
(`npm test`) não falhe quando o E2E não pode correr:

```js
const semBD = !process.env.TEST_DB_HOST;
describe('E2E consumos (BD real)', { skip: semBD && 'MariaDB de teste nao configurada (TEST_DB_HOST em falta)' }, () => {
  // ...
});
```
