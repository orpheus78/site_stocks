'use strict';

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

module.exports = { round2, eur, num, hojeISO, diasAtrasISO, dataHoraPT, boolCampo };