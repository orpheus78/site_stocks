'use strict';

/**
 * Margem bruta (utils.calcularMargem / utils.pctMargem).
 *
 * A mesma conta e usada na listagem de artigos e nos relatorios, por isso os
 * casos limite tem de estar fixados aqui:
 *   - preco 0        -> percentagem sem base de calculo (nunca NaN/Infinity);
 *   - custo > preco  -> margem NEGATIVA, que tem de aparecer (sinal de problema);
 *   - custo 0        -> margem igual ao preco (100%).
 *
 * Regra: margem = preco - custo; percentagem SOBRE O PRECO DE VENDA.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { calcularMargem, pctMargem, decimalEntrada } = require('../../src/utils');

describe('utils.calcularMargem — casos normais', () => {
  test('Dado preco 1.20 e custo 0.40, a margem e 0.80 (66.7% do preco de venda)', () => {
    // Given / When
    const m = calcularMargem(1.2, 0.4);

    // Then
    assert.equal(m.venda, 1.2);
    assert.equal(m.custo, 0.4);
    assert.equal(m.margem, 0.8);
    assert.equal(m.percentagem, 66.67);
  });

  test('Dado custo igual a metade do preco, a margem e exatamente 50%', () => {
    const m = calcularMargem(2, 1);
    assert.equal(m.margem, 1);
    assert.equal(m.percentagem, 50);
  });

  test('Dados valores em string (vindos da BD/formulario), converte antes de calcular', () => {
    const m = calcularMargem('1.50', '0.60');
    assert.equal(m.margem, 0.9);
    assert.equal(m.percentagem, 60);
  });

  test('Arredonda a 2 casas e nao arrasta erro de virgula flutuante', () => {
    const m = calcularMargem(0.7, 0.22);
    assert.equal(m.margem, 0.48);
    assert.equal(m.percentagem, 68.57);
  });
});

describe('utils.calcularMargem — preco de venda 0 (divisao por zero)', () => {
  test('Dado preco 0 e custo 0, a percentagem e null (nunca NaN)', () => {
    // Given: artigo sem preco (ex.: oferta / brinde)
    // When
    const m = calcularMargem(0, 0);

    // Then
    assert.equal(m.margem, 0);
    assert.equal(m.percentagem, null);
    assert.ok(!Number.isNaN(m.percentagem));
  });

  test('Dado preco 0 e custo 0.40, a margem e -0.40 e a percentagem null (nunca -Infinity)', () => {
    const m = calcularMargem(0, 0.4);

    assert.equal(m.margem, -0.4);
    assert.equal(m.percentagem, null);
    assert.ok(m.percentagem !== Infinity && m.percentagem !== -Infinity);
  });

  test('Dado preco 0, a percentagem formatada mostra um travessao e nunca "NaN" nem "Infinity"', () => {
    const m = calcularMargem(0, 1);
    const texto = pctMargem(m.percentagem);

    assert.equal(texto, '—');
    assert.ok(!texto.includes('NaN'));
    assert.ok(!texto.includes('Infinity'));
  });

  test('Dados valores nao numericos, trata-os como 0 e nao devolve NaN', () => {
    const m = calcularMargem('abc', undefined);

    assert.equal(m.venda, 0);
    assert.equal(m.custo, 0);
    assert.equal(m.margem, 0);
    assert.equal(m.percentagem, null);
  });
});

describe('utils.calcularMargem — margem negativa', () => {
  test('Dado custo acima do preco, a margem e negativa (o problema tem de aparecer)', () => {
    // Given: cerveja comprada a 1.50 e vendida a 1.20
    // When
    const m = calcularMargem(1.2, 1.5);

    // Then
    assert.equal(m.margem, -0.3);
    assert.equal(m.percentagem, -25);
    assert.ok(m.margem < 0, 'a margem negativa nao pode ser escondida nem posta a zero');
  });

  test('Dada uma margem negativa, a percentagem formatada mantem o sinal', () => {
    const m = calcularMargem(1, 2);
    assert.equal(pctMargem(m.percentagem), '-100.0 %');
  });
});

describe('utils.calcularMargem — custo 0', () => {
  test('Dado custo 0 (custo ainda por preencher), a margem e o preco todo (100%)', () => {
    const m = calcularMargem(1.5, 0);

    assert.equal(m.custo, 0);
    assert.equal(m.margem, 1.5);
    assert.equal(m.percentagem, 100);
  });

  test('Dado custo em falta (null/undefined), comporta-se como custo 0', () => {
    assert.deepEqual(calcularMargem(1.5, null), calcularMargem(1.5, 0));
    assert.deepEqual(calcularMargem(1.5, undefined), calcularMargem(1.5, 0));
  });
});

describe('utils.calcularMargem — totais de um periodo', () => {
  test('A mesma funcao serve os totais do relatorio (venda e custo agregados)', () => {
    // Given: 65.50 consumidos com 28.75 de custo
    const m = calcularMargem(65.5, 28.75);

    assert.equal(m.margem, 36.75);
    assert.equal(m.percentagem, 56.11);
  });

  test('Periodo sem consumos: tudo a zero e percentagem sem base de calculo', () => {
    const m = calcularMargem(0, 0);
    assert.equal(m.venda, 0);
    assert.equal(m.margem, 0);
    assert.equal(pctMargem(m.percentagem), '—');
  });
});

describe('utils.pctMargem', () => {
  test('Dada uma percentagem valida, formata com uma casa decimal', () => {
    assert.equal(pctMargem(66.67), '66.7 %');
  });

  test('Dado null/undefined/NaN/Infinity, mostra sempre o travessao', () => {
    assert.equal(pctMargem(null), '—');
    assert.equal(pctMargem(undefined), '—');
    assert.equal(pctMargem(NaN), '—');
    assert.equal(pctMargem(Infinity), '—');
  });
});

describe('utils.decimalEntrada — virgula pt-PT nos campos de dinheiro', () => {
  test('Dado "0,40" (como se escreve em Portugal), converte para "0.40"', () => {
    assert.equal(decimalEntrada('0,40'), '0.40');
    assert.equal(Number(decimalEntrada('0,40')), 0.4);
  });

  test('Dado ja o formato do servidor "0.40", deixa igual', () => {
    assert.equal(decimalEntrada('0.40'), '0.40');
  });

  test('Dado o estado intermedio "20," (o bug do type=number), fica "20"', () => {
    assert.equal(decimalEntrada('20,'), '20');
  });

  test('Dado lixo ou um negativo, devolve o valor INTACTO para o validador o recusar', () => {
    // Nao pode "limpar" para vazio: isso seria gravar 0 em silencio.
    assert.equal(decimalEntrada('abc'), 'abc');
    assert.equal(decimalEntrada('-5'), '-5');
    assert.equal(decimalEntrada('1,2,3'), '1,2,3');
  });

  test('Dado um valor que nao e string, devolve-o sem tocar', () => {
    assert.equal(decimalEntrada(0.4), 0.4);
    assert.equal(decimalEntrada(undefined), undefined);
  });
});
