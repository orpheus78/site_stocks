'use strict';

/**
 * Teclado numerico da caixa — logica pura (public/js/valor-decimal.js).
 *
 * Contexto do bug que estes testes protegem:
 *   o botao rotulado "," escrevia "." num <input type="number">. Atribuir
 *   "20." a um input numerico e invalido pela especificacao HTML, o browser
 *   descarta o valor e o campo fica VAZIO — tocar na virgula limpava a caixa.
 *
 * Como nao e possivel clicar no browser, esta suite E a rede de seguranca:
 * cobre o teclado tecla a tecla e a conversao virgula -> ponto para o servidor.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const VD = require('../../public/js/valor-decimal');

/** Simula uma sequencia de toques a partir do campo vazio. */
function teclar() {
  const teclas = Array.prototype.slice.call(arguments);
  return teclas.reduce((valor, tecla) => VD.aplicarTecla(valor, tecla), '');
}

describe('valor-decimal.aplicarTecla — separador decimal', () => {
  test('Dado o campo vazio, tocar na virgula da "0," (e nao ",")', () => {
    // Given campo vazio  // When toca em ","  // Then
    assert.equal(VD.aplicarTecla('', ','), '0,');
  });

  test('Dado "20", tocar na virgula da "20," (o estado intermedio sobrevive)', () => {
    assert.equal(VD.aplicarTecla('20', ','), '20,');
  });

  test('Dado um teclado fisico que envia ".", escreve na mesma "," no campo', () => {
    assert.equal(VD.aplicarTecla('20', '.'), '20,');
    assert.equal(VD.aplicarTecla('', '.'), '0,');
  });

  test('Dado um valor que ja tem separador, uma segunda virgula e ignorada', () => {
    assert.equal(VD.aplicarTecla('20,5', ','), '20,5');
    assert.equal(VD.aplicarTecla('20,', ','), '20,');
    assert.equal(teclar('2', '0', ',', ',', '5', ','), '20,5');
  });
});

describe('valor-decimal.aplicarTecla — digitos', () => {
  test('Dado "0" no campo, um digito substitui o zero em vez de o acumular', () => {
    assert.equal(VD.aplicarTecla('0', '5'), '5');
  });

  test('Dado "0," (zero com separador), o zero NAO e substituido', () => {
    assert.equal(VD.aplicarTecla('0,', '5'), '0,5');
  });

  test('Dados 2 decimais ja escritos, o 3o digito e ignorado', () => {
    assert.equal(VD.aplicarTecla('20,50', '9'), '20,50');
    assert.equal(teclar('2', '0', ',', '5', '0', '9', '9'), '20,50');
  });

  test('Dado o limite de digitos, digitos adicionais sao ignorados', () => {
    assert.equal(VD.aplicarTecla('1234567', '8'), '1234567');
    assert.equal(VD.aplicarTecla('12345,67', '8'), '12345,67');
  });

  test('Dada uma sequencia tipica de contagem, produz o valor esperado', () => {
    assert.equal(teclar('2', '0', ',', '5', '0'), '20,50');
    assert.equal(teclar('1', '2', '3'), '123');
  });
});

describe('valor-decimal.aplicarTecla — apagar e limpar', () => {
  test('Dado "20,5", apagar remove o ultimo digito', () => {
    assert.equal(VD.aplicarTecla('20,5', 'apagar'), '20,');
  });

  test('Dado "20,", apagar remove o proprio separador', () => {
    assert.equal(VD.aplicarTecla('20,', 'apagar'), '20');
  });

  test('Dado o campo vazio, apagar mantem-no vazio (sem rebentar)', () => {
    assert.equal(VD.aplicarTecla('', 'apagar'), '');
  });

  test('Dado qualquer valor, limpar esvazia o campo', () => {
    assert.equal(VD.aplicarTecla('1234,56', 'limpar'), '');
    assert.equal(VD.aplicarTecla('', 'limpar'), '');
  });

  test('Dada uma tecla desconhecida, o valor fica inalterado', () => {
    assert.equal(VD.aplicarTecla('20,50', 'x'), '20,50');
    assert.equal(VD.aplicarTecla('20,50', '-'), '20,50');
    assert.equal(VD.aplicarTecla('20,50', undefined), '20,50');
  });

  test('Dado o valor inicial "0,00" do HTML, o teclado continua coerente', () => {
    assert.equal(VD.aplicarTecla('0,00', 'limpar'), '');
    assert.equal(VD.aplicarTecla('0,00', 'apagar'), '0,0');
    // Antes da correcao devolvia "0,00" (bloqueado por ja ter 2 decimais):
    // era esse o bug que matava o teclado de "Abrir caixa".
    assert.equal(VD.aplicarTecla('0,00', '5'), '5');
  });
});

/* ==========================================================================
   REGRESSAO: campo pre-preenchido com "0,00" matava o teclado de "Abrir caixa"
   --------------------------------------------------------------------------
   O HTML trazia value="0,00" em #fundo_inicial. Em aplicarTecla:
     - qualquer digito era rejeitado porque partes[1].length (2) ja atingia
       MAX_CASAS_DECIMAIS;
     - a virgula era rejeitada porque ja existia separador.
   Resultado: NENHUMA tecla mudava o campo. O campo de fechar (#total_contado)
   arrancava vazio, dai o bug so ter sido reportado no de abrir.
   ========================================================================== */
describe('valor-decimal.aplicarTecla — REGRESSAO: valor inicial "0,00"', () => {
  test('BUG REPORTADO: partindo de "0,00", teclar 2 0 , 5 0 da "20,50"', () => {
    // Given o campo tal como o HTML o entregava
    // When o utilizador tecla 20,50
    const resultado = ['2', '0', ',', '5', '0'].reduce(
      (valor, tecla) => VD.aplicarTecla(valor, tecla),
      '0,00'
    );

    // Then (antes da correcao ficava "0,00": todas as teclas eram ignoradas)
    assert.equal(resultado, '20,50');
    assert.equal(VD.normalizarDecimal(resultado), '20.50');
  });

  test('Dado "0,00", cada digito SUBSTITUI o valor (nao acumula nem bloqueia)', () => {
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach((d) => {
      assert.equal(VD.aplicarTecla('0,00', d), d, `tecla ${d} sobre "0,00"`);
    });
  });

  test('Dado "0,00", a tecla 0 mantem "0" (nunca "00" nem "0,000")', () => {
    assert.equal(VD.aplicarTecla('0,00', '0'), '0');
  });

  test('Dado "0,00", a virgula recomeca em "0," (em vez de nao fazer nada)', () => {
    assert.equal(VD.aplicarTecla('0,00', ','), '0,');
    assert.equal(VD.aplicarTecla('0,00', '.'), '0,');
  });

  test('Dado "0,00", apagar e limpar continuam a funcionar', () => {
    assert.equal(VD.aplicarTecla('0,00', 'apagar'), '0,0');
    assert.equal(VD.aplicarTecla('0,00', 'limpar'), '');
  });

  test('Dado "0,00", ainda e possivel escrever centimos: , 5 0 -> "0,50"', () => {
    // O risco da correcao: tratar "0," e "0,0" como zero comeria a virgula
    // e valores abaixo de 1 euro ficariam impossiveis de escrever.
    const resultado = [',', '5', '0'].reduce(
      (valor, tecla) => VD.aplicarTecla(valor, tecla),
      '0,00'
    );
    assert.equal(resultado, '0,50');
    assert.equal(VD.normalizarDecimal(resultado), '0.50');
  });

  test('Do campo VAZIO, teclar 0 , 0 5 da "0,05" (estados intermedios preservados)', () => {
    assert.equal(teclar('0', ',', '0', '5'), '0,05');
    assert.equal(VD.aplicarTecla('0,', '5'), '0,5');
    assert.equal(VD.aplicarTecla('0,0', '5'), '0,05');
  });

  test('"0,50" NAO e zero: um digito acrescenta/bloqueia pelas regras normais', () => {
    // A regra do "valor zero" nao pode apanhar valores com centimos reais.
    assert.equal(VD.aplicarTecla('0,50', '9'), '0,50'); // 2 decimais cheias
    assert.equal(VD.aplicarTecla('0,5', '9'), '0,59');
    assert.equal(VD.aplicarTecla('0,50', 'apagar'), '0,5');
  });

  test('"20,00" NAO e zero: o 3o decimal continua bloqueado', () => {
    assert.equal(VD.aplicarTecla('20,00', '5'), '20,00');
    assert.equal(VD.aplicarTecla('20,00', '0'), '20,00');
    assert.equal(VD.aplicarTecla('100,00', '1'), '100,00');
  });

  test('A regra do zero nao apanha valores legitimos com zeros', () => {
    assert.equal(VD.aplicarTecla('0', '0'), '0'); // nunca "00"
    assert.equal(VD.aplicarTecla('10', '0'), '100');
    assert.equal(VD.aplicarTecla('100', '0'), '1000');
    assert.equal(VD.aplicarTecla('20', '0'), '200');
    assert.equal(VD.aplicarTecla('0', '5'), '5');
  });

  test('Sequencia longa realista: 1 2 3 4 , 5 6 -> "1234,56"', () => {
    const resultado = ['1', '2', '3', '4', ',', '5', '6'].reduce(
      (valor, tecla) => VD.aplicarTecla(valor, tecla),
      '0,00'
    );
    assert.equal(resultado, '1234,56');
    assert.equal(VD.normalizarDecimal(resultado), '1234.56');
  });

  test('Partindo de "0,00", os limites de decimais e de digitos mantem-se', () => {
    const comDecimaisAMais = ['9', '9', ',', '9', '9', '9', '9'].reduce(
      (valor, tecla) => VD.aplicarTecla(valor, tecla),
      '0,00'
    );
    assert.equal(comDecimaisAMais, '99,99');

    const demasiadosDigitos = '12345678901'.split('').reduce(
      (valor, tecla) => VD.aplicarTecla(valor, tecla),
      '0,00'
    );
    assert.equal(demasiadosDigitos, '1234567');
    assert.equal(
      demasiadosDigitos.replace(',', '').length,
      VD.MAX_DIGITOS,
      'MAX_DIGITOS tem de continuar a ser respeitado'
    );
  });
});

describe('valor-decimal — sanidade do valor inicial de QUALQUER campo', () => {
  /*
    Rede de seguranca contra a reintroducao do bug: se alguem voltar a
    pre-preencher um campo com teclado, a primeira tecla tem de continuar a
    produzir algo util. "Util" = o campo muda e o resultado normaliza para o
    numero que o utilizador acabou de tocar.
  */
  const INICIAIS = ['', '0', '0,', '0,0', '0,00', '0.00', '00', '20,50', '1234,56', null, undefined];

  test('Um valor inicial que vale zero nunca deixa o teclado morto', () => {
    ['', '0', '0,', '0,0', '0,00', '0.00', '00'].forEach((inicial) => {
      const partida = VD.sanitizar(VD.paraEcra(inicial));
      const depois = VD.aplicarTecla(partida, '7');
      assert.notEqual(depois, partida, `teclado morto com valor inicial ${JSON.stringify(inicial)}`);
    });
  });

  test('Seja qual for o valor inicial, limpar + teclar produz o valor tocado', () => {
    INICIAIS.forEach((inicial) => {
      const limpo = VD.aplicarTecla(VD.sanitizar(VD.paraEcra(inicial)), 'limpar');
      const escrito = ['2', '0', ',', '5', '0'].reduce((v, t) => VD.aplicarTecla(v, t), limpo);
      assert.equal(escrito, '20,50', `valor inicial ${JSON.stringify(inicial)}`);
    });
  });

  test('Um valor inicial que vale ZERO nunca bloqueia o teclado', () => {
    ['', '0', '0,00', '0.00', '00'].forEach((inicial) => {
      const partida = VD.sanitizar(VD.paraEcra(inicial));
      const escrito = ['2', '0', ',', '5', '0'].reduce((v, t) => VD.aplicarTecla(v, t), partida);
      assert.equal(escrito, '20,50', `valor inicial ${JSON.stringify(inicial)}`);
      assert.equal(VD.normalizarDecimal(escrito), '20.50');
    });
  });
});

describe('valor-decimal.sanitizar — teclado fisico', () => {  test('Dado texto com letras, mantem apenas digitos e separador', () => {
    assert.equal(VD.sanitizar('2a0b,5c0'), '20,50');
    assert.equal(VD.sanitizar('abc'), '');
  });

  test('Dado um ponto escrito no teclado fisico, mostra virgula', () => {
    assert.equal(VD.sanitizar('20.50'), '20,50');
  });

  test('Dados varios separadores, mantem so o primeiro', () => {
    assert.equal(VD.sanitizar('20,5,0'), '20,50');
  });

  test('Dado um sinal negativo, e removido (valores negativos nao existem em caixa)', () => {
    assert.equal(VD.sanitizar('-20,50'), '20,50');
  });

  test('Dado mais de 2 decimais, trunca a 2', () => {
    assert.equal(VD.sanitizar('20,5678'), '20,56');
  });

  test('Dado um valor a comecar pelo separador, prefixa com zero', () => {
    assert.equal(VD.sanitizar(',5'), '0,5');
  });

  test('Dado o estado intermedio "20,", preserva-o (nao o descarta)', () => {
    assert.equal(VD.sanitizar('20,'), '20,');
  });
});

describe('valor-decimal.normalizarDecimal — ponte para o servidor', () => {
  test('Dado "20,50" (o que o utilizador ve), envia "20.50" para o servidor', () => {
    assert.equal(VD.normalizarDecimal('20,50'), '20.50');
  });

  test('Dado "20," (separador pendurado), envia "20"', () => {
    assert.equal(VD.normalizarDecimal('20,'), '20');
  });

  test('Dado ",5", envia "0.5"', () => {
    assert.equal(VD.normalizarDecimal(',5'), '0.5');
  });

  test('Dado ja um ponto (teclado fisico), mantem-se valido', () => {
    assert.equal(VD.normalizarDecimal('20.50'), '20.50');
  });

  test('Dados espacos em volta, sao ignorados', () => {
    assert.equal(VD.normalizarDecimal('  20,50  '), '20.50');
  });

  test('Dadas entradas invalidas, devolve "" (nunca NaN nem valor parcial)', () => {
    ['', '   ', 'abc', '20abc', '-5', '20,5,5', ',', '.', null, undefined].forEach((entrada) => {
      assert.equal(VD.normalizarDecimal(entrada), '', `entrada invalida: ${JSON.stringify(entrada)}`);
    });
  });

  test('O resultado de normalizarDecimal e sempre aceite por Number()', () => {
    ['0,', '0,00', '20,5', '1234567', ',5'].forEach((entrada) => {
      const n = Number(VD.normalizarDecimal(entrada));
      assert.ok(!Number.isNaN(n), `${entrada} devia converter para numero`);
    });
  });
});

describe('valor-decimal.paraNumero / eValido', () => {
  test('Dado "20,50", devolve o numero 20.5', () => {
    assert.equal(VD.paraNumero('20,50'), 20.5);
  });

  test('Dado lixo, devolve 0 (ou o fallback) em vez de NaN', () => {
    assert.equal(VD.paraNumero('abc'), 0);
    assert.equal(VD.paraNumero('', 99), 99);
  });

  test('eValido distingue valores completos de estados intermedios', () => {
    assert.equal(VD.eValido('20,50'), true);
    assert.equal(VD.eValido('20,'), true); // "20," vale 20
    assert.equal(VD.eValido(''), false);
    assert.equal(VD.eValido('abc'), false);
  });
});

describe('caixa: pre-visualizacao da diferenca nunca produz NaN', () => {
  // Replica do calculo em public/js/app.js, sem DOM.
  function arredondar(valor) {
    const n = Number(valor);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100 + (n >= 0 ? 1e-9 : -1e-9)) / 100;
  }

  function diferenca(contadoNoEcra, esperado) {
    return arredondar(VD.paraNumero(contadoNoEcra) - esperado);
  }

  test('Dado "20,50" contado e 20.50 esperado, a diferenca e 0 (Number("20,50") daria NaN)', () => {
    assert.ok(Number.isNaN(Number('20,50')), 'premissa do bug: Number com virgula da NaN');
    assert.equal(diferenca('20,50', 20.5), 0);
  });

  test('Dado menos dinheiro do que o esperado, a diferenca e negativa e exata', () => {
    assert.equal(diferenca('18,25', 20.5), -2.25);
  });

  test('Dado mais dinheiro do que o esperado, a diferenca e positiva e exata', () => {
    assert.equal(diferenca('25,05', 20.5), 4.55);
  });

  test('Dado qualquer estado intermedio ou invalido, a diferenca nunca e NaN', () => {
    ['', '0,', '20,', ',', 'abc', '0,0'].forEach((entrada) => {
      const d = diferenca(entrada, 20.5);
      assert.ok(!Number.isNaN(d), `"${entrada}" produziu NaN`);
    });
  });

  test('Dado um esperado NEGATIVO (sangrias > fundo), a diferenca continua correta', () => {
    // O esperado vem do servidor, nao do teclado: pode ser negativo.
    assert.equal(diferenca('5,00', -2.5), 7.5);
    assert.equal(arredondar('-2.50'), -2.5);
  });
});

describe('valor-decimal.paraEcra — valores vindos do servidor', () => {
  test('Dado "0.00" no HTML, mostra "0,00" (formato coerente com o botao ",")', () => {
    assert.equal(VD.paraEcra('0.00'), '0,00');
    assert.equal(VD.sanitizar(VD.paraEcra('0.00')), '0,00');
  });

  test('Dado um numero, converte para texto com virgula', () => {
    assert.equal(VD.paraEcra(20.5), '20,5');
  });

  test('Dado vazio/nulo, devolve string vazia', () => {
    assert.equal(VD.paraEcra(null), '');
    assert.equal(VD.paraEcra(undefined), '');
  });
});
