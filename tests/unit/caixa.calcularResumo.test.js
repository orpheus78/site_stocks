'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { calcularResumo } = require('../../src/services/caixa.service');
const { round2 } = require('../../src/utils');

function movimento(tipo, valor) {
  return { tipo, valor };
}

describe('caixa.service.calcularResumo', () => {
  test('CASO DO CLIENTE: fundo 20 + movimentos internos de 5 => esperado 25', () => {
    // Given: caixa aberta com 20 de fundo e movimentos internos que somam 5.00
    const sessao = { fundo_inicial: 20 };
    const totais = { dinheiro: 0, multibanco: 0, interno: 5, total: 5, n_vendas: 2 };

    // When
    const resumo = calcularResumo(sessao, [], totais);

    // Then: os movimentos internos contam para o dinheiro esperado em caixa.
    assert.equal(resumo.movimentos_internos, 5);
    assert.equal(resumo.esperado, 25);
    // E com 25 contados a diferenca e zero.
    assert.equal(round2(25 - resumo.esperado), 0);
  });

  test('Dada uma sessao sem movimentos e sem vendas, o esperado e igual ao fundo inicial', () => {
    // Given
    const sessao = { fundo_inicial: 50 };
    const totais = { dinheiro: 0, multibanco: 0, interno: 0, total: 0, n_vendas: 0 };

    // When
    const resumo = calcularResumo(sessao, [], totais);

    // Then
    assert.equal(resumo.esperado, 50);
  });

  test('Dadas vendas em dinheiro, o esperado inclui o dinheiro recebido mas NAO o multibanco', () => {
    // Given: fundo de 20, vendas com 30 em dinheiro (liquido de troco) e 100 em multibanco
    const sessao = { fundo_inicial: 20 };
    const totais = { dinheiro: 30, multibanco: 100, interno: 0, total: 130, n_vendas: 5 };

    // When
    const resumo = calcularResumo(sessao, [], totais);

    // Then: o multibanco nao entra no dinheiro fisico esperado em caixa
    assert.equal(resumo.esperado, 50); // 20 + 30, sem os 100 de multibanco
    assert.equal(resumo.vendas_multibanco, 100);
  });

  test('Dadas entradas manuais de dinheiro, aumentam o valor esperado em caixa', () => {
    const sessao = { fundo_inicial: 20 };
    const movimentos = [movimento('entrada', 15)];
    const totais = { dinheiro: 0, multibanco: 0, interno: 0, total: 0, n_vendas: 0 };

    const resumo = calcularResumo(sessao, movimentos, totais);

    assert.equal(resumo.esperado, 35);
  });

  test('Dadas saidas e sangrias, diminuem o valor esperado em caixa', () => {
    const sessao = { fundo_inicial: 100 };
    const movimentos = [movimento('saida', 10), movimento('sangria', 20)];
    const totais = { dinheiro: 0, multibanco: 0, interno: 0, total: 0, n_vendas: 0 };

    const resumo = calcularResumo(sessao, movimentos, totais);

    assert.equal(resumo.esperado, 70);
    assert.equal(resumo.saidas, 10);
    assert.equal(resumo.sangrias, 20);
  });

  test('Dado um cenario completo (fundo + vendas dinheiro + entradas - saidas - sangrias), calcula o esperado corretamente', () => {
    // Given
    const sessao = { fundo_inicial: 50 };
    const movimentos = [
      movimento('entrada', 10),
      movimento('saida', 5),
      movimento('sangria', 20)
    ];
    const totais = { dinheiro: 80, multibanco: 200, interno: 0, total: 280, n_vendas: 12 };

    // When
    const resumo = calcularResumo(sessao, movimentos, totais);

    // Then: 50 + 80 + 10 - 5 - 20 = 115 (multibanco fora do calculo)
    assert.equal(resumo.esperado, 115);
  });

  test('Movimentos internos entram no valor esperado em caixa pelo seu total', () => {
    // Given: fundo de 50 e movimentos internos que somam 137.50.
    // (Regra atual: o cliente exige que o consumo interno conte como dinheiro
    // em caixa. Antes ficavam de fora — este teste guarda a regra nova.)
    const sessao = { fundo_inicial: 50 };
    const totais = { dinheiro: 0, multibanco: 0, interno: 137.5, total: 137.5, n_vendas: 9 };

    // When
    const resumo = calcularResumo(sessao, [], totais);

    // Then: 50 + 137.50 = 187.50
    assert.equal(resumo.esperado, 187.5);
    assert.equal(resumo.movimentos_internos, 137.5);
    assert.equal(resumo.vendas_total, 137.5);
    assert.equal(resumo.n_vendas, 9);
  });

  test('Movimentos internos misturados com vendas antigas em dinheiro: contam os dois', () => {
    // Given: 40 em dinheiro de vendas historicas + movimentos internos que somam 60
    const sessao = { fundo_inicial: 25 };
    const totais = { dinheiro: 40, multibanco: 0, interno: 60, total: 100, n_vendas: 7 };

    // When
    const resumo = calcularResumo(sessao, [], totais);

    // Then: 25 + 40 + 60 = 125
    assert.equal(resumo.esperado, 125);
  });

  test('Multibanco de vendas antigas continua fora do esperado, mesmo com movimentos internos', () => {
    // Given: fundo 20, movimentos internos 5 e 100 cobrados em multibanco
    const sessao = { fundo_inicial: 20 };
    const totais = { dinheiro: 0, multibanco: 100, interno: 5, total: 105, n_vendas: 3 };

    const resumo = calcularResumo(sessao, [], totais);

    // Then: 20 + 5 = 25. O cartao nao e dinheiro fisico na gaveta.
    assert.equal(resumo.esperado, 25);
    assert.equal(resumo.vendas_multibanco, 100);
  });

  test('Combinacao: fundo + movimentos internos + entrada manual - sangria', () => {
    // Given
    const sessao = { fundo_inicial: 20 };
    const movimentos = [movimento('entrada', 10), movimento('sangria', 7.5)];
    const totais = { dinheiro: 0, multibanco: 0, interno: 5, total: 5, n_vendas: 2 };

    // When
    const resumo = calcularResumo(sessao, movimentos, totais);

    // Then: 20 + 5 + 10 - 7.50 = 27.50
    assert.equal(resumo.esperado, 27.5);
  });

  test('Sem movimentos internos na sessao, o agregado interno e zero e nao altera o esperado', () => {
    const sessao = { fundo_inicial: 20 };
    const totais = { dinheiro: 0, multibanco: 0, interno: 0, total: 0, n_vendas: 0 };

    const resumo = calcularResumo(sessao, [], totais);

    assert.equal(resumo.movimentos_internos, 0);
    assert.equal(resumo.esperado, 20);
  });

  test('Dados valores com centimos vindos de varios movimentos, o esperado nao acumula erro de virgula flutuante', () => {
    const sessao = { fundo_inicial: 0.1 };
    const movimentos = [movimento('entrada', 0.2)];
    const totais = { dinheiro: 0, multibanco: 0, interno: 0.1, total: 0.1, n_vendas: 1 };

    const resumo = calcularResumo(sessao, movimentos, totais);

    // 0.10 + 0.10 + 0.20 = 0.40 exatos (sem 0.4000000000000001)
    assert.equal(resumo.esperado, 0.4);
  });
});
