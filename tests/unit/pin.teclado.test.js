'use strict';

/**
 * Teclado do PIN no login — logica pura (public/js/pin-teclado.js).
 *
 * Como nao e possivel tocar no ecra a partir dos testes, esta suite E a rede
 * de seguranca do teclado: acumular digitos, apagar, limpar, o limite de 4 e a
 * rejeicao de tudo o que nao seja digito.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const PT = require('../../public/js/pin-teclado');

/** Simula uma sequencia de toques a partir do campo vazio. */
function teclar() {
  const teclas = Array.prototype.slice.call(arguments);
  return teclas.reduce((valor, tecla) => PT.aplicarTecla(valor, tecla), '');
}

describe('pin-teclado.aplicarTecla — digitos', () => {
  test('Dado o campo vazio, cada digito acumula pela ordem em que foi tocado', () => {
    assert.equal(teclar('4'), '4');
    assert.equal(teclar('4', '3'), '43');
    assert.equal(teclar('4', '3', '2', '1'), '4321');
  });

  test('Dados 4 digitos, um 5o toque e ignorado (nao desliza a janela)', () => {
    assert.equal(PT.aplicarTecla('4321', '9'), '4321');
    assert.equal(teclar('1', '2', '3', '4', '5', '6'), '1234');
  });

  test('O zero conta como digito normal (nunca substitui o que ja la esta)', () => {
    assert.equal(teclar('0', '0', '0', '0'), '0000');
    assert.equal(PT.aplicarTecla('0', '7'), '07');
  });
});

describe('pin-teclado.aplicarTecla — apagar e limpar', () => {
  test('Apagar tira apenas o ultimo digito', () => {
    assert.equal(PT.aplicarTecla('4321', 'apagar'), '432');
    assert.equal(teclar('1', '2', '3', 'apagar', '9'), '129');
  });

  test('Apagar com o campo vazio nao rebenta nem inventa valor', () => {
    assert.equal(PT.aplicarTecla('', 'apagar'), '');
  });

  test('Um digito trocado no 4o toque e recuperavel: apagar e voltar a escrever', () => {
    assert.equal(teclar('4', '3', '2', '9', 'apagar', '1'), '4321');
  });

  test('Limpar deixa o campo vazio, esteja ele como estiver', () => {
    assert.equal(PT.aplicarTecla('4321', 'limpar'), '');
    assert.equal(PT.aplicarTecla('', 'limpar'), '');
    assert.equal(teclar('1', '2', 'limpar', '9'), '9');
  });
});

describe('pin-teclado.aplicarTecla — entradas invalidas', () => {
  test('Teclas que nao sao digitos deixam o valor inalterado', () => {
    for (const tecla of ['a', ',', '.', '-', ' ', 'Enter', '12', '', 'APAGAR']) {
      assert.equal(PT.aplicarTecla('43', tecla), '43', `tecla ${JSON.stringify(tecla)}`);
    }
  });

  test('null/undefined (tecla ou valor) nao lancam e nao corrompem o PIN', () => {
    assert.equal(PT.aplicarTecla('43', null), '43');
    assert.equal(PT.aplicarTecla('43', undefined), '43');
    assert.equal(PT.aplicarTecla(null, '4'), '4');
    assert.equal(PT.aplicarTecla(undefined, 'apagar'), '');
  });

  test('Um valor sujo (colado ou de um teclado fisico) e limpo antes de tudo', () => {
    assert.equal(PT.aplicarTecla('4a3', '2'), '432');
    assert.equal(PT.aplicarTecla('12345', 'apagar'), '123');
    assert.equal(PT.sanitizar(' 1 2-3.4 5 '), '1234');
    assert.equal(PT.sanitizar('abcd'), '');
  });
});

describe('pin-teclado — estado para o ecra', () => {
  test('preenchidos conta digitos (e o que enche os pontos)', () => {
    assert.equal(PT.preenchidos(''), 0);
    assert.equal(PT.preenchidos('43'), 2);
    assert.equal(PT.preenchidos('4321'), 4);
    assert.equal(PT.preenchidos('4a3'), 2);
  });

  test('estaCompleto so e verdade com exatamente 4 digitos', () => {
    assert.equal(PT.estaCompleto('432'), false);
    assert.equal(PT.estaCompleto('4321'), true);
    assert.equal(PT.estaCompleto(''), false);
    assert.equal(PT.COMPRIMENTO, 4);
  });

  test('A descricao para leitores de ecra conta digitos mas NUNCA os revela', () => {
    const d = PT.descricao('4321');
    assert.match(d, /4 de 4/);
    assert.ok(d.indexOf('4321') === -1, 'a descricao nao pode conter o PIN');
    assert.match(PT.descricao('43'), /2 de 4/);
  });
});
