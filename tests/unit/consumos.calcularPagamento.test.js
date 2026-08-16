'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { calcularPagamento } = require('../../src/services/consumos.service');
const { AppError } = require('../../src/services/AppError');

describe('consumos.service.calcularPagamento — movimento interno', () => {
  test('Sem metodo_pagamento no payload, assume movimento interno sem dinheiro nem troco', () => {
    // Given: o ecra de movimentos internos nao envia metodo de pagamento
    // When
    const resultado = calcularPagamento(12.4, {});

    // Then
    assert.equal(resultado.metodo_pagamento, 'interno');
    assert.equal(resultado.valor_dinheiro, 0);
    assert.equal(resultado.valor_multibanco, 0);
    assert.equal(resultado.troco, 0);
  });

  test('Com metodo_pagamento explicito "interno", nunca ha troco mesmo com valores enviados', () => {
    const resultado = calcularPagamento(7.6, {
      metodo_pagamento: 'interno',
      valor_dinheiro: 20,
      valor_multibanco: 5
    });

    assert.equal(resultado.metodo_pagamento, 'interno');
    assert.equal(resultado.valor_dinheiro, 0);
    assert.equal(resultado.valor_multibanco, 0);
    assert.equal(resultado.troco, 0);
  });

  test('Um movimento interno nunca e recusado por valor insuficiente', () => {
    // Given: total elevado e nenhum valor entregue
    // When / Then: nao lanca
    assert.doesNotThrow(() => calcularPagamento(999.99, { metodo_pagamento: 'interno' }));
  });
});

describe('consumos.service.calcularPagamento — pagamento em dinheiro', () => {
  test('Dado pagamento em dinheiro com valor exato, nao ha troco', () => {
    // Given: total de 12.40 pago com exatamente 12.40 em dinheiro
    const total = 12.4;

    // When
    const resultado = calcularPagamento(total, { metodo_pagamento: 'dinheiro', valor_dinheiro: 12.4 });

    // Then
    assert.equal(resultado.valor_dinheiro, 12.4);
    assert.equal(resultado.valor_multibanco, 0);
    assert.equal(resultado.troco, 0);
  });

  test('Dado pagamento em dinheiro superior ao total, calcula o troco corretamente', () => {
    // Given: total de 7.60, cliente entrega 10€
    const total = 7.6;

    // When
    const resultado = calcularPagamento(total, { metodo_pagamento: 'dinheiro', valor_dinheiro: 10 });

    // Then
    assert.equal(resultado.troco, 2.4);
  });

  test('Dado pagamento em dinheiro sem indicar valor entregue, assume o valor certo (sem troco)', () => {
    // Given: valor_dinheiro nao enviado / zero -> assume-se "valor certo"
    const total = 5;

    // When
    const resultado = calcularPagamento(total, { metodo_pagamento: 'dinheiro' });

    // Then
    assert.equal(resultado.valor_dinheiro, 5);
    assert.equal(resultado.troco, 0);
  });

  test('Dado dinheiro entregue insuficiente para o total, rejeita o consumo', () => {
    // Given: total de 10, cliente so entrega 5
    const total = 10;

    // When / Then
    assert.throws(
      () => calcularPagamento(total, { metodo_pagamento: 'dinheiro', valor_dinheiro: 5 }),
      AppError
    );
  });

  test('Dado total 19.99 pago com uma nota de 20€, o troco e exatamente 0.01 (sem erro de virgula flutuante)', () => {
    // Given
    const total = 19.99;

    // When
    const resultado = calcularPagamento(total, { metodo_pagamento: 'dinheiro', valor_dinheiro: 20 });

    // Then
    assert.equal(resultado.troco, 0.01);
  });

  test('Dado total com precisao de centimos resultante de soma tipica de floats, o troco esta correto', () => {
    // Given: total construido de forma a expor problemas classicos de 0.1 + 0.2
    const total = 0.1 + 0.2; // 0.30000000000000004 sem arredondamento

    // When
    const resultado = calcularPagamento(total, { metodo_pagamento: 'dinheiro', valor_dinheiro: 1 });

    // Then
    assert.equal(resultado.troco, 0.7);
  });
});

describe('consumos.service.calcularPagamento — pagamento multibanco', () => {
  test('Dado pagamento por multibanco, o valor cobrado e sempre o total exato e nunca ha troco', () => {
    // Given
    const total = 15.5;

    // When: mesmo que o cliente envie um valor de multibanco diferente, e ignorado
    const resultado = calcularPagamento(total, { metodo_pagamento: 'multibanco', valor_multibanco: 999 });

    // Then
    assert.equal(resultado.valor_multibanco, total);
    assert.equal(resultado.valor_dinheiro, 0);
    assert.equal(resultado.troco, 0);
  });
});

describe('consumos.service.calcularPagamento — pagamento misto', () => {
  test('Dado pagamento misto sem valor em dinheiro, rejeita o consumo', () => {
    const total = 10;
    assert.throws(
      () => calcularPagamento(total, { metodo_pagamento: 'misto', valor_dinheiro: 0, valor_multibanco: 10 }),
      AppError
    );
  });

  test('Dado pagamento misto sem valor em multibanco, rejeita o consumo', () => {
    const total = 10;
    assert.throws(
      () => calcularPagamento(total, { metodo_pagamento: 'misto', valor_dinheiro: 10, valor_multibanco: 0 }),
      AppError
    );
  });

  test('Dado pagamento misto correto (dinheiro + multibanco cobrem exatamente o total), nao ha troco', () => {
    // Given: total de 10, 6 em multibanco e 4 em dinheiro
    const total = 10;

    // When
    const resultado = calcularPagamento(total, {
      metodo_pagamento: 'misto',
      valor_dinheiro: 4,
      valor_multibanco: 6
    });

    // Then
    assert.equal(resultado.troco, 0);
  });

  test('Dado pagamento misto em que o excedente vem do dinheiro, o troco sai so do dinheiro', () => {
    // Given: total de 10; multibanco cobre 6 (fixo), cliente entrega 5 em dinheiro para os 4 restantes
    const total = 10;

    // When
    const resultado = calcularPagamento(total, {
      metodo_pagamento: 'misto',
      valor_dinheiro: 5,
      valor_multibanco: 6
    });

    // Then: 5 (dinheiro) - 4 (parte do total nao coberta pelo multibanco) = 1 de troco
    assert.equal(resultado.troco, 1);
  });

  test('Dado pagamento misto em que a soma excede muito o total por causa do multibanco, o troco nunca excede o dinheiro entregue', () => {
    // Given: total de 10; multibanco cobre sozinho 20 (ja excede o total) e ainda ha 2 em dinheiro
    // REGRA: o multibanco e uma cobranca fixa, nunca ha "troco de cartao".
    // O troco maximo possivel e o proprio valor de dinheiro entregue (2), nunca mais do que isso.
    const total = 10;

    // When
    const resultado = calcularPagamento(total, {
      metodo_pagamento: 'misto',
      valor_dinheiro: 2,
      valor_multibanco: 20
    });

    // Then
    assert.equal(resultado.troco, 2);
    assert.ok(resultado.troco <= resultado.valor_dinheiro, 'o troco nunca pode exceder o dinheiro entregue');
  });

  test('Dado pagamento misto com valores em centimos, o troco e calculado sem erros de arredondamento', () => {
    // Given
    const total = 12.35;

    // When
    const resultado = calcularPagamento(total, {
      metodo_pagamento: 'misto',
      valor_dinheiro: 2.15,
      valor_multibanco: 10.2
    });

    // Then: entregue = 12.35, sem excedente -> sem troco
    assert.equal(resultado.troco, 0);
  });

  test('Dado pagamento misto em que a soma total entregue e insuficiente, rejeita o consumo', () => {
    const total = 20;
    assert.throws(
      () =>
        calcularPagamento(total, {
          metodo_pagamento: 'misto',
          valor_dinheiro: 5,
          valor_multibanco: 10
        }),
      AppError
    );
  });
});

describe('consumos.service.calcularPagamento — metodo invalido', () => {
  test('Dado um metodo de pagamento desconhecido, rejeita o consumo', () => {
    assert.throws(
      () => calcularPagamento(10, { metodo_pagamento: 'cripto', valor_dinheiro: 10 }),
      AppError
    );
  });
});
