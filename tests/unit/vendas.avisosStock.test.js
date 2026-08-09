'use strict';

/**
 * Avisos de stock devolvidos por POST /api/vendas.
 *
 * REGRA DE NEGOCIO: sao SEMPRE informativos. A venda ja foi registada quando o
 * aviso e gerado — nunca bloqueiam nem impedem o operador de continuar.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { descreverAvisoStock } = require('../../src/services/vendas.service');

/** Resultado de stockService.aplicarMovimento para um artigo. */
function movimento({ atual, stockMinimo, unidade = 'un' }) {
  return {
    anterior: atual + 1,
    atual,
    negativo: atual < 0,
    baixo: atual <= stockMinimo,
    stockMinimo,
    unidade
  };
}

describe('vendas.service.descreverAvisoStock — sem nada a assinalar', () => {
  test('Dado stock confortavelmente acima do minimo, nao gera aviso nenhum', () => {
    const aviso = descreverAvisoStock('Imperial', 7, movimento({ atual: 48, stockMinimo: 30 }));

    assert.equal(aviso, null);
  });
});

describe('vendas.service.descreverAvisoStock — stock baixo', () => {
  test('Dada uma venda que faz o stock cair abaixo do minimo, gera aviso do tipo stock_baixo', () => {
    // Given: restam 3 unidades e o minimo e 5
    // When
    const aviso = descreverAvisoStock('Cafe', 3, movimento({ atual: 3, stockMinimo: 5 }));

    // Then
    assert.equal(aviso.tipo, 'stock_baixo');
    assert.equal(aviso.artigo_id, 3);
    assert.equal(aviso.artigo, 'Cafe');
    assert.equal(aviso.quantidade, 3);
    assert.equal(aviso.stock_minimo, 5);
    assert.equal(aviso.unidade, 'un');
    assert.match(aviso.mensagem, /Cafe/);
    assert.match(aviso.mensagem, /responsavel/i);
  });

  test('Dado stock exatamente igual ao minimo, ja gera aviso (limite inclusivo)', () => {
    const aviso = descreverAvisoStock('Cha', 4, movimento({ atual: 5, stockMinimo: 5 }));

    assert.equal(aviso.tipo, 'stock_baixo');
  });

  test('Dado stock a zero sem ficar negativo, gera aviso de stock baixo', () => {
    const aviso = descreverAvisoStock('Tosta mista', 9, movimento({ atual: 0, stockMinimo: 5 }));

    assert.equal(aviso.tipo, 'stock_baixo');
    assert.equal(aviso.quantidade, 0);
  });

  test('Dada uma unidade diferente de "un", a mensagem usa a unidade do artigo', () => {
    const aviso = descreverAvisoStock('Vinho a granel', 11, movimento({ atual: 1.5, stockMinimo: 3, unidade: 'L' }));

    assert.equal(aviso.unidade, 'L');
    assert.match(aviso.mensagem, /1\.5 L/);
  });
});

describe('vendas.service.descreverAvisoStock — stock negativo', () => {
  test('Dado stock negativo, gera aviso do tipo stock_negativo (mais grave que stock baixo)', () => {
    const aviso = descreverAvisoStock('Gelado premium', 24, movimento({ atual: -5, stockMinimo: 5 }));

    assert.equal(aviso.tipo, 'stock_negativo');
    assert.equal(aviso.quantidade, -5);
    assert.match(aviso.mensagem, /Gelado premium/);
    assert.match(aviso.mensagem, /negativo/i);
  });

  test('Dado stock negativo, nao duplica o aviso de stock baixo para o mesmo artigo', () => {
    // Given: -5 e simultaneamente negativo E abaixo do minimo
    const resultado = movimento({ atual: -5, stockMinimo: 5 });
    assert.equal(resultado.negativo, true);
    assert.equal(resultado.baixo, true);

    // When / Then: um artigo produz sempre no maximo UM aviso
    const aviso = descreverAvisoStock('Gelado premium', 24, resultado);
    assert.equal(aviso.tipo, 'stock_negativo');
  });
});
