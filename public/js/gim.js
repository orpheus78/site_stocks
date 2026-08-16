/* ==========================================================================
   MOVIMENTOS INTERNOS — logica do ecra de registo GIM.
   Sem frameworks nem bundlers: JS puro (ES2018), compativel com browsers de
   ecras touch antigos que costumam estar atras de um balcao.

   Nao ha dinheiro: nao ha metodo de pagamento, valor recebido nem troco.
   Fluxo tipico (< 4 toques): artigo -> artigo -> Registar -> CONFIRMAR.
   ========================================================================== */
(function () {
  'use strict';

  var raiz = document.getElementById('gim');
  if (!raiz) return;

  // ---------------------------------------------------------------- utilitarios

  /** Formata em EUR com convencao portuguesa (1 234,50 €). */
  function eur(valor) {
    var n = arredondar(valor);
    try {
      return n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
    } catch (e) {
      return n.toFixed(2).replace('.', ',') + ' €';
    }
  }

  /** Arredonda a 2 casas evitando erros de virgula flutuante nas somas. */
  function arredondar(valor) {
    var n = Number(valor);
    if (!isFinite(n)) return 0;
    // Nao usar Number.EPSILON: e ES6 (undefined em WebViews antigas, o que
    // propagaria NaN a todos os totais) e irrelevante a 2 casas decimais.
    return Math.round(n * 100) / 100;
  }

  function el(id) {
    return document.getElementById(id);
  }

  /** Dois digitos, sem `padStart` (ES2017). */
  function dois(v) {
    return ('0' + v).slice(-2);
  }

  /** Cor de texto legivel (preto/branco) para um fundo hexadecimal. */
  function contraste(hex) {
    var c = String(hex || '').replace('#', '');
    if (c.length !== 6) return '#ffffff';
    var r = parseInt(c.slice(0, 2), 16);
    var g = parseInt(c.slice(2, 4), 16);
    var b = parseInt(c.slice(4, 6), 16);
    // Luminancia relativa simplificada (ITU-R BT.601).
    return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#111111' : '#ffffff';
  }

  // ---------------------------------------------------------------- elementos

  var elCategorias = el('gimCategorias');
  var elGrelha = el('gimGrelha');
  var elEstado = el('gimEstado');
  var elPesquisa = el('gimPesquisa');
  var elPesquisaLimpar = el('gimPesquisaLimpar');

  var elLinhas = el('gimLinhas');
  var elCarrinhoVazio = el('gimCarrinhoVazio');
  var elTotal = el('gimTotal');
  var elContagem = el('gimContagem');
  var elRegistar = el('gimRegistar');
  var elLimpar = el('gimLimpar');

  var elModal = el('gimModalMovimento');
  var elModalTotal = el('gimModalTotal');
  var elResumo = el('gimResumo');
  var elMovimentoErro = el('gimMovimentoErro');
  var elConfirmar = el('gimConfirmar');

  var elSucesso = el('gimSucesso');
  var elSucessoNumero = el('gimSucessoNumero');
  var elSucessoNova = el('gimSucessoNova');

  var elToasts = el('gimToasts');
  var elRelogio = el('gimRelogio');

  var elFaltaBtn = el('gimFaltaBtn');
  var elFaltaTexto = el('gimFaltaTexto');
  var elFaltaPainel = el('gimFaltaPainel');
  var elFaltaLista = el('gimFaltaLista');
  var elFaltaFechar = el('gimFaltaFechar');

  // ---------------------------------------------------------------- estado

  var estado = {
    categorias: [],
    artigos: [],
    categoriaAtiva: null, // null = todas
    termo: '',
    carrinho: [], // [{ artigo, quantidade }]
    aEnviar: false
  };

  // ---------------------------------------------------------------- toasts

  var TOAST_MS = 2600;

  function toast(mensagem, tipo) {
    var div = document.createElement('div');
    div.className = 'gim-toast gim-toast-' + (tipo || 'info');
    div.textContent = mensagem;
    elToasts.appendChild(div);
    setTimeout(function () {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, TOAST_MS);
  }

  // ---------------------------------------------------------------- catalogo

  /**
   * @param {boolean} [silencioso] Refresco em segundo plano: nao mostra o
   *   spinner nem substitui a grelha por um erro (o operador continua a vender
   *   com o catalogo que ja tem em memoria).
   */
  function carregarCatalogo(silencioso) {
    if (!silencioso) {
      mostrarEstado(
        '<div class="spinner-border" role="status"><span class="visually-hidden">A carregar...</span></div>' +
          '<p>A carregar artigos...</p>'
      );
    }

    fetch('/api/gim/artigos', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (resp) {
        if (resp.status === 401) {
          window.location.href = '/login?next=/gim';
          throw new Error('sessao expirada');
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (dados) {
        estado.categorias = dados.categorias || [];
        estado.artigos = dados.artigos || [];
        desenharCategorias();
        desenharGrelha();
        desenharAlertasStock();
      })
      .catch(function (err) {
        if (err && err.message === 'sessao expirada') return;
        if (silencioso) return;
        mostrarEstado(
          '<p><i class="bi bi-wifi-off"></i> Nao foi possivel carregar os artigos.</p>' +
            '<button type="button" class="gim-estado-btn" id="gimTentarNovamente">Tentar novamente</button>'
        );
        var btn = el('gimTentarNovamente');
        if (btn) {
          btn.addEventListener('click', function () {
            carregarCatalogo();
          });
        }
      });
  }

  function mostrarEstado(html) {
    elEstado.innerHTML = html;
    elEstado.hidden = false;
    elGrelha.hidden = true;
  }

  function esconderEstado() {
    elEstado.hidden = true;
    elGrelha.hidden = false;
  }

  function corDaCategoria(categoriaId) {
    for (var i = 0; i < estado.categorias.length; i++) {
      if (estado.categorias[i].id === categoriaId) return estado.categorias[i].cor || '#334155';
    }
    return '#334155';
  }

  function desenharCategorias() {
    elCategorias.innerHTML = '';

    var todas = botaoCategoria(null, 'Todos', '#334155');
    elCategorias.appendChild(todas);

    estado.categorias.forEach(function (c) {
      elCategorias.appendChild(botaoCategoria(c.id, c.nome, c.cor || '#334155'));
    });
  }

  function botaoCategoria(id, nome, cor) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gim-categoria' + (estado.categoriaAtiva === id ? ' is-ativa' : '');
    btn.textContent = nome;
    btn.style.background = cor;
    btn.style.color = contraste(cor);
    btn.setAttribute('aria-pressed', estado.categoriaAtiva === id ? 'true' : 'false');
    btn.addEventListener('click', function () {
      estado.categoriaAtiva = id;
      desenharCategorias();
      desenharGrelha();
    });
    return btn;
  }

  function artigosVisiveis() {
    var termo = estado.termo.trim().toLowerCase();
    return estado.artigos.filter(function (a) {
      if (estado.categoriaAtiva !== null && a.categoria_id !== estado.categoriaAtiva) return false;
      if (termo && a.nome.toLowerCase().indexOf(termo) === -1) return false;
      return true;
    });
  }

  function desenharGrelha() {
    var lista = artigosVisiveis();
    elGrelha.innerHTML = '';

    if (!lista.length) {
      mostrarEstado('<p><i class="bi bi-search"></i> Sem artigos para este filtro.</p>');
      return;
    }
    esconderEstado();

    var fragmento = document.createDocumentFragment();
    lista.forEach(function (artigo) {
      fragmento.appendChild(criarTile(artigo));
    });
    elGrelha.appendChild(fragmento);
    atualizarBadges();
  }

  // ------------------------------------------------------- alertas de stock

  /**
   * Classifica o artigo para o alerta visual do GIM.
   * A regra de "stock baixo" (quantidade <= stock_minimo) e sempre a do
   * servidor (campo `stock_baixo`): o cliente nunca a duplica.
   *
   * @returns {'esgotado'|'baixo'|null}
   */
  function alertaStock(artigo) {
    if (!artigo || artigo.stock === null || artigo.stock === undefined) return null;
    if (artigo.stock <= 0) return 'esgotado'; // esgotado ou negativo -> vermelho
    return artigo.stock_baixo ? 'baixo' : null; // 0 < qtd <= minimo -> ambar
  }

  /** Artigos abaixo do minimo, dos mais criticos (maior falta) para os menos. */
  function artigosEmFalta() {
    return estado.artigos
      .filter(function (a) {
        return alertaStock(a) !== null;
      })
      .sort(function (x, y) {
        return x.stock - (x.stock_minimo || 0) - (y.stock - (y.stock_minimo || 0));
      });
  }

  /** Atualiza o contador do topo e, se estiver aberto, a lista do painel. */
  function desenharAlertasStock() {
    var lista = artigosEmFalta();

    // Sem artigos em falta o indicador desaparece por completo (nao ocupa espaco).
    elFaltaBtn.hidden = lista.length === 0;
    elFaltaTexto.textContent = lista.length === 1 ? '1 artigo em falta' : lista.length + ' artigos em falta';
    elFaltaBtn.setAttribute(
      'aria-label',
      lista.length + ' artigos abaixo do stock minimo. Ver lista para avisar o responsavel.'
    );

    if (lista.length === 0 && !elFaltaPainel.hidden) fecharFalta();
    if (!elFaltaPainel.hidden) desenharListaFalta(lista);
  }

  function desenharListaFalta(lista) {
    elFaltaLista.innerHTML = '';

    lista.forEach(function (artigo) {
      var li = document.createElement('li');
      li.className = 'gim-falta-item' + (alertaStock(artigo) === 'esgotado' ? ' is-esgotado' : '');

      var nome = document.createElement('span');
      nome.className = 'gim-falta-nome';
      // textContent: o nome vem da BD e nunca e interpretado como HTML.
      nome.textContent = artigo.nome;

      var valores = document.createElement('span');
      valores.className = 'gim-falta-valores';

      var atual = document.createElement('strong');
      atual.className = 'gim-falta-atual';
      atual.textContent = artigo.stock + ' ' + (artigo.unidade || 'un');

      var minimo = document.createElement('span');
      minimo.className = 'gim-falta-minimo';
      minimo.textContent = 'minimo ' + (artigo.stock_minimo === null ? 0 : artigo.stock_minimo);

      valores.appendChild(atual);
      valores.appendChild(minimo);
      li.appendChild(nome);
      li.appendChild(valores);
      elFaltaLista.appendChild(li);
    });
  }

  function abrirFalta() {
    desenharListaFalta(artigosEmFalta());
    elFaltaPainel.hidden = false;
    elFaltaFechar.focus();
  }

  function fecharFalta() {
    elFaltaPainel.hidden = true;
  }

  function criarTile(artigo) {
    var cor = corDaCategoria(artigo.categoria_id);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gim-tile';
    btn.dataset.artigoId = String(artigo.id);
    btn.style.background = cor;
    btn.setAttribute('aria-label', artigo.nome + ', ' + eur(artigo.preco));

    // Sem imagem: "tile" com a cor da categoria (nunca uma imagem partida).
    if (artigo.imagem) {
      var img = document.createElement('img');
      img.className = 'gim-tile-img';
      img.src = artigo.imagem;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      btn.appendChild(img);
    }

    // ALERTA DE STOCK — sinal permanente no tile.
    // O tile NUNCA e desativado, nem quando esta esgotado ou negativo: num bar
    // de campo o registo nao pode ser bloqueado por um inventario desatualizado
    // (ex.: grades ja repostas mas ainda por registar). O badge serve apenas
    // para o funcionario reparar e avisar o responsavel.
    var alerta = alertaStock(artigo);
    if (alerta) {
      var stock = document.createElement('span');
      stock.className = 'gim-tile-stock is-' + alerta;
      var icone = document.createElement('i');
      icone.className = 'bi bi-exclamation-triangle-fill';
      icone.setAttribute('aria-hidden', 'true');
      stock.appendChild(icone);
      var qtd = document.createElement('span');
      qtd.textContent = String(artigo.stock);
      stock.appendChild(qtd);
      btn.appendChild(stock);

      btn.setAttribute(
        'aria-label',
        artigo.nome + ', ' + eur(artigo.preco) + ', ' +
          (alerta === 'esgotado' ? 'esgotado' : 'stock baixo') + ': ' +
          artigo.stock + ' ' + (artigo.unidade || 'un')
      );
    }

    var badge = document.createElement('span');
    badge.className = 'gim-tile-badge';
    badge.dataset.badgeArtigo = String(artigo.id);
    badge.hidden = true;
    btn.appendChild(badge);

    var texto = document.createElement('span');
    texto.className = 'gim-tile-texto';

    var nome = document.createElement('span');
    nome.className = 'gim-tile-nome';
    nome.textContent = artigo.nome;

    var preco = document.createElement('span');
    preco.className = 'gim-tile-preco';
    preco.textContent = eur(artigo.preco);

    texto.appendChild(nome);
    texto.appendChild(preco);
    btn.appendChild(texto);

    btn.addEventListener('click', function () {
      adicionar(artigo);
      piscar(btn);
    });

    return btn;
  }

  function piscar(elemento) {
    elemento.classList.remove('is-tocado');
    // Forca reflow para reiniciar a animacao em toques repetidos rapidos.
    void elemento.offsetWidth;
    elemento.classList.add('is-tocado');
  }

  // ---------------------------------------------------------------- carrinho

  function linhaDoArtigo(artigoId) {
    for (var i = 0; i < estado.carrinho.length; i++) {
      if (estado.carrinho[i].artigo.id === artigoId) return estado.carrinho[i];
    }
    return null;
  }

  function adicionar(artigo) {
    var linha = linhaDoArtigo(artigo.id);
    if (linha) {
      linha.quantidade += 1;
    } else {
      linha = { artigo: artigo, quantidade: 1 };
      estado.carrinho.push(linha);
    }
    desenharCarrinho(artigo.id);
    toast(artigo.nome + '  +1', 'sucesso');
  }

  function alterarQuantidade(artigoId, delta) {
    var linha = linhaDoArtigo(artigoId);
    if (!linha) return;
    linha.quantidade += delta;
    if (linha.quantidade <= 0) return remover(artigoId);
    desenharCarrinho();
  }

  function remover(artigoId) {
    estado.carrinho = estado.carrinho.filter(function (l) {
      return l.artigo.id !== artigoId;
    });
    desenharCarrinho();
  }

  function limparCarrinho() {
    estado.carrinho = [];
    desenharCarrinho();
  }

  function totalCarrinho() {
    return arredondar(
      estado.carrinho.reduce(function (acc, l) {
        return acc + l.artigo.preco * l.quantidade;
      }, 0)
    );
  }

  function nrArtigos() {
    return estado.carrinho.reduce(function (acc, l) {
      return acc + l.quantidade;
    }, 0);
  }

  function desenharCarrinho(destacarArtigoId) {
    elLinhas.innerHTML = '';

    estado.carrinho.forEach(function (linha) {
      elLinhas.appendChild(criarLinha(linha, linha.artigo.id === destacarArtigoId));
    });

    var vazio = estado.carrinho.length === 0;
    elCarrinhoVazio.hidden = !vazio;
    elRegistar.disabled = vazio;
    elLimpar.disabled = vazio;

    var total = totalCarrinho();
    elTotal.textContent = eur(total);
    var n = nrArtigos();
    elContagem.textContent = n === 1 ? '1 artigo' : n + ' artigos';

    atualizarBadges();

    // Mantem a linha acabada de tocar visivel.
    if (destacarArtigoId) elLinhas.scrollTop = elLinhas.scrollHeight;
  }

  function criarLinha(linha, destacar) {
    var li = document.createElement('li');
    li.className = 'gim-linha' + (destacar ? ' is-nova' : '');

    var info = document.createElement('div');
    info.className = 'gim-linha-info';

    var nome = document.createElement('div');
    nome.className = 'gim-linha-nome';
    nome.textContent = linha.artigo.nome;

    var unit = document.createElement('div');
    unit.className = 'gim-linha-unit';
    unit.textContent = eur(linha.artigo.preco) + ' / ' + (linha.artigo.unidade || 'un');

    info.appendChild(nome);
    info.appendChild(unit);

    var subtotal = document.createElement('div');
    subtotal.className = 'gim-linha-subtotal';
    subtotal.textContent = eur(linha.artigo.preco * linha.quantidade);

    var acoes = document.createElement('div');
    acoes.className = 'gim-linha-acoes';

    var menos = document.createElement('button');
    menos.type = 'button';
    menos.className = 'gim-qtd-btn';
    menos.textContent = '−';
    menos.setAttribute('aria-label', 'Menos uma unidade de ' + linha.artigo.nome);
    menos.addEventListener('click', function () {
      alterarQuantidade(linha.artigo.id, -1);
    });

    var qtd = document.createElement('span');
    qtd.className = 'gim-qtd-valor';
    qtd.textContent = String(linha.quantidade);

    var mais = document.createElement('button');
    mais.type = 'button';
    mais.className = 'gim-qtd-btn';
    mais.textContent = '+';
    mais.setAttribute('aria-label', 'Mais uma unidade de ' + linha.artigo.nome);
    mais.addEventListener('click', function () {
      alterarQuantidade(linha.artigo.id, 1);
    });

    var lixo = document.createElement('button');
    lixo.type = 'button';
    lixo.className = 'gim-remover';
    lixo.innerHTML = '<i class="bi bi-trash3" aria-hidden="true"></i>';
    lixo.setAttribute('aria-label', 'Remover ' + linha.artigo.nome);
    lixo.addEventListener('click', function () {
      remover(linha.artigo.id);
    });

    acoes.appendChild(menos);
    acoes.appendChild(qtd);
    acoes.appendChild(mais);
    acoes.appendChild(lixo);

    li.appendChild(info);
    li.appendChild(subtotal);
    li.appendChild(acoes);
    return li;
  }

  /** Badge com a quantidade no proprio tile do artigo. */
  function atualizarBadges() {
    var mapa = {};
    estado.carrinho.forEach(function (l) {
      mapa[l.artigo.id] = l.quantidade;
    });

    var badges = elGrelha.querySelectorAll('[data-badge-artigo]');
    Array.prototype.forEach.call(badges, function (badge) {
      var qtd = mapa[Number(badge.dataset.badgeArtigo)];
      if (qtd) {
        badge.textContent = String(qtd);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    });
  }

  // ------------------------------------------------------ registo do movimento

  function abrirMovimento() {
    if (!estado.carrinho.length) return;
    elModal.hidden = false;
    limparErro();
    desenharResumo();
    elModalTotal.textContent = eur(totalCarrinho());
    elConfirmar.disabled = estado.aEnviar;
    elConfirmar.focus();
  }

  function fecharMovimento() {
    elModal.hidden = true;
    elRegistar.focus();
  }

  function limparErro() {
    elMovimentoErro.hidden = true;
    elMovimentoErro.textContent = '';
  }

  function mostrarErro(mensagem) {
    elMovimentoErro.hidden = false;
    elMovimentoErro.textContent = mensagem;
  }

  /**
   * Resumo do que vai ser registado (o operador confirma antes de gravar).
   * Construido com createElement/textContent: os nomes vem da BD e nunca sao
   * interpretados como HTML.
   */
  function desenharResumo() {
    elResumo.innerHTML = '';

    estado.carrinho.forEach(function (linha) {
      var li = document.createElement('li');
      li.className = 'gim-resumo-item';

      var nome = document.createElement('span');
      nome.className = 'gim-resumo-nome';
      nome.textContent = linha.quantidade + 'x ' + linha.artigo.nome;

      var valor = document.createElement('span');
      valor.className = 'gim-resumo-valor';
      valor.textContent = eur(linha.artigo.preco * linha.quantidade);

      li.appendChild(nome);
      li.appendChild(valor);
      elResumo.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- submissao

  function confirmar() {
    if (estado.aEnviar || !estado.carrinho.length) return;

    // Nao vai `metodo_pagamento`: o servidor assume `interno` (sem dinheiro,
    // sem troco). Tambem nao vao precos — os precos sao sempre os da BD.
    var corpo = {
      itens: estado.carrinho.map(function (l) {
        return { artigo_id: l.artigo.id, quantidade: l.quantidade };
      })
    };

    estado.aEnviar = true;
    elConfirmar.disabled = true;
    elConfirmar.classList.add('is-ocupado');
    limparErro();

    fetch('/api/consumos', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo)
    })
      .then(function (resp) {
        if (resp.status === 401) {
          window.location.href = '/login?next=/gim';
          throw new Error('sessao expirada');
        }
        // Um proxy/erro 5xx pode devolver HTML: nunca deixar o operador ver
        // "Unexpected token <" como mensagem de erro.
        return resp.text().then(function (texto) {
          var dados = {};
          try { dados = JSON.parse(texto) || {}; } catch (e) { dados = {}; }
          if (!resp.ok) {
            var msg = dados && (dados.erro || (dados.erros && dados.erros[0] && dados.erros[0].mensagem));
            throw new Error(msg || 'Erro ao registar o movimento (HTTP ' + resp.status + ').');
          }
          return dados;
        });
      })
      .then(function (dados) {
        // Avisos de stock: o movimento passou na mesma (regra de negocio) —
        // sao apenas informativos e nunca bloqueiam o fluxo.
        // `avisos_stock` traz o `tipo`; `avisos` (texto simples) e o fallback
        // para respostas de versoes anteriores da API.
        var avisos = dados.avisos_stock;
        if (avisos && avisos.length) {
          avisos.forEach(function (aviso) {
            toast(aviso.mensagem, aviso.tipo === 'stock_negativo' ? 'erro' : 'aviso');
          });
        } else {
          (dados.avisos || []).forEach(function (aviso) {
            toast(aviso, 'aviso');
          });
        }
        mostrarSucesso(dados);
        limparCarrinho();
        // O stock desceu: refrescar badges e contador sem recarregar a pagina.
        // Feito por evento (movimento registado), nunca em polling.
        carregarCatalogo(true);
      })
      .catch(function (err) {
        if (err && err.message === 'sessao expirada') return;
        // A lista NUNCA se perde num erro: o operador pode tentar de novo.
        toast(err.message || 'Sem ligacao ao servidor. Tente novamente.', 'erro');
        mostrarErro(err.message || 'Sem ligacao ao servidor. Tente novamente.');
      })
      .then(function () {
        estado.aEnviar = false;
        elConfirmar.classList.remove('is-ocupado');
        elConfirmar.disabled = false;
      });
  }

  function mostrarSucesso(dados) {
    var consumo = dados.consumo || {};
    elModal.hidden = true;

    elSucessoNumero.textContent =
      'Movimento #' + (consumo.numero || consumo.id || '') + ' · ' + eur(consumo.total || 0);

    elSucesso.hidden = false;
    elSucessoNova.focus();
  }

  function novoMovimento() {
    elSucesso.hidden = true;
    elPesquisa.value = '';
    estado.termo = '';
    elPesquisaLimpar.hidden = true;
    desenharGrelha();
    elRegistar.focus();
    // O catalogo ja foi refrescado assim que o movimento foi registado (o ecra
    // de sucesso so aparece depois disso), por isso aqui nao ha nada a pedir.
  }

  // ---------------------------------------------------------------- eventos

  elRegistar.addEventListener('click', abrirMovimento);
  elLimpar.addEventListener('click', function () {
    if (!estado.carrinho.length) return;

    var artigos = estado.carrinho.reduce(function (soma, l) {
      return soma + l.quantidade;
    }, 0);

    // Painel de confirmacao proprio do GIM (/js/confirmar.js) — nada de
    // confirm() nativo: botoes minusculos num ecra touch sao um risco.
    var mostrado =
      window.Confirmar &&
      window.Confirmar.pedir({
        titulo: 'Limpar lista',
        mensagem: 'Limpar a lista de artigos?',
        detalhe: 'Sao removidos ' + artigos + ' artigo' + (artigos === 1 ? '' : 's') +
          '. O movimento nao chega a ser registado.',
        textoConfirmar: 'Limpar lista',
        textoCancelar: 'Manter lista',
        perigo: true,
        origem: elLimpar,
        aoConfirmar: limparCarrinho
      });

    // Degradacao: sem o modal (ficheiro em falta), o balcao nao pode ficar
    // preso — a accao segue, tal como acontecia se o confirm() nao existisse.
    if (!mostrado) limparCarrinho();
  });

  el('gimModalFechar').addEventListener('click', fecharMovimento);
  el('gimCancelar').addEventListener('click', fecharMovimento);
  elConfirmar.addEventListener('click', confirmar);

  elSucessoNova.addEventListener('click', novoMovimento);

  elFaltaBtn.addEventListener('click', abrirFalta);
  elFaltaFechar.addEventListener('click', fecharFalta);
  // Tocar fora da caixa tambem fecha (gesto habitual num ecra touch).
  elFaltaPainel.addEventListener('click', function (ev) {
    if (ev.target === elFaltaPainel) fecharFalta();
  });

  elPesquisa.addEventListener('input', function () {
    estado.termo = elPesquisa.value;
    elPesquisaLimpar.hidden = !estado.termo;
    desenharGrelha();
  });

  elPesquisaLimpar.addEventListener('click', function () {
    elPesquisa.value = '';
    estado.termo = '';
    elPesquisaLimpar.hidden = true;
    desenharGrelha();
    elPesquisa.focus();
  });

  // Teclado fisico (se existir): Esc fecha, Enter confirma.
  document.addEventListener('keydown', function (ev) {
    // 'Esc' e a variante antiga de 'Escape' (WebViews antigas).
    if (ev.key === 'Escape' || ev.key === 'Esc' || ev.keyCode === 27) {
      if (!elFaltaPainel.hidden) return fecharFalta();
      if (!elSucesso.hidden) return novoMovimento();
      if (!elModal.hidden) return fecharMovimento();
    }
    if ((ev.key === 'Enter' || ev.keyCode === 13) && !elModal.hidden && !elConfirmar.disabled) {
      ev.preventDefault();
      confirmar();
    }
  });

  // Relogio da barra superior (util num balcao sem outro relogio a vista).
  function tique() {
    if (!elRelogio) return;
    var agora = new Date();
    elRelogio.textContent = dois(agora.getHours()) + ':' + dois(agora.getMinutes());
  }
  tique();
  setInterval(tique, 20000);

  // ---------------------------------------------------------------- arranque

  // Sem aviso de caixa: os movimentos internos nao envolvem dinheiro e por
  // isso nao dependem de haver um turno aberto.

  desenharCarrinho();
  // O browser pode restaurar o texto da pesquisa (bfcache/back): sincronizar o
  // estado com o input antes do primeiro desenho da grelha.
  estado.termo = elPesquisa.value || '';
  elPesquisaLimpar.hidden = !estado.termo;
  carregarCatalogo();
})();
