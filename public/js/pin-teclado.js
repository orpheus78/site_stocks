/* ==========================================================================
   pin-teclado.js — teclado numerico do PIN no ecra de login.

   Porque existe um modulo so para isto (e nao se reaproveita o
   valor-decimal.js): o teclado da caixa edita VALORES (virgula, casas
   decimais, comprimento variavel). O PIN e outra coisa: so digitos, sempre 4,
   e nunca visivel em claro. Misturar os dois so traria ifs a um ficheiro que e
   a unica rede de seguranca contra o bug da virgula.

   Duas metades bem separadas:
     1. LOGICA PURA (aplicarTecla/sanitizar/...) — sem DOM, testada em
        tests/unit/pin.teclado.test.js;
     2. LIGACAO AO DOM — so corre no browser, guardada por `typeof document`.

   DEGRADACAO SEM JAVASCRIPT (deliberada): o HTML servido mostra o <input
   type="password"> e o botao Entrar; o teclado e os pontos vem com `hidden` e
   so este ficheiro os revela. Sem JS o ecra continua utilizavel, apenas sem
   botoes que nao fariam nada.

   ENTRADA AUTOMATICA: ao 4o digito submete-se sozinho, mas so depois de uma
   janela de graca (ESPERA_MS). Nessa janela qualquer toque em Apagar/Limpar
   cancela o envio — um digito trocado e sempre recuperavel.

   O PIN nunca aparece em claro: o campo real e type="password" e esta fora do
   ecra; o que se ve sao 4 pontos que se enchem.

   Estilo deliberadamente var/function (ES5): os terminais touch do bar podem
   ter WebViews antigas.
   ========================================================================== */
(function (raiz, fabrica) {
  'use strict';

  var api = fabrica();

  if (typeof module === 'object' && module.exports) {
    module.exports = api; // Node (testes unitarios da parte pura)
  } else {
    raiz.PinTeclado = api; // Browser (<script src="/js/pin-teclado.js">)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COMPRIMENTO = 4;
  // Janela de graca antes da entrada automatica. 700ms chega para o dedo
  // reagir a um digito trocado sem tornar o login lento.
  var ESPERA_MS = 700;

  function texto(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor);
  }

  /**
   * Deixa passar apenas digitos, no maximo COMPRIMENTO.
   * Serve tambem para limpar o que vem de um teclado FISICO (colar, letras,
   * sinais) antes de chegar aos pontos.
   */
  function sanitizar(valor) {
    return texto(valor).replace(/[^0-9]/g, '').slice(0, COMPRIMENTO);
  }

  /**
   * Coracao do teclado: dado o PIN ATUAL e a tecla premida devolve o NOVO PIN.
   * Funcao pura — sem DOM, sem estado.
   *
   * Teclas: '0'..'9', 'apagar', 'limpar'.
   * Qualquer outra tecla devolve o valor inalterado (nunca lanca).
   */
  function aplicarTecla(atual, tecla) {
    var valor = sanitizar(atual);
    var t = texto(tecla);

    if (t === 'limpar') return '';
    if (t === 'apagar') return valor.slice(0, -1);
    if (!/^[0-9]$/.test(t)) return valor;
    // Ao 4o digito o teclado fica cheio: os toques a mais sao ignorados em vez
    // de deslizarem a janela, senao um toque acidental trocava o PIN todo.
    if (valor.length >= COMPRIMENTO) return valor;

    return valor + t;
  }

  /** Quantos pontos devem aparecer cheios. */
  function preenchidos(valor) {
    return sanitizar(valor).length;
  }

  /** true quando ja ha 4 digitos, ou seja, quando se pode submeter. */
  function estaCompleto(valor) {
    return preenchidos(valor) === COMPRIMENTO;
  }

  /** Texto para leitores de ecra: conta digitos, nunca os revela. */
  function descricao(valor) {
    return preenchidos(valor) + ' de ' + COMPRIMENTO + ' digitos introduzidos.';
  }

  var api = {
    COMPRIMENTO: COMPRIMENTO,
    ESPERA_MS: ESPERA_MS,
    aplicarTecla: aplicarTecla,
    sanitizar: sanitizar,
    preenchidos: preenchidos,
    estaCompleto: estaCompleto,
    descricao: descricao
  };

  // ------------------------------------------------------------------ DOM
  // Tudo o que se segue so existe no browser. Em Node (testes) o modulo fica
  // por aqui e exporta apenas a logica pura.

  if (typeof document === 'undefined') return api;

  /**
   * Sobe de `no` ate `limite` a procura do primeiro elemento com o atributo.
   * Escrito a mao de proposito: `Element.closest` nao existe nas WebViews
   * antigas dos terminais.
   */
  function subirAte(no, atributo, limite) {
    var atual = no;
    while (atual && atual !== limite) {
      if (atual.nodeType === 1 && atual.getAttribute(atributo) !== null) return atual;
      atual = atual.parentNode;
    }
    return null;
  }

  function ligar() {
    var form = document.querySelector('[data-pin-teclado]');
    if (!form) return;

    var campo = form.querySelector('[data-pin-campo]');
    var grelha = form.querySelector('[data-pin-grelha]');
    var caixaPontos = form.querySelector('[data-pin-pontos]');
    var estado = form.querySelector('[data-pin-estado]');
    var pontos = caixaPontos ? caixaPontos.querySelectorAll('[data-pin-ponto]') : [];
    if (!campo || !grelha || !caixaPontos) return;

    var temporizador = null;
    var submetido = false;

    // A validacao HTML5 sai de cena: o campo passa a estar fora do ecra e um
    // `required` num campo invisivel faz o Chrome recusar o submit sem
    // qualquer mensagem visivel. Passamos a validar aqui.
    campo.removeAttribute('required');
    campo.removeAttribute('pattern');
    campo.setAttribute('tabindex', '-1');
    campo.className += ' pin-campo-oculto';

    caixaPontos.removeAttribute('hidden');
    grelha.removeAttribute('hidden');

    function dizer(mensagem) {
      if (estado) estado.textContent = mensagem;
    }

    function cancelarEntrada() {
      if (temporizador === null) return;
      clearTimeout(temporizador);
      temporizador = null;
    }

    function desenhar() {
      var cheios = preenchidos(campo.value);
      for (var i = 0; i < pontos.length; i++) {
        if (i < cheios) {
          pontos[i].setAttribute('data-cheio', '1');
        } else {
          pontos[i].removeAttribute('data-cheio');
        }
      }
    }

    function submeter() {
      if (submetido) return;
      if (!estaCompleto(campo.value)) return;
      submetido = true;
      cancelarEntrada();
      dizer('A entrar...');
      // form.submit() e nao um clique: nao volta a passar pelo handler de
      // submit, o que evita a recursao com a validacao la em baixo.
      form.submit();
    }

    /** Ao 4o digito: agenda o envio e deixa a janela de graca para corrigir. */
    function avaliar(imediato) {
      cancelarEntrada();
      if (!estaCompleto(campo.value)) {
        dizer(descricao(campo.value));
        return;
      }
      if (imediato) return submeter();
      dizer('PIN completo. A entrar... Toque em Apagar para corrigir.');
      temporizador = setTimeout(submeter, ESPERA_MS);
    }

    function aplicar(tecla) {
      if (submetido) return;
      cancelarEntrada();
      campo.value = aplicarTecla(campo.value, tecla);
      desenhar();
      avaliar(false);
    }

    grelha.addEventListener('click', function (evento) {
      var botao = subirAte(evento.target, 'data-pin-tecla', grelha);
      if (!botao) return;
      evento.preventDefault();
      aplicar(botao.getAttribute('data-pin-tecla'));
    });

    // Teclado FISICO (rato + teclado no backoffice): o campo real continua a
    // receber o que se escreve; aqui so se normaliza e se redesenham os pontos.
    campo.addEventListener('input', function () {
      if (submetido) return;
      campo.value = sanitizar(campo.value);
      desenhar();
      avaliar(false);
    });

    campo.addEventListener('keydown', function (evento) {
      // Enter com o PIN completo entra ja: quem usa teclado nao precisa da
      // janela de graca (ve o que escreveu e carregou de proposito).
      if (evento.keyCode === 13 || evento.key === 'Enter') {
        evento.preventDefault();
        avaliar(true);
      }
    });

    // Tocar/clicar nos pontos leva o foco ao campo real: e assim que quem usa
    // teclado fisico comeca a escrever sem ver um campo.
    caixaPontos.addEventListener('click', function () {
      campo.focus();
    });

    form.addEventListener('submit', function (evento) {
      cancelarEntrada();
      if (estaCompleto(campo.value)) {
        submetido = true;
        return;
      }
      // Sem 4 digitos nao vale a pena gastar um pedido no servidor.
      evento.preventDefault();
      dizer('Introduza os ' + COMPRIMENTO + ' digitos do PIN.');
    });

    campo.value = sanitizar(campo.value);
    desenhar();
    dizer(descricao(campo.value));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ligar);
  } else {
    ligar();
  }

  return api;
});
