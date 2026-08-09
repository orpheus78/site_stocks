/* ==========================================================================
   JS partilhado (fora do POS, que tem o seu proprio /js/pos.js).
   Dependencias: bundle do Bootstrap + /js/valor-decimal.js + /js/confirmar.js
   (os tres carregados no layout, por esta ordem).

   Os valores monetarios sao editados em formato pt-PT (VIRGULA) e convertidos
   para ponto no submit — ver /js/valor-decimal.js.

   As confirmacoes NAO usam confirm() nativo: sao do modal proprio da
   aplicacao (/js/confirmar.js), acionado por [data-confirmar] nos formularios.
   ========================================================================== */
(function () {
  'use strict';

  // Sem o modulo de valores o teclado nao funciona: falhar alto e melhor do
  // que voltar ao comportamento antigo (que apagava o campo silenciosamente).
  var VD = window.ValorDecimal;

  // ------------------------------------------------------------------ helpers

  /** NodeList -> Array: WebViews antigas nao tem NodeList.prototype.forEach. */
  function lista(seletor, raiz) {
    var nos = (raiz || document).querySelectorAll(seletor);
    return Array.prototype.slice.call(nos);
  }

  /** Equivalente a Element.closest, com recuo para WebViews antigas. */
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

  /** dispatch de 'input' sem depender do construtor Event (WebViews antigas). */
  function dispararInput(elemento) {
    var evento;
    try {
      evento = new Event('input', { bubbles: true });
    } catch (e) {
      evento = document.createEvent('Event');
      evento.initEvent('input', true, false);
    }
    elemento.dispatchEvent(evento);
  }

  function arredondar(valor) {
    var n = Number(valor);
    if (!isFinite(n)) return 0;
    // Sem Number.EPSILON (indisponivel em WebViews antigas); o desvio fixo
    // resolve os casos tipicos de virgula flutuante (ex.: 1.005 -> 1.01).
    return Math.round(n * 100 + (n >= 0 ? 1e-9 : -1e-9)) / 100;
  }

  function eur(valor) {
    var n = arredondar(valor);
    try {
      return n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
    } catch (e) {
      return n.toFixed(2).replace('.', ',') + ' €';
    }
  }

  // ------------------------------------------------- flash messages efemeras

  lista('.alert-dismissible').forEach(function (alerta) {
    setTimeout(function () {
      if (window.bootstrap && window.bootstrap.Alert) {
        window.bootstrap.Alert.getOrCreateInstance(alerta).close();
      }
    }, 6000);
  });

  // ------------------------------------------------- talao: foco em "Voltar"

  var talaoVoltar = document.getElementById('talaoVoltar');
  if (talaoVoltar) talaoVoltar.focus();

  // ------------------------------------------- campos de valor (formato pt-PT)

  /**
   * <input data-campo-decimal> e um campo de dinheiro em formato de ECRA
   * (virgula). Tem de ser type="text" + inputmode="decimal": um
   * <input type="number"> descarta estados intermedios como "20," e deixa o
   * campo VAZIO — era exatamente esse o bug da tecla da virgula.
   */
  var camposDecimais = VD ? lista('input[data-campo-decimal]') : [];

  camposDecimais.forEach(function (campo) {
    // Coerencia do valor inicial vindo do HTML ("0.00" -> "0,00").
    if (campo.value) campo.value = VD.sanitizar(VD.paraEcra(campo.value));

    // Teclado FISICO: filtra letras, separadores a mais e casas decimais extra.
    campo.addEventListener('input', function () {
      var limpo = VD.sanitizar(campo.value);
      if (limpo !== campo.value) campo.value = limpo;
    });
  });

  /**
   * Ponte para o servidor: no submit, "20,50" passa a "20.50".
   * O express-validator (isFloat) e o round2 do servico esperam ponto.
   */
  var formulariosComValor = [];
  camposDecimais.forEach(function (campo) {
    var form = campo.form;
    if (form && formulariosComValor.indexOf(form) === -1) formulariosComValor.push(form);
  });

  formulariosComValor.forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      var invalido = null;

      lista('input[data-campo-decimal]', form).forEach(function (campo) {
        var normalizado = VD.normalizarDecimal(campo.value);
        if (normalizado === '' && campo.required) {
          if (!invalido) invalido = campo;
          return;
        }
        campo.value = normalizado;
      });

      if (invalido) {
        ev.preventDefault();
        invalido.focus();
      }
    });
  });

  // ------------------------------------------------- teclado numerico (caixa)

  /**
   * Liga um teclado numerico grande a um campo de valor.
   * Marcacao esperada:
   *   <div class="teclado-num" data-alvo="idDoInput"> ... botoes [data-tecla] ... </div>
   * Toda a logica de edicao vive em VD.aplicarTecla (pura e testada).
   */
  lista('.teclado-num').forEach(function (teclado) {
    var alvo = document.getElementById(teclado.getAttribute('data-alvo'));
    if (!alvo || !VD) return;

    teclado.addEventListener('click', function (ev) {
      var botao = maisProximo(ev.target, '[data-tecla]');
      if (!botao) return;

      var novo = VD.aplicarTecla(alvo.value, botao.getAttribute('data-tecla'));
      if (novo === alvo.value) return;

      alvo.value = novo;
      dispararInput(alvo);
    });
  });

  // ------------------------------------------- caixa: pre-visualizar diferenca

  var contado = document.getElementById('total_contado');
  var previsao = document.getElementById('caixaDiferenca');
  if (contado && previsao && VD) {
    // O esperado vem do SERVIDOR (ja com ponto) e pode ser NEGATIVO se as
    // sangrias excederem o fundo — por isso nao passa por normalizarDecimal,
    // que so aceita valores >= 0 escritos pelo utilizador.
    var esperado = arredondar(previsao.getAttribute('data-esperado'));

    var atualizarDiferenca = function () {
      // "20," ou "" ainda nao sao um valor: nao mostrar nada (nunca "NaN €").
      if (!VD.eValido(contado.value)) {
        previsao.hidden = true;
        return;
      }
      var diferenca = arredondar(VD.paraNumero(contado.value) - esperado);
      previsao.hidden = false;
      previsao.classList.remove('caixa-dif-ok', 'caixa-dif-falta', 'caixa-dif-sobra');

      if (diferenca === 0) {
        previsao.classList.add('caixa-dif-ok');
        previsao.textContent = 'Sem diferenca — bate certo (' + eur(esperado) + ').';
      } else if (diferenca < 0) {
        previsao.classList.add('caixa-dif-falta');
        previsao.textContent = 'FALTAM ' + eur(Math.abs(diferenca)) + ' (esperado ' + eur(esperado) + ').';
      } else {
        previsao.classList.add('caixa-dif-sobra');
        previsao.textContent = 'SOBRAM ' + eur(diferenca) + ' (esperado ' + eur(esperado) + ').';
      }
    };

    contado.addEventListener('input', atualizarDiferenca);
    atualizarDiferenca();

    var formFecho = document.getElementById('formFecharCaixa');
    if (formFecho && window.Confirmar) {
      /*
       * A confirmacao em si e do modal partilhado (/js/confirmar.js), acionado
       * pelo atributo data-confirmar do formulario. Aqui so se acrescenta o
       * que o HTML nao pode saber: o valor efetivamente contado.
       *
       * Nota de ordem: este handler corre no `document` (bolha), ou seja
       * DEPOIS do handler de normalizacao acima — o campo ja esta em formato
       * de servidor ("20.50"), que VD.paraNumero tambem aceita.
       */
      window.Confirmar.registar(formFecho, function () {
        return {
          mensagem: 'Fechar a caixa com ' + eur(VD.paraNumero(contado.value)) + ' contados?',
          aoCancelar: function () {
            // O submit anterior ja converteu para ponto; se o utilizador
            // desistiu, o campo tem de voltar ao formato de ecra (virgula).
            contado.value = VD.sanitizar(VD.paraEcra(contado.value));
          }
        };
      });
    }
  }

  // -------------------------------------- admin/artigos: preview de imagem

  var inputImagem = document.getElementById('imagem');
  var previewImagem = document.getElementById('imagemPreview');
  if (inputImagem && previewImagem) {
    inputImagem.addEventListener('change', function () {
      var ficheiro = inputImagem.files && inputImagem.files[0];
      if (!ficheiro) return;
      var url = URL.createObjectURL(ficheiro);
      previewImagem.src = url;
      previewImagem.hidden = false;
      previewImagem.addEventListener(
        'load',
        function () {
          URL.revokeObjectURL(url);
        },
        { once: true }
      );
    });
  }

  // ---------------------------------- tabelas: pesquisa rapida no cliente

  /** <input data-filtra-tabela="idDaTabela"> filtra as linhas do <tbody>. */
  lista('[data-filtra-tabela]').forEach(function (campo) {
    var tabela = document.getElementById(campo.getAttribute('data-filtra-tabela'));
    if (!tabela) return;

    campo.addEventListener('input', function () {
      var termo = campo.value.trim().toLowerCase();
      lista('tbody tr', tabela).forEach(function (linha) {
        if (linha.getAttribute('data-sem-dados') === '1') return;
        linha.hidden = termo !== '' && linha.textContent.toLowerCase().indexOf(termo) === -1;
      });
    });
  });

  // ------------------------------ admin/stocks: preencher o modal de movimento

  var modalStock = document.getElementById('modalMovimentoStock');
  if (modalStock) {
    modalStock.addEventListener('show.bs.modal', function (ev) {
      var origem = ev.relatedTarget;
      if (!origem) return;

      var tipo = origem.dataset.tipo || 'entrada';

      modalStock.querySelector('#movArtigoId').value = origem.dataset.artigoId || '';
      modalStock.querySelector('#movArtigoNome').textContent = origem.dataset.artigoNome || '';
      modalStock.querySelector('#movTipo').value = tipo;
      modalStock.querySelector('#movQuantidade').value =
        tipo === 'ajuste' ? origem.dataset.quantidade || '0' : '';
      modalStock.querySelector('#movMotivo').value = '';
      modalStock.querySelector('#movTitulo').textContent =
        tipo === 'ajuste' ? 'Ajustar stock' : 'Entrada de stock';
      modalStock.querySelector('#movTipo').dispatchEvent(new Event('change'));
    });

    var movTipo = modalStock.querySelector('#movTipo');
    var movAjuda = modalStock.querySelector('#movAjuda');
    if (movTipo && movAjuda) {
      var atualizarAjuda = function () {
        movAjuda.textContent =
          movTipo.value === 'ajuste'
            ? 'Ajuste: indique a quantidade final existente em inventario.'
            : 'Entrada/saida: indique a quantidade a somar ou a subtrair.';
      };
      movTipo.addEventListener('change', atualizarAjuda);
      atualizarAjuda();
    }
  }
})();
