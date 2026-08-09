'use strict';

/**
 * confirmar.js — parte PURA do modal de confirmacao da aplicacao.
 *
 * O modal substituiu os `confirm()` nativos do browser. A parte que fala com
 * o DOM nao e testavel em Node, mas a construcao da mensagem e: e nela que
 * mora o que antes era o "\n\n" das mensagens nativas (agora um segundo
 * paragrafo) e a leitura dos atributos [data-confirmar-*] das views.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const Confirmar = require('../../public/js/confirmar');

describe('Confirmar.separarMensagem — o "\\n\\n" das mensagens antigas', () => {
  test('Dada uma mensagem com "\\n\\n", parte em principal + secundaria', () => {
    const r = Confirmar.separarMensagem(
      'ANULAR o movimento #12 de 3.00 €?\n\nO stock sera reposto. Nao pode ser desfeita.'
    );

    assert.equal(r.mensagem, 'ANULAR o movimento #12 de 3.00 €?');
    assert.equal(r.detalhe, 'O stock sera reposto. Nao pode ser desfeita.');
  });

  test('Dada uma quebra simples "\\n", parte na mesma (nunca deixa "\\n" a vista)', () => {
    const r = Confirmar.separarMensagem('Fechar a caixa?\nA sessao fica fechada.');

    assert.equal(r.mensagem, 'Fechar a caixa?');
    assert.equal(r.detalhe, 'A sessao fica fechada.');
  });

  test('Dado um "\\n" LITERAL vindo de um atributo HTML, e tratado como quebra', () => {
    const r = Confirmar.separarMensagem('Eliminar?\\n\\nFica desativado.');

    assert.equal(r.mensagem, 'Eliminar?');
    assert.equal(r.detalhe, 'Fica desativado.');
  });

  test('Dada uma mensagem simples, o detalhe fica vazio', () => {
    const r = Confirmar.separarMensagem('Terminar sessao?');

    assert.equal(r.mensagem, 'Terminar sessao?');
    assert.equal(r.detalhe, '');
  });

  test('Dado lixo (null/undefined), nunca devolve "null" nem rebenta', () => {
    assert.deepEqual(Confirmar.separarMensagem(null), { mensagem: '', detalhe: '' });
    assert.deepEqual(Confirmar.separarMensagem(undefined), { mensagem: '', detalhe: '' });
  });
});

describe('Confirmar.normalizarOpcoes — omissoes e seguranca do texto', () => {
  test('Dado o minimo, aplica os textos por omissao em portugues', () => {
    const o = Confirmar.normalizarOpcoes({ mensagem: 'Eliminar?' });

    assert.equal(o.titulo, 'Confirmar');
    assert.equal(o.mensagem, 'Eliminar?');
    assert.equal(o.detalhe, '');
    assert.equal(o.textoConfirmar, 'Confirmar');
    assert.equal(o.textoCancelar, 'Cancelar');
    assert.equal(o.perigo, false);
  });

  test('Dada uma mensagem vazia, usa uma pergunta generica (nunca um modal mudo)', () => {
    assert.equal(Confirmar.normalizarOpcoes({}).mensagem, 'Confirma esta operacao?');
    assert.equal(Confirmar.normalizarOpcoes({ mensagem: '   ' }).mensagem, 'Confirma esta operacao?');
  });

  test('Dado detalhe derivado E explicito, os dois aparecem (nada se perde)', () => {
    const o = Confirmar.normalizarOpcoes({
      mensagem: 'ANULAR?\n\nO stock sera reposto.',
      detalhe: 'Esta accao nao pode ser desfeita.'
    });

    assert.equal(o.mensagem, 'ANULAR?');
    assert.equal(o.detalhe, 'O stock sera reposto. Esta accao nao pode ser desfeita.');
  });

  test('Dado perigo como string de atributo, e interpretado como booleano', () => {
    assert.equal(Confirmar.normalizarOpcoes({ perigo: '1' }).perigo, true);
    assert.equal(Confirmar.normalizarOpcoes({ perigo: 'true' }).perigo, true);
    assert.equal(Confirmar.normalizarOpcoes({ perigo: 'sim' }).perigo, true);
    assert.equal(Confirmar.normalizarOpcoes({ perigo: '0' }).perigo, false);
    assert.equal(Confirmar.normalizarOpcoes({ perigo: '' }).perigo, false);
    assert.equal(Confirmar.normalizarOpcoes({}).perigo, false);
  });

  test('Nomes com aspas, « » e acentos passam intactos (sao inseridos com textContent)', () => {
    const nome = 'Bebida "gelada" «Nº1» — açaí';
    const o = Confirmar.normalizarOpcoes({ mensagem: 'Eliminar ' + nome + '?' });

    assert.equal(o.mensagem, 'Eliminar ' + nome + '?');
  });

  test('As callbacks so passam se forem mesmo funcoes', () => {
    const fn = () => {};
    const o = Confirmar.normalizarOpcoes({ aoConfirmar: fn, aoCancelar: 'nao-e-funcao' });

    assert.equal(o.aoConfirmar, fn);
    assert.equal(o.aoCancelar, null);
  });
});

describe('Confirmar.opcoesDeAtributos — contrato declarativo das views', () => {
  test('Le todos os atributos [data-confirmar-*] de um formulario', () => {
    const o = Confirmar.normalizarOpcoes(
      Confirmar.opcoesDeAtributos({
        'data-confirmar': 'ANULAR o movimento #12 de 3.00 €?',
        'data-confirmar-titulo': 'Anular movimento',
        'data-confirmar-detalhe': 'O stock dos artigos sera reposto.',
        'data-confirmar-ok': 'Anular movimento',
        'data-confirmar-cancelar': 'Voltar',
        'data-confirmar-perigo': '1'
      })
    );

    assert.equal(o.titulo, 'Anular movimento');
    assert.equal(o.mensagem, 'ANULAR o movimento #12 de 3.00 €?');
    assert.equal(o.detalhe, 'O stock dos artigos sera reposto.');
    assert.equal(o.textoConfirmar, 'Anular movimento');
    assert.equal(o.textoCancelar, 'Voltar');
    assert.equal(o.perigo, true);
  });

  test('Um formulario sem atributos nenhuns nao rebenta', () => {
    const o = Confirmar.normalizarOpcoes(Confirmar.opcoesDeAtributos(null));
    assert.equal(o.mensagem, 'Confirma esta operacao?');
  });
});

describe('Confirmar.juntar — opcoes dinamicas sobrepoem-se aos atributos', () => {
  test('A mensagem calculada no cliente ganha a do HTML', () => {
    const juntas = Confirmar.juntar(
      { mensagem: 'Fechar a caixa com o valor contado?', titulo: 'Fechar caixa', perigo: '1' },
      { mensagem: 'Fechar a caixa com 20,50 € contados?' }
    );

    assert.equal(juntas.mensagem, 'Fechar a caixa com 20,50 € contados?');
    assert.equal(juntas.titulo, 'Fechar caixa', 'o que nao for substituido mantem-se');
    assert.equal(juntas.perigo, '1');
  });

  test('Valores vazios NAO apagam o que veio do HTML', () => {
    const juntas = Confirmar.juntar({ titulo: 'Fechar caixa' }, { titulo: '', detalhe: null });

    assert.equal(juntas.titulo, 'Fechar caixa');
    assert.equal(juntas.detalhe, undefined);
  });
});

describe('API do modulo', () => {
  test('Expoe a API publica esperada pelas paginas', () => {
    for (const chave of ['pedir', 'registar', 'ligarFormularios', 'opcoesDeElemento', 'ATRIBUTO']) {
      assert.ok(Confirmar[chave] !== undefined, `Confirmar.${chave} tem de existir`);
    }
    assert.equal(Confirmar.ATRIBUTO, 'data-confirmar');
  });

  test('Fora do browser, pedir() devolve false (o chamador deixa a accao seguir)', () => {
    // Degradacao: sem DOM nao ha modal, e uma confirmacao que nao abre nunca
    // pode bloquear o balcao.
    assert.equal(Confirmar.pedir({ mensagem: 'x' }), false);
  });
});
