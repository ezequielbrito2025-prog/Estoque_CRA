'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 03-regras-negocio.js
   Regras de negócio da contagem: cálculo de status/divergência, contagem cega, arbitragem na 3ª contagem, registro de contagens e itens avulsos.
   ========================================================================= */

/* --------------------------- Regras de negócio --------------------------- */
function computeItemStatus(item) {
  const idx = state.countsIndex[item.id];
  if (!idx || !idx[1]) return { status: 'pendente', confirmed: null, diff: null, needsRecount: false, idx: idx || {} };

  if (!idx[2]) {
    const diff = idx[1].qtd - item.saldo;
    const status = diff === 0 ? 'ok' : (diff > 0 ? 'sobra' : 'falta');
    return { status, confirmed: diff === 0 ? idx[1].qtd : null, diff, needsRecount: diff !== 0, idx };
  }
  if (idx[1].qtd === idx[2].qtd) {
    const confirmed = idx[1].qtd;
    const diff = confirmed - item.saldo;
    const status = diff === 0 ? 'ok' : (diff > 0 ? 'sobra' : 'falta');
    return { status, confirmed, diff, needsRecount: false, idx };
  }
  if (idx[3]) {
    const confirmed = idx[3].qtd;
    const diff = confirmed - item.saldo;
    const status = diff === 0 ? 'ok' : (diff > 0 ? 'sobra' : 'falta');
    return { status, confirmed, diff, needsRecount: false, idx, arbitrated: true };
  }
  return { status: 'conflito', confirmed: null, diff: null, needsRecount: true, idx };
}
function isCounted(item) { const idx = state.countsIndex[item.id]; return !!(idx && idx[1]); }
function isDivergent(st) { return st.status === 'sobra' || st.status === 'falta' || st.status === 'conflito'; }
function unitValue(item) { return item.saldo > 0 && item.valor != null ? item.valor / item.saldo : 0; }

function nextCountNumber(item) {
  const idx = state.countsIndex[item.id];
  if (!idx || !idx[1]) return 1;
  if (!idx[2]) return 2;
  if (idx[1].qtd !== idx[2].qtd && !idx[3]) return 3;
  return null; // finalizado
}
function registerCount(item, numero, qtd) {
  if (!state.countsIndex[item.id]) state.countsIndex[item.id] = {};
  state.countsIndex[item.id][numero] = { qtd, usuario: state.currentUser.name, timestamp: Date.now() };
  const local = item.armazem + (item.endereco ? ' / ' + item.endereco : '');
  addAudit('contagem', `registrou a ${numero}ª contagem de "${item.codigo} — ${item.descricao}" (${local}): ${fmtNum(qtd)} ${item.um || ''}`.trim());
  saveStateToStorage();
}
function resetItemCounts(item) {
  delete state.countsIndex[item.id];
  addAudit('recontagem', `reiniciou a contagem de "${item.codigo} — ${item.descricao}" (nova rodada)`);
  saveStateToStorage();
}
function addAvulsoItem(codigo, descricao, um, armazem, endereco, qtd) {
  const dupe = state.items.find(i => normalize(i.codigo) === normalize(codigo) && i.armazem === armazem && (i.endereco || '') === (endereco || ''));
  if (dupe) return { ok: false, error: 'Já existe um item com esse código neste corredor. Use o campo de quantidade dele na lista.' };
  const item = {
    id: uid('avulso'), codigo: codigo.trim(), descricao: descricao.trim() || '(sem descrição)',
    um: (um || '').trim(), grupo: '', armazem, endereco: endereco || '', saldo: 0, valor: 0, avulso: true,
  };
  state.items.push(item);
  registerCount(item, 1, qtd);
  addAudit('item-avulso', `adicionou item não cadastrado no ERP: "${item.codigo} — ${item.descricao}" (${armazem}${endereco ? ' / ' + endereco : ''})`);
  saveStateToStorage();
  return { ok: true, item };
}

