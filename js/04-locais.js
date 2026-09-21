'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 04-locais.js
   Locais derivados dos itens: agrupamento de corredores por letra (ex.: "Corredor C" reúne C01, C02, C13...), depósitos e endereços.
   ========================================================================= */

/* --------------------------- Locais derivados --------------------------- */
const NO_CORREDOR = '(sem corredor definido)';
// A contagem acontece por corredor, e o endereço no ERP normalmente é "letra + número"
// (ex.: A01, C23, D34, J051). Para a contagem, agrupamos tudo isso pela LETRA do corredor
// (Corredor A, Corredor C...), para não precisar contar endereço por endereço.
// Endereços que não seguem esse padrão (ex.: "PALETE 13", "DOIS IRMAOS", "GAIOLA") não têm uma
// letra de corredor real, então mantemos o nome como está.
function corridorGroupKey(endereco) {
  const e = (endereco || '').trim().toUpperCase();
  if (!e) return NO_CORREDOR;
  const m = e.match(/^([A-Z])\d/);
  return m ? m[1] : e;
}
function corridorGroupLabel(key) {
  if (key === NO_CORREDOR) return NO_CORREDOR;
  if (/^[A-Z]$/.test(key)) return 'Corredor ' + key;
  return key;
}
function getArmazens() {
  const set = new Map();
  state.items.forEach(it => { if (!set.has(it.armazem)) set.set(it.armazem, []); set.get(it.armazem).push(it); });
  return set; // armazem -> items[]
}
function getEnderecos(armazem) {
  const set = new Set();
  state.items.forEach(it => {
    if (armazem === 'todos' || it.armazem === armazem) set.add(corridorGroupKey(it.endereco));
  });
  const arr = Array.from(set);
  arr.sort((a, b) => {
    if (a === NO_CORREDOR) return 1;
    if (b === NO_CORREDOR) return -1;
    const aLetra = /^[A-Z]$/.test(a), bLetra = /^[A-Z]$/.test(b);
    if (aLetra && bLetra) return a.localeCompare(b);
    if (aLetra !== bLetra) return aLetra ? -1 : 1;
    return a.localeCompare(b);
  });
  return arr;
}
function itemsForLocation(armazem, corredorKey) {
  return state.items.filter(it => {
    if (armazem !== 'todos' && it.armazem !== armazem) return false;
    if (corredorKey === 'todos') return true;
    return corridorGroupKey(it.endereco) === corredorKey;
  });
}
function getCorredores() {
  // agrupa itens por (armazem, letra do corredor) — a unidade real de contagem em campo
  const map = new Map();
  state.items.forEach(it => {
    const corredorKey = corridorGroupKey(it.endereco);
    const key = it.armazem + '␟' + corredorKey;
    if (!map.has(key)) map.set(key, { armazem: it.armazem, endereco: corredorKey, items: [] });
    map.get(key).items.push(it);
  });
  return Array.from(map.values());
}

