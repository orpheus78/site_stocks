/* ==========================================================================
   valor-decimal.js — logica PURA de edicao de valores monetarios.

   Vive aqui (e nao dentro de app.js) por dois motivos:
     1. o teclado da caixa e a unica rede de seguranca contra o bug da virgula,
        e so e testavel se nao depender de `document`;
     2. o mesmo modulo e carregado no browser por <script> (sem bundler) e em
        Node pelos testes — dai o wrapper UMD.

   Regra de ouro do formato:
     - o que o UTILIZADOR ve e escreve usa VIRGULA (pt-PT);
     - o que vai para o SERVIDOR / Number() usa PONTO.
   A conversao acontece num unico sitio: normalizarDecimal().

   Estilo deliberadamente var/function (ES5): os terminais touch do bar podem
   ter WebViews antigas.
   ========================================================================== */
(function (raiz, fabrica) {
  'use strict';

  var api = fabrica();

  if (typeof module === 'object' && module.exports) {
    module.exports = api; // Node (testes)
  } else {
    raiz.ValorDecimal = api; // Browser (<script src="/js/valor-decimal.js">)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SEPARADOR_ECRA = ',';
  var MAX_CASAS_DECIMAIS = 2;
  var MAX_DIGITOS = 7; // limite herdado do teclado original (999999.99)

  /**
   * Aceita qualquer coisa e devolve uma string; evita "null"/"undefined"
   * a aparecerem dentro do campo.
   */
  function texto(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor);
  }

  /**
   * Passa um valor para o formato de ECRA (virgula) sem validar nada.
   * Usa-se para o valor inicial vindo do HTML/servidor (ex.: "0.00" -> "0,00").
   */
  function paraEcra(valor) {
    return texto(valor).replace('.', SEPARADOR_ECRA);
  }

  /**
   * Normaliza para o formato que o servidor e o Number() entendem (ponto).
   *
   *   "20,50" -> "20.50"      "20," -> "20"       ",5" -> "0.5"
   *   ""      -> ""           "abc" -> ""         "-5" -> "" (negativos fora)
   *
   * Devolver "" para lixo e intencional: o chamador decide se bloqueia o
   * envio ou deixa o servidor recusar. Nunca devolve NaN nem string parcial.
   */
  function normalizarDecimal(valor) {
    var s = texto(valor).trim();
    if (s === '') return '';

    // Aceita virgula OU ponto (teclado fisico), mas so um separador.
    s = s.replace(SEPARADOR_ECRA, '.');

    if (!/^\d*(\.\d*)?$/.test(s)) return '';
    // A ordem importa: "." sozinho tem de dar "" (e nao "0").
    if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
    if (s === '') return '';
    if (s.charAt(0) === '.') s = '0' + s;

    return s;
  }

  /**
   * Numero pronto a calcular. Devolve `omissao` (0 por defeito) quando o
   * valor nao e utilizavel — assim a pre-visualizacao da diferenca nunca
   * mostra "NaN €".
   */
  function paraNumero(valor, omissao) {
    var base = typeof omissao === 'number' ? omissao : 0;
    var s = normalizarDecimal(valor);
    if (s === '') return base;
    var n = Number(s);
    return isFinite(n) ? n : base;
  }

  /** true se o valor representa um decimal completo e valido (>= 0). */
  function eValido(valor) {
    return normalizarDecimal(valor) !== '';
  }

  /**
   * Limpa o que o utilizador escreveu num teclado FISICO, mantendo o formato
   * de ecra: so digitos e um separador, no maximo 2 casas decimais.
   * Nunca rejeita o estado intermedio "20," — e isso que o bug original
   * destruia ao usar <input type="number">.
   */
  function sanitizar(valor) {
    var s = texto(valor).replace(/[^0-9.,]/g, '').replace(/\./g, SEPARADOR_ECRA);

    var partes = s.split(SEPARADOR_ECRA);
    var inteira = partes.shift().slice(0, MAX_DIGITOS);

    if (!partes.length) return inteira;

    var decimal = partes.join('').slice(0, MAX_CASAS_DECIMAIS);
    return (inteira === '' ? '0' : inteira) + SEPARADOR_ECRA + decimal;
  }

  /**
   * Coracao do teclado: dado o valor ATUAL do campo (formato de ecra) e a
   * tecla premida, devolve o NOVO valor. Funcao pura — sem DOM, sem estado.
   *
   * Teclas: '0'..'9', ',' (ou '.', tratado como virgula), 'apagar', 'limpar'.
   * Qualquer tecla desconhecida devolve o valor inalterado.
   */
  /**
   * Um valor que vale zero e ja esta COMPLETO ("", "0", "0,00") funciona como
   * campo vazio: a primeira tecla substitui-o em vez de acumular. Sem isto, um
   * campo pre-preenchido com "0,00" bloqueia o teclado todo -- ja tem 2 casas
   * decimais, por isso os digitos e a virgula sao ambos rejeitados.
   *
   * ATENCAO ao que fica DE FORA, de proposito:
   *   - "0," e "0,0" sao estados INTERMEDIOS de quem esta a escrever centimos
   *     (0 , 5 0 -> "0,50"). Trata-los como zero comeria a virgula e tornaria
   *     impossivel escrever valores abaixo de 1 euro;
   *   - "0,50" / "20,00" tem digitos significativos ou parte inteira != 0,
   *     logo nao sao zero e seguem as regras normais (incluindo o bloqueio
   *     das 2 casas decimais).
   */
  function eZero(valor) {
    var partes = texto(valor).split(SEPARADOR_ECRA);

    // Parte inteira tem de ser vazia ou so zeros ("", "0", "00").
    if (!/^0*$/.test(partes[0])) return false;

    if (partes.length === 1) return true; // sem separador: "", "0", "00"

    // Com separador: so conta como zero quando as casas decimais ja estao
    // cheias de zeros ("0,00") — ou seja, quando o utilizador ja nao pode
    // acrescentar mais nada e o campo continuaria bloqueado.
    return partes[1].length >= MAX_CASAS_DECIMAIS && /^0*$/.test(partes[1]);
  }

  function aplicarTecla(atual, tecla) {
    var valor = sanitizar(atual);
    var t = texto(tecla);

    if (t === 'limpar') return '';

    if (t === 'apagar') return valor.slice(0, -1);

    // O botao mostra "," e escreve "," — o "." do teclado fisico e aceite
    // como sinonimo, mas o que fica no campo e sempre a virgula.
    if (t === SEPARADOR_ECRA || t === '.') {
      if (valor.indexOf(SEPARADOR_ECRA) !== -1) {
        // "0,00" (e afins) valem zero: recomecar em "0," e o que o utilizador
        // espera, em vez de a tecla nao fazer nada.
        return eZero(valor) ? '0' + SEPARADOR_ECRA : valor;
      }
      return (valor === '' ? '0' : valor) + SEPARADOR_ECRA;
    }

    if (!/^[0-9]$/.test(t)) return valor;

    if (eZero(valor)) return t === '0' ? '0' : t;

    var partes = valor.split(SEPARADOR_ECRA);
    if (partes.length > 1 && partes[1].length >= MAX_CASAS_DECIMAIS) return valor;
    if (valor.replace(SEPARADOR_ECRA, '').length >= MAX_DIGITOS) return valor;

    return valor + t;
  }

  return {
    SEPARADOR_ECRA: SEPARADOR_ECRA,
    MAX_CASAS_DECIMAIS: MAX_CASAS_DECIMAIS,
    MAX_DIGITOS: MAX_DIGITOS,
    aplicarTecla: aplicarTecla,
    sanitizar: sanitizar,
    normalizarDecimal: normalizarDecimal,
    paraNumero: paraNumero,
    paraEcra: paraEcra,
    eValido: eValido
  };
});
