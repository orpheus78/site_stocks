/* ==========================================================================
   confirmar.js — o UNICO sitio onde vive uma confirmacao na aplicacao.

   Substitui os `confirm()` nativos do browser (feios, fora do tema, com
   botoes minusculos — imprestaveis no ecra touch atras do balcao).

   API publica (window.Confirmar):

     Confirmar.pedir({
       titulo:          'Anular movimento',
       mensagem:        'ANULAR o movimento #12 de 3.00 €?',
       detalhe:         'O stock sera reposto. Nao pode ser desfeito.',
       textoConfirmar:  'Anular movimento',
       textoCancelar:   'Cancelar',
       perigo:          true,          // botao vermelho + foco em "Cancelar"
       origem:          botao,         // recebe o foco de volta no fim
       aoConfirmar:     function () {},
       aoCancelar:      function () {}
     });  // -> true se conseguiu mostrar o modal, false se NAO conseguiu

   Uso DECLARATIVO (preferido) em qualquer formulario, sem JS inline nas views:

     <form method="post" action="..."
           data-confirmar="ANULAR o movimento #12 de 3.00 €?"
           data-confirmar-titulo="Anular movimento"
           data-confirmar-detalhe="O stock sera reposto."
           data-confirmar-ok="Anular movimento"
           data-confirmar-cancelar="Cancelar"
           data-confirmar-perigo="1">

   Um unico handler global (instalado por este ficheiro) intercepta o `submit`
   de qualquer formulario com [data-confirmar].

   DOIS ASPETOS, UMA SO API:
     - backoffice/caixa -> modal Bootstrap 5.3 (ja carregado no layout);
     - ecra do GIM      -> painel escuro com os estilos do proprio GIM
                           (.gim-confirmar), botoes >= 80px.
   O adaptador e escolhido automaticamente por `body.gim-body`.

   DEGRADACAO (decisao deliberada): se este ficheiro ou o Bootstrap nao
   carregarem, `pedir()` devolve `false` e o chamador deixa a accao seguir.
   Um bar nao pode ficar parado porque um modal nao abriu — as operacoes
   destrutivas continuam todas protegidas no servidor (permissoes + POST).

   SEGURANCA: todo o texto entra por `textContent`. Nunca `innerHTML` — as
   mensagens levam nomes de artigos/categorias vindos da base de dados.

   Estilo deliberadamente var/function (ES5): os terminais touch do bar podem
   ter WebViews antigas.
   ========================================================================== */
(function (raiz, fabrica) {
  'use strict';

  var api = fabrica();

  if (typeof module === 'object' && module.exports) {
    module.exports = api; // Node (testes unitarios da parte pura)
  } else {
    raiz.Confirmar = api; // Browser (<script src="/js/confirmar.js">)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ATRIBUTO = 'data-confirmar';
  var MARCA_CONFIRMADO = 'data-confirmado';

  var OMISSAO = {
    titulo: 'Confirmar',
    mensagem: 'Confirma esta operacao?',
    textoConfirmar: 'Confirmar',
    textoCancelar: 'Cancelar'
  };

  // ======================================================== parte PURA (testavel)

  function texto(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor);
  }

  function limpar(valor) {
    return texto(valor).replace(/^\s+|\s+$/g, '');
  }

  /** Interpreta o valor de um atributo booleano ("1", "true", "sim", "on"). */
  function bandeira(valor) {
    if (valor === true) return true;
    if (valor === false || valor === null || valor === undefined) return false;
    var s = texto(valor).toLowerCase();
    return s === '1' || s === 'true' || s === 'sim' || s === 'on';
  }

  /**
   * As mensagens antigas dos `confirm()` traziam "\n\n" a separar o aviso.
   * Num modal proprio isso vira DOIS paragrafos: principal + secundario.
   * Aceita tambem "\n" simples e literais "\\n" (vindos de um atributo HTML).
   */
  function separarMensagem(bruto) {
    var s = texto(bruto).replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
    var partes = s.split(/\n{2,}/);
    if (partes.length === 1) partes = s.split('\n');

    var principal = limpar(partes.shift());
    var resto = [];
    for (var i = 0; i < partes.length; i++) {
      var p = limpar(partes[i]);
      if (p) resto.push(p);
    }
    return { mensagem: principal, detalhe: resto.join(' ') };
  }

  function primeiro(a, b) {
    var s = limpar(a);
    return s !== '' ? s : b;
  }

  /**
   * Normaliza o objeto de opcoes: aplica omissoes, parte a mensagem em
   * paragrafos e junta o detalhe explicito ao derivado. Funcao PURA.
   */
  function normalizarOpcoes(bruto) {
    var o = bruto || {};
    var partido = separarMensagem(o.mensagem);

    var detalhes = [];
    if (partido.detalhe) detalhes.push(partido.detalhe);
    var explicito = separarMensagem(o.detalhe);
    if (explicito.mensagem) detalhes.push(explicito.mensagem);
    if (explicito.detalhe) detalhes.push(explicito.detalhe);

    return {
      titulo: primeiro(o.titulo, OMISSAO.titulo),
      mensagem: primeiro(partido.mensagem, OMISSAO.mensagem),
      detalhe: detalhes.join(' '),
      textoConfirmar: primeiro(o.textoConfirmar, OMISSAO.textoConfirmar),
      textoCancelar: primeiro(o.textoCancelar, OMISSAO.textoCancelar),
      perigo: bandeira(o.perigo),
      origem: o.origem || null,
      aoConfirmar: typeof o.aoConfirmar === 'function' ? o.aoConfirmar : null,
      aoCancelar: typeof o.aoCancelar === 'function' ? o.aoCancelar : null
    };
  }

  /** Le as opcoes a partir de um mapa de atributos (PURA). */
  function opcoesDeAtributos(mapa) {
    var m = mapa || {};
    return {
      mensagem: m['data-confirmar'],
      titulo: m['data-confirmar-titulo'],
      detalhe: m['data-confirmar-detalhe'],
      textoConfirmar: m['data-confirmar-ok'],
      textoCancelar: m['data-confirmar-cancelar'],
      perigo: m['data-confirmar-perigo']
    };
  }

  /** Junta opcoes (as da direita ganham, se tiverem valor util). */
  function juntar(base, extra) {
    var r = {};
    var chave;
    for (chave in base) {
      if (Object.prototype.hasOwnProperty.call(base, chave)) r[chave] = base[chave];
    }
    for (chave in extra) {
      if (!Object.prototype.hasOwnProperty.call(extra, chave)) continue;
      var v = extra[chave];
      if (v === undefined || v === null || v === '') continue;
      r[chave] = v;
    }
    return r;
  }

  // ======================================================== parte DOM (browser)

  var temDom = typeof document !== 'undefined' && !!document && !!document.createElement;

  var pendente = null; // pedido a decorrer (so um de cada vez)

  function criar(tag, classe, id) {
    var el = document.createElement(tag);
    if (classe) el.className = classe;
    if (id) el.id = id;
    return el;
  }

  /** Escreve texto (nunca HTML) e esconde o elemento quando nao ha nada. */
  function escrever(el, valor) {
    var s = texto(valor);
    el.textContent = s;
    el.hidden = s === '';
  }

  /** Le as opcoes declarativas de um elemento do DOM. */
  function opcoesDeElemento(el) {
    if (!el || !el.getAttribute) return {};
    return opcoesDeAtributos({
      'data-confirmar': el.getAttribute('data-confirmar'),
      'data-confirmar-titulo': el.getAttribute('data-confirmar-titulo'),
      'data-confirmar-detalhe': el.getAttribute('data-confirmar-detalhe'),
      'data-confirmar-ok': el.getAttribute('data-confirmar-ok'),
      'data-confirmar-cancelar': el.getAttribute('data-confirmar-cancelar'),
      'data-confirmar-perigo': el.getAttribute('data-confirmar-perigo')
    });
  }

  /** Fecha o ciclo: devolve o foco a origem e corre a callback respetiva. */
  function concluir(pedido, confirmado) {
    if (!pedido) return;
    pendente = null;

    // O foco volta SEMPRE a quem abriu o modal (leitores de ecra e teclado).
    if (pedido.origem && pedido.origem.focus) {
      try {
        pedido.origem.focus();
      } catch (e) {
        /* elemento entretanto removido do DOM: nada a fazer */
      }
    }

    if (confirmado) {
      if (pedido.aoConfirmar) pedido.aoConfirmar();
    } else if (pedido.aoCancelar) {
      pedido.aoCancelar();
    }
  }

  // ---------------------------------------------------- adaptador: Bootstrap

  var bs = null; // marcacao criada uma unica vez

  function marcacaoBootstrap() {
    if (bs) return bs;

    var raizEl = criar('div', 'modal fade', 'modalConfirmar');
    raizEl.setAttribute('tabindex', '-1');
    raizEl.setAttribute('role', 'dialog');
    raizEl.setAttribute('aria-modal', 'true');
    raizEl.setAttribute('aria-labelledby', 'modalConfirmarTitulo');
    raizEl.setAttribute('aria-describedby', 'modalConfirmarMensagem');

    var dialogo = criar('div', 'modal-dialog modal-dialog-centered');
    var conteudo = criar('div', 'modal-content');

    var cabecalho = criar('div', 'modal-header');
    var titulo = criar('h2', 'modal-title h5', 'modalConfirmarTitulo');
    var fechar = criar('button', 'btn-close');
    fechar.type = 'button';
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.setAttribute('data-bs-dismiss', 'modal');
    cabecalho.appendChild(titulo);
    cabecalho.appendChild(fechar);

    var corpo = criar('div', 'modal-body');
    var mensagem = criar('p', 'fs-5 mb-2', 'modalConfirmarMensagem');
    var detalhe = criar('p', 'mb-0 text-body-secondary', 'modalConfirmarDetalhe');
    corpo.appendChild(mensagem);
    corpo.appendChild(detalhe);

    var rodape = criar('div', 'modal-footer');
    var cancelar = criar('button', 'btn btn-secondary btn-lg', 'modalConfirmarCancelar');
    cancelar.type = 'button';
    cancelar.setAttribute('data-bs-dismiss', 'modal');
    var ok = criar('button', 'btn btn-primary btn-lg', 'modalConfirmarOk');
    ok.type = 'button';
    rodape.appendChild(cancelar);
    rodape.appendChild(ok);

    conteudo.appendChild(cabecalho);
    conteudo.appendChild(corpo);
    conteudo.appendChild(rodape);
    dialogo.appendChild(conteudo);
    raizEl.appendChild(dialogo);
    document.body.appendChild(raizEl);

    ok.addEventListener('click', function () {
      if (!pendente) return;
      pendente.confirmado = true;
      instanciaBootstrap().hide();
    });

    // Fechar por X, por "Cancelar", por Esc ou por clique fora = CANCELAR.
    raizEl.addEventListener('hidden.bs.modal', function () {
      var pedido = pendente;
      if (!pedido) return;
      concluir(pedido, pedido.confirmado === true);
    });

    raizEl.addEventListener('shown.bs.modal', function () {
      if (!pendente) return;
      // Accao destrutiva: o foco fica no botao MENOS destrutivo.
      (pendente.opcoes.perigo ? cancelar : ok).focus();
    });

    bs = {
      raiz: raizEl,
      titulo: titulo,
      mensagem: mensagem,
      detalhe: detalhe,
      ok: ok,
      cancelar: cancelar
    };
    return bs;
  }

  function instanciaBootstrap() {
    return window.bootstrap.Modal.getOrCreateInstance(marcacaoBootstrap().raiz);
  }

  var adaptadorBootstrap = {
    disponivel: function () {
      return !!(typeof window !== 'undefined' && window.bootstrap && window.bootstrap.Modal);
    },
    mostrar: function (o) {
      var m = marcacaoBootstrap();
      m.titulo.textContent = o.titulo;
      m.mensagem.textContent = o.mensagem;
      escrever(m.detalhe, o.detalhe);
      m.ok.textContent = o.textoConfirmar;
      m.cancelar.textContent = o.textoCancelar;
      m.ok.className = 'btn btn-lg ' + (o.perigo ? 'btn-danger' : 'btn-primary');
      instanciaBootstrap().show();
      return true;
    }
  };

  // ---------------------------------------------------- adaptador: GIM (touch)

  var gimEl = null;

  function marcacaoGim() {
    if (gimEl) return gimEl;

    var raizEl = criar('div', 'gim-confirmar', 'gimConfirmacao');
    raizEl.setAttribute('role', 'dialog');
    raizEl.setAttribute('aria-modal', 'true');
    raizEl.setAttribute('aria-labelledby', 'gimConfirmacaoTitulo');
    raizEl.setAttribute('aria-describedby', 'gimConfirmacaoMensagem');
    raizEl.hidden = true;

    var caixa = criar('div', 'gim-confirmar-caixa');
    var titulo = criar('h2', 'gim-confirmar-titulo', 'gimConfirmacaoTitulo');
    var mensagem = criar('p', 'gim-confirmar-mensagem', 'gimConfirmacaoMensagem');
    var detalhe = criar('p', 'gim-confirmar-detalhe', 'gimConfirmacaoDetalhe');

    var accoes = criar('div', 'gim-confirmar-accoes');
    // ORDEM DELIBERADA: "Cancelar" fica onde o operador ja esta habituado a
    // ter o botao de recuo (esquerda). O botao destrutivo NUNCA ocupa esse
    // lugar — e vermelho, esta afastado e exige toque explicito.
    var cancelar = criar('button', 'gim-confirmar-cancelar', 'gimConfirmacaoCancelar');
    cancelar.type = 'button';
    var ok = criar('button', 'gim-confirmar-ok', 'gimConfirmacaoOk');
    ok.type = 'button';
    accoes.appendChild(cancelar);
    accoes.appendChild(ok);

    caixa.appendChild(titulo);
    caixa.appendChild(mensagem);
    caixa.appendChild(detalhe);
    caixa.appendChild(accoes);
    raizEl.appendChild(caixa);
    document.body.appendChild(raizEl);

    function fechar(confirmado) {
      var pedido = pendente;
      if (!pedido) return;
      raizEl.hidden = true;
      concluir(pedido, confirmado);
    }

    ok.addEventListener('click', function () {
      fechar(true);
    });
    cancelar.addEventListener('click', function () {
      fechar(false);
    });

    // Toque fora da caixa fecha (gesto habitual no GIM) — e sempre CANCELAR.
    raizEl.addEventListener('click', function (ev) {
      if (ev.target === raizEl) fechar(false);
    });

    // Teclado (se existir): Esc cancela sempre; Enter so confirma quando a
    // accao NAO e destrutiva — apagar ou sair exige toque explicito.
    raizEl.addEventListener('keydown', function (ev) {
      var tecla = ev.key;
      if (tecla === 'Escape' || tecla === 'Esc' || ev.keyCode === 27) {
        ev.preventDefault();
        ev.stopPropagation();
        return fechar(false);
      }
      if ((tecla === 'Enter' || ev.keyCode === 13) && pendente && !pendente.opcoes.perigo) {
        ev.preventDefault();
        ev.stopPropagation();
        return fechar(true);
      }
      // Armadilha de foco simples: so ha dois botoes.
      if (tecla === 'Tab' || ev.keyCode === 9) {
        ev.preventDefault();
        (document.activeElement === cancelar ? ok : cancelar).focus();
      }
    });

    gimEl = {
      raiz: raizEl,
      caixa: caixa,
      titulo: titulo,
      mensagem: mensagem,
      detalhe: detalhe,
      ok: ok,
      cancelar: cancelar
    };
    return gimEl;
  }

  var adaptadorGim = {
    disponivel: function () {
      return !!(
        document.body &&
        document.body.className &&
        document.body.className.indexOf('gim-body') !== -1
      );
    },
    mostrar: function (o) {
      var m = marcacaoGim();
      m.titulo.textContent = o.titulo;
      m.mensagem.textContent = o.mensagem;
      escrever(m.detalhe, o.detalhe);
      m.ok.textContent = o.textoConfirmar;
      m.cancelar.textContent = o.textoCancelar;
      m.ok.className = 'gim-confirmar-ok' + (o.perigo ? ' is-perigo' : '');
      m.raiz.hidden = false;
      // Accao destrutiva: foco no botao menos destrutivo.
      (o.perigo ? m.cancelar : m.ok).focus();
      return true;
    }
  };

  function escolherAdaptador() {
    if (adaptadorGim.disponivel()) return adaptadorGim;
    if (adaptadorBootstrap.disponivel()) return adaptadorBootstrap;
    return null;
  }

  /**
   * Mostra a confirmacao.
   * @returns {boolean} true se o modal foi mostrado (o chamador deve PARAR e
   *   esperar pela callback); false se nao foi possivel — nesse caso o
   *   chamador deixa a accao seguir (ver "DEGRADACAO" no topo).
   */
  function pedir(opcoes) {
    if (!temDom) return false;
    if (pendente) return false; // ja ha um pedido no ecra

    var adaptador = escolherAdaptador();
    if (!adaptador) return false;

    var o = normalizarOpcoes(opcoes);
    var origem = o.origem;
    if (!origem && document.activeElement && document.activeElement !== document.body) {
      origem = document.activeElement;
    }

    pendente = {
      opcoes: o,
      origem: origem,
      aoConfirmar: o.aoConfirmar,
      aoCancelar: o.aoCancelar,
      confirmado: false
    };

    var mostrado = false;
    try {
      mostrado = adaptador.mostrar(o) === true;
    } catch (e) {
      mostrado = false;
    }

    if (!mostrado) pendente = null;
    return mostrado;
  }

  // -------------------------------------- handler global dos formularios

  /** Element.closest com recuo para WebViews antigas. */
  function maisProximo(elemento, seletor) {
    var no = elemento;
    while (no && no.nodeType === 1) {
      if (no.closest) return no.closest(seletor);
      var corresponde = no.matches || no.msMatchesSelector || no.webkitMatchesSelector;
      if (corresponde && corresponde.call(no, seletor)) return no;
      no = no.parentNode;
    }
    return null;
  }

  var dinamicas = []; // [{ form, fn }] — opcoes calculadas no momento do submit

  /**
   * Regista opcoes DINAMICAS para um formulario (mensagem que depende do que
   * esta no ecra, ex.: o valor contado no fecho de caixa). A funcao devolve um
   * objeto de opcoes que se sobrepoe ao que vem dos atributos.
   */
  function registar(form, fn) {
    if (!form || typeof fn !== 'function') return;
    dinamicas.push({ form: form, fn: fn });
  }

  function opcoesDinamicas(form) {
    for (var i = 0; i < dinamicas.length; i++) {
      if (dinamicas[i].form === form) return dinamicas[i].fn(form) || {};
    }
    return {};
  }

  /** Submete de facto, ja depois de confirmado. */
  function submeter(form) {
    form.setAttribute(MARCA_CONFIRMADO, '1');
    try {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    } catch (e) {
      form.submit();
    }
    // Se o envio nao chegou a acontecer (validacao HTML do browser recusou os
    // campos), a marca nao pode ficar pendurada — a proxima tentativa tem de
    // voltar a pedir confirmacao.
    setTimeout(function () {
      form.removeAttribute(MARCA_CONFIRMADO);
    }, 0);
  }

  /**
   * Instala o handler global. Delegado no `document` (fase de bolha): corre
   * DEPOIS dos handlers do proprio formulario, por isso respeita quem ja
   * tenha recusado o envio (ex.: validacao dos campos de valor).
   */
  function ligarFormularios() {
    if (!temDom) return;

    document.addEventListener('submit', function (ev) {
      if (ev.defaultPrevented) return;

      var form = maisProximo(ev.target, 'form[' + ATRIBUTO + ']');
      if (!form) return;

      // Segunda passagem: ja foi confirmado, deixa seguir.
      if (form.getAttribute(MARCA_CONFIRMADO) === '1') {
        form.removeAttribute(MARCA_CONFIRMADO);
        return;
      }

      var opcoes = juntar(opcoesDeElemento(form), opcoesDinamicas(form));
      var aoCancelar = opcoes.aoCancelar;

      opcoes.origem = document.activeElement;
      opcoes.aoConfirmar = function () {
        submeter(form);
      };
      opcoes.aoCancelar = typeof aoCancelar === 'function' ? aoCancelar : null;

      // Se o modal nao abrir, NAO se bloqueia o envio (ver "DEGRADACAO").
      if (pedir(opcoes)) ev.preventDefault();
    });
  }

  if (temDom) ligarFormularios();

  return {
    ATRIBUTO: ATRIBUTO,
    // parte pura (coberta por testes unitarios)
    normalizarOpcoes: normalizarOpcoes,
    opcoesDeAtributos: opcoesDeAtributos,
    separarMensagem: separarMensagem,
    juntar: juntar,
    // parte DOM
    pedir: pedir,
    registar: registar,
    opcoesDeElemento: opcoesDeElemento,
    ligarFormularios: ligarFormularios
  };
});
