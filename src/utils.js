'use strict';

// O MESMO modulo de decimais que corre no browser (public/js/valor-decimal.js,
// UMD). Reutilizado de proposito: a conversao "0,40" -> "0.40" existe num
// unico sitio, ja testado, em vez de haver uma segunda regra so para o servidor.
const ValorDecimal = require('../public/js/valor-decimal');

/** Arredonda a 2 casas (dinheiro). Evita erros de virgula flutuante em somas. */
function round2(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function eur(valor) {
  return `${round2(valor).toFixed(2)} €`;
}

function num(valor, fallback = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : fallback;
}

/** Data local YYYY-MM-DD (nao usar toISOString: converte para UTC). */
function hojeISO(data = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

function diasAtrasISO(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return hojeISO(d);
}

function dataHoraPT(valor) {
  if (!valor) return '';
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Interpreta checkboxes/valores de formulario HTML ('on', '1', 'true'). */
function boolCampo(valor, fallback = false) {
  if (valor === undefined || valor === null || valor === '') return fallback;
  return ['1', 'on', 'true', 'sim', 'yes'].includes(String(valor).toLowerCase());
}

// --------------------------------------------------------------- decimais pt-PT

/**
 * Sanitizador de ENTRADA para campos de dinheiro vindos de formularios.
 *
 * Em Portugal escreve-se "0,40" e `Number('0,40')` e NaN. Converte a virgula
 * em ponto quando o valor e um decimal valido e nao-negativo; caso contrario
 * devolve o valor INTACTO, para que o express-validator (isFloat) o recuse em
 * vez de o transformar em silencio. Sem isto, lixo e negativos passariam a
 * string vazia e seriam gravados como 0.
 *
 *   '0,40' -> '0.40'   '0.40' -> '0.40'   '20,' -> '20'
 *   'abc'  -> 'abc'    '-5'   -> '-5'     ''    -> ''
 */
function decimalEntrada(valor) {
  if (typeof valor !== 'string') return valor;
  const normalizado = ValorDecimal.normalizarDecimal(valor);
  return normalizado === '' ? valor : normalizado;
}

// ----------------------------------------------------------------- margem bruta

/**
 * Margem BRUTA: diferenca entre o que se cobra e o que custou comprar, com a
 * percentagem calculada SOBRE O PRECO DE VENDA.
 *
 * Serve tanto para um artigo (preco/custo unitarios) como para um periodo
 * inteiro (totais) — e a mesma conta, e ter uma so implementacao evita que os
 * relatorios e a listagem de artigos divirjam.
 *
 * `percentagem` e `null` quando nao ha base de calculo (venda <= 0): a divisao
 * por zero daria NaN/Infinity no ecra. As views mostram '-' (ver pctMargem).
 * A margem PODE ser negativa (custo acima do preco): isso e um problema real
 * do negocio e tem de ficar visivel, nao escondido.
 */
function calcularMargem(venda, custo) {
  const v = round2(num(venda, 0));
  const c = round2(num(custo, 0));
  const margem = round2(v - c);
  return {
    venda: v,
    custo: c,
    margem,
    percentagem: v > 0 ? round2((margem / v) * 100) : null
  };
}

/** Formata a percentagem de margem para as views ('—' quando nao ha base). */
function pctMargem(percentagem) {
  if (percentagem === null || percentagem === undefined || !Number.isFinite(percentagem)) return '—';
  return `${percentagem.toFixed(1)} %`;
}

module.exports = {
  round2,
  eur,
  num,
  hojeISO,
  diasAtrasISO,
  dataHoraPT,
  boolCampo,
  decimalEntrada,
  calcularMargem,
  pctMargem
};