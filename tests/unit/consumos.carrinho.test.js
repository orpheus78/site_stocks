'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  agregarItens,
  calcularSubtotal,
  calcularTotalCarrinho
} = require('../../src/services/consumos.service');
const { AppError } = require('../../src/services/AppError');

describe('consumos.service.agregarItens', () => {
  test('Dados itens distintos, mantem cada artigo com a sua quantidade', () => {
    // Given
    const itens = [
      { artigo_id: 1, quantidade: 2 },
      { artigo_id: 2, quantidade: 1 }
    ];

    // When
    const agregados = agregarItens(itens);

    // Then
    assert.equal(agregados.get(1), 2);
    assert.equal(agregados.get(2), 1);
  });

  test('Dados itens repetidos do mesmo artigo, soma as quantidades numa unica linha', () => {
    // Given
    const itens = [
      { artigo_id: 1, quantidade: 2 },
      { artigo_id: 1, quantidade: 3 }
    ];

    // When
    const agregados = agregarItens(itens);

    // Then
    assert.equal(agregados.size, 1);
    assert.equal(agregados.get(1), 5);
  });

  test('Dado um carrinho vazio, rejeita o consumo', () => {
    assert.throws(() => agregarItens([]), AppError);
  });

  test('Dado um carrinho nulo/nao-array, rejeita o consumo', () => {
    assert.throws(() => agregarItens(null), AppError);
    assert.throws(() => agregarItens(undefined), AppError);
  });

  test('Dada uma quantidade zero ou negativa, rejeita o consumo', () => {
    assert.throws(() => agregarItens([{ artigo_id: 1, quantidade: 0 }]), AppError);
    assert.throws(() => agregarItens([{ artigo_id: 1, quantidade: -1 }]), AppError);
  });

  test('Dado um artigo_id invalido (nao inteiro, zero ou negativo), rejeita o consumo', () => {
    assert.throws(() => agregarItens([{ artigo_id: 0, quantidade: 1 }]), AppError);
    assert.throws(() => agregarItens([{ artigo_id: -3, quantidade: 1 }]), AppError);
    assert.throws(() => agregarItens([{ artigo_id: 1.5, quantidade: 1 }]), AppError);
    assert.throws(() => agregarItens([{ artigo_id: 'abc', quantidade: 1 }]), AppError);
  });

  test('Dadas quantidades fracionarias com centimos, agrega com arredondamento a 2 casas', () => {
    // Given: quantidades tipo peso (ex.: 0.1 + 0.2 kg)
    const itens = [
      { artigo_id: 1, quantidade: 0.1 },
      { artigo_id: 1, quantidade: 0.2 }
    ];

    // When
    const agregados = agregarItens(itens);

    // Then
    assert.equal(agregados.get(1), 0.3);
  });
});

describe('consumos.service.calcularSubtotal', () => {
  test('Dado preco unitario e quantidade inteira, calcula o subtotal exato', () => {
    assert.equal(calcularSubtotal(2.5, 3), 7.5);
  });

  test('Dado um preco com centimos e quantidade que gera dizima, arredonda a 2 casas', () => {
    // 0.1 * 3 = 0.30000000000000004 em floating point puro
    assert.equal(calcularSubtotal(0.1, 3), 0.3);
  });
});

describe('consumos.service.calcularTotalCarrinho', () => {
  test('Dadas varias linhas com subtotais, soma-as para obter o total do carrinho', () => {
    // Given: carrinho tipico de bar (sem IVA em nenhuma linha)
    const linhas = [
      { subtotal: 1.5 },
      { subtotal: 2.4 },
      { subtotal: 0.9 }
    ];

    // When
    const total = calcularTotalCarrinho(linhas);

    // Then
    assert.equal(total, 4.8);
  });

  test('Dado um carrinho vazio de linhas, o total e zero', () => {
    assert.equal(calcularTotalCarrinho([]), 0);
  });

  test('Dadas linhas cuja soma direta teria erro de virgula flutuante, o total fica corretamente arredondado', () => {
    const linhas = [{ subtotal: 0.1 }, { subtotal: 0.2 }];
    assert.equal(calcularTotalCarrinho(linhas), 0.3);
  });
});
