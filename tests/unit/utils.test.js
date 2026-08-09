'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { round2, eur, num, hojeISO, diasAtrasISO, dataHoraPT, boolCampo } = require('../../src/utils');

describe('utils.round2', () => {
  test('Dado um valor com erro tipico de virgula flutuante (0.1 + 0.2), arredonda a 2 casas corretamente', () => {
    // Given
    const soma = 0.1 + 0.2; // 0.30000000000000004

    // When
    const resultado = round2(soma);

    // Then
    assert.equal(resultado, 0.3);
  });

  test('Dado um valor ja com 2 casas decimais, mantem o valor inalterado', () => {
    assert.equal(round2(19.99), 19.99);
  });

  test('Dado um valor com mais de 2 casas decimais, arredonda para cima corretamente', () => {
    assert.equal(round2(19.995), 20);
  });

  test('Dado um valor negativo, arredonda mantendo o sinal', () => {
    assert.equal(round2(-4.005), -4);
  });

  test('Dado uma string numerica, converte e arredonda', () => {
    assert.equal(round2('12.3456'), 12.35);
  });

  test('Dado um valor nao numerico, devolve NaN sem rebentar', () => {
    assert.ok(Number.isNaN(round2('abc')));
  });
});

describe('utils.eur', () => {
  test('Dado um valor monetario, formata com 2 casas decimais e simbolo €', () => {
    assert.equal(eur(2.4), '2.40 €');
  });

  test('Dado um valor com dizima, formata arredondado', () => {
    assert.equal(eur(0.1 + 0.2), '0.30 €');
  });

  test('Dado zero, formata como 0.00 €', () => {
    assert.equal(eur(0), '0.00 €');
  });
});

describe('utils.num', () => {
  test('Dado um valor numerico valido, devolve o numero', () => {
    assert.equal(num('42'), 42);
  });

  test('Dado um valor invalido, devolve o fallback', () => {
    assert.equal(num('abc', 99), 99);
  });

  test('Dado nenhum fallback explicito e valor invalido, devolve 0 por omissao', () => {
    assert.equal(num(undefined), 0);
  });
});

describe('utils.hojeISO', () => {
  test('Dada uma data fixa, devolve YYYY-MM-DD em hora local (sem converter para UTC)', () => {
    // Given: uma data local fixa (evita depender do relogio real do sistema)
    const data = new Date(2026, 0, 5, 23, 30); // 5 de janeiro de 2026, 23:30 local

    // When
    const resultado = hojeISO(data);

    // Then: nao deve "saltar" para o dia seguinte por causa de UTC
    assert.equal(resultado, '2026-01-05');
  });

  test('Dado um mes e dia de um digito, preenche com zero a esquerda', () => {
    const data = new Date(2026, 2, 4); // 4 de marco de 2026
    assert.equal(hojeISO(data), '2026-03-04');
  });
});

describe('utils.diasAtrasISO', () => {
  test('Dados 0 dias atras, devolve a data de hoje (equivalente a hojeISO(new Date()))', () => {
    assert.equal(diasAtrasISO(0), hojeISO(new Date()));
  });
});

describe('utils.dataHoraPT', () => {
  test('Dada uma data valida, formata como DD/MM/AAAA HH:MM', () => {
    const data = new Date(2026, 5, 9, 8, 5); // 9 de junho de 2026, 08:05
    assert.equal(dataHoraPT(data), '09/06/2026 08:05');
  });

  test('Dado um valor vazio/nulo, devolve string vazia', () => {
    assert.equal(dataHoraPT(null), '');
    assert.equal(dataHoraPT(undefined), '');
    assert.equal(dataHoraPT(''), '');
  });

  test('Dado um valor invalido para data, devolve string vazia em vez de "Invalid Date"', () => {
    assert.equal(dataHoraPT('nao-e-uma-data'), '');
  });
});

describe('utils.boolCampo', () => {
  test('Dado "on" (checkbox HTML marcada), devolve true', () => {
    assert.equal(boolCampo('on'), true);
  });

  test('Dado "1", "true", "sim", "yes", devolve true independentemente de maiusculas', () => {
    assert.equal(boolCampo('1'), true);
    assert.equal(boolCampo('TRUE'), true);
    assert.equal(boolCampo('Sim'), true);
    assert.equal(boolCampo('YES'), true);
  });

  test('Dado "0" ou "false", devolve false', () => {
    assert.equal(boolCampo('0'), false);
    assert.equal(boolCampo('false'), false);
  });

  test('Dado valor ausente (undefined/null/vazio), devolve o fallback', () => {
    assert.equal(boolCampo(undefined, true), true);
    assert.equal(boolCampo(null, true), true);
    assert.equal(boolCampo('', false), false);
  });
});
