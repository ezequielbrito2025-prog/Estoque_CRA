'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 02-utils.js
   Funções utilitárias genéricas: normalização de texto, parsing de número BR, formatação (número/moeda/data), escape de HTML, toast, log de auditoria, exportação CSV.
   ========================================================================= */

/* ------------------------------- Utils ---------------------------------- */
function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}
function parseNumberBR(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (s.includes(',') && !s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function fmtNum(n, dec) {
  dec = dec == null ? 0 : dec;
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtCur(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDT(ts) {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}
function toast(msg, type) {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, 3000);
}
function addAudit(tipo, texto) {
  const entry = {
    id: uid('log') + '_' + Date.now().toString(36), timestamp: Date.now(),
    usuario: state.currentUser ? state.currentUser.name : 'Sistema',
    tipo, texto,
  };
  state.auditLog.unshift(entry);
  // no modo servidor, o registro também vai para o histórico compartilhado
  if (typeof enviarAuditoriaServidor === 'function') enviarAuditoriaServidor(entry);
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

