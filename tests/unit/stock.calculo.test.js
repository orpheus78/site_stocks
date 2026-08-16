'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularNovaQuantidade,
  isStockNegativo,
  isStockBaixo,
  estadoStockArtigo
} = require('../../src/services/stock.service');

describe('stock.service.calcularNovaQuantidade — entrada', () => {
  test('Dado um movimento de entrada, soma a quantidade ao stock atual', () => {
    // Given: stock atual de 10, entrada de 5
    // When
    const nova = calcularNovaQuantidade('entrada', 10, 5);
    // Then
    assert.equal(nova, 15);
  });

  test('Dada uma entrada com centimos que geram erro de virgula flutuante, arredonda a 2 casas', () => {
    const nova = calcularNovaQuantidade('entrada', 0.1, 0.2);
    assert.equal(nova, 0.3);
  });
});

describe('stock.service.calcularNovaQuantidade — saida', () => {
  test('Dado um movimento de saida, subtrai a quantidade ao stock atual', () => {
    const nova = calcularNovaQuantidade('saida', 10, 4);
    assert.equal(nova, 6);
  });

  test('Dada uma saida maior que o stock disponivel, o resultado fica negativo (nao e bloqueado)', () => {
    // Given: regra de negocio - o stock pode ficar negativo, o consumo/saida nunca e bloqueado
    const nova = calcularNovaQuantidade('saida', 3, 10);
    assert.equal(nova, -7);
  });
});

describe('stock.service.calcularNovaQuantidade — consumo', () => {
  test('Dado um movimento de consumo, subtrai a quantidade vendida ao stock atual', () => {
    const nova = calcularNovaQuantidade('consumo', 20, 2);
    assert.equal(nova, 18);
  });

  test('Dado um consumo que excede o stock disponivel, o stock fica negativo e o consumo nao e bloqueado', () => {
    const nova = calcularNovaQuantidade('consumo', 1, 5);
    assert.equal(nova, -4);
  });
});

describe('stock.service.calcularNovaQuantidade — ajuste', () => {
  test('Dado um movimento de ajuste, define o valor absoluto de inventario (ignora o stock atual)', () => {
    const nova = calcularNovaQuantidade('ajuste', 999, 42);
    assert.equal(nova, 42);
  });

  test('Dado um ajuste para zero, define o stock como zero', () => {
    const nova = calcularNovaQuantidade('ajuste', 15, 0);
    assert.equal(nova, 0);
  });
});

describe('stock.service.isStockNegativo', () => {
  test('Dada uma quantidade negativa, deteta e gera aviso', () => {
    assert.equal(isStockNegativo(-0.01), true);
  });

  test('Dada uma quantidade zero ou positiva, nao gera aviso de stock negativo', () => {
    assert.equal(isStockNegativo(0), false);
    assert.equal(isStockNegativo(5), false);
  });
});

describe('stock.service.isStockBaixo', () => {
  test('Dada uma quantidade igual ao stock minimo, considera-se stock baixo (limite inclusivo)', () => {
    assert.equal(isStockBaixo(5, 5), true);
  });

  test('Dada uma quantidade abaixo do stock minimo, considera-se stock baixo', () => {
    assert.equal(isStockBaixo(2, 5), true);
  });

  test('Dada uma quantidade acima do stock minimo, nao e stock baixo', () => {
    assert.equal(isStockBaixo(10, 5), false);
  });

  test('Dada uma quantidade negativa, e sempre considerada stock baixo', () => {
    assert.equal(isStockBaixo(-3, 5), true);
  });
});

// Derivacao usada pelo catalogo do GIM (GET /api/gim/artigos): a MESMA regra do
// backoffice, mas tolerante a artigos sem linha de stock.
describe('stock.service.estadoStockArtigo — derivacao de stock_baixo para o GIM', () => {
  test('Dado um artigo sem linha de stock (quantidade null), nao ha alerta e os campos ficam a null', () => {
    const estado = estadoStockArtigo(null, null);

    assert.deepEqual(estado, { stock: null, stock_minimo: null, stock_baixo: false });
  });

  test('Dado um artigo sem linha de stock com minimo indefinido, nao rebenta nem inventa alertas', () => {
    assert.equal(estadoStockArtigo(undefined, 5).stock_baixo, false);
    assert.equal(estadoStockArtigo(undefined, 5).stock, null);
  });

  test('Dado stock zero, e considerado stock baixo (esgotado)', () => {
    const estado = estadoStockArtigo(0, 5);

    assert.equal(estado.stock, 0);
    assert.equal(estado.stock_minimo, 5);
    assert.equal(estado.stock_baixo, true);
  });

  test('Dado stock negativo, e considerado stock baixo', () => {
    assert.equal(estadoStockArtigo(-2, 5).stock_baixo, true);
    assert.equal(estadoStockArtigo(-2, 5).stock, -2);
  });

  test('Dado stock igual ao minimo, E considerado stock baixo (limite inclusivo)', () => {
    assert.equal(estadoStockArtigo(5, 5).stock_baixo, true);
  });

  test('Dado stock acima do minimo, nao ha alerta', () => {
    assert.equal(estadoStockArtigo(6, 5).stock_baixo, false);
  });

  test('Dado um minimo por configurar (null), so alerta quando o artigo esgota mesmo', () => {
    assert.equal(estadoStockArtigo(3, null).stock_baixo, false);
    assert.equal(estadoStockArtigo(3, null).stock_minimo, 0);
    assert.equal(estadoStockArtigo(0, null).stock_baixo, true);
  });

  test('Dados valores decimais vindos da BD como texto, converte antes de comparar', () => {
    assert.equal(estadoStockArtigo('2.50', '3.00').stock_baixo, true);
    assert.equal(estadoStockArtigo('3.50', '3.00').stock_baixo, false);
  });
});
