'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 11-itens-diverg-auditoria.js
   Telas Itens, Divergências e Auditoria: tabelas derivadas do estado, com filtros, paginação e exportação.
   ========================================================================= */

/* --------------------------------- Itens --------------------------------- */
function renderItens() {
  const f = state.itensFiltro;
  const armzMap = getArmazens();
  const armazens = Array.from(armzMap.keys()).sort();

  let filtered = state.items.map(it => ({ it, st: computeItemStatus(it) }));
  if (f.status !== 'todos') filtered = filtered.filter(x => x.st.status === f.status);
  if (f.armazem !== 'todos') filtered = filtered.filter(x => x.it.armazem === f.armazem);
  if (f.busca.trim()) {
    const q = normalize(f.busca);
    filtered = filtered.filter(x => normalize(x.it.codigo).includes(q) || normalize(x.it.descricao).includes(q));
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / f.pageSize));
  if (f.page > totalPages) f.page = totalPages;
  const pageItems = filtered.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);

  const statusChips = ['todos', 'pendente', 'ok', 'sobra', 'falta', 'conflito'];

  return `
  <div class="card" style="margin-bottom:14px;">
    <div class="row">
      <div class="field" style="flex:2;min-width:220px;">
        <label>Buscar</label>
        <input type="search" id="itensBusca" placeholder="Código ou descrição" value="${esc(f.busca)}">
      </div>
      <div class="field">
        <label>Depósito</label>
        <select data-action="itens-filter-armazem">
          <option value="todos">Todos</option>
          ${armazens.map(a => `<option value="${esc(a)}" ${f.armazem === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
      <button class="btn" data-action="itens-export-csv">⬇ Exportar CSV</button>
    </div>
    <div class="filters-bar">
      ${statusChips.map(s => `<button class="chip ${f.status === s ? 'active' : ''}" data-action="itens-filter-status" data-status="${s}">${s === 'todos' ? 'Todos' : STATUS_META[s].icon + ' ' + STATUS_META[s].label}</button>`).join('')}
    </div>
  </div>

  <div class="table-wrap"><table>
    <thead><tr>
      <th>Código</th><th>Descrição</th><th>Depósito</th><th>Local</th>
      <th class="text-right">Saldo ERP</th><th class="text-right">Confirmado</th><th class="text-right">Diferença</th><th>Status</th>
    </tr></thead>
    <tbody>
      ${pageItems.map(({ it, st }) => `<tr>
        <td class="mono">${esc(it.codigo)}${it.avulso ? ' <span class="badge badge-sobra">avulso</span>' : ''}</td>
        <td>${esc(it.descricao)}</td>
        <td>${esc(it.armazem)}</td>
        <td>${esc(it.endereco || '—')}</td>
        <td class="text-right mono">${fmtNum(it.saldo)} ${esc(it.um || '')}${it.saldoEmpenhado ? `<div class="section-sub" style="margin:2px 0 0;font-size:.72rem;">bruto ${fmtNum(it.saldoBruto)} − empenhado ${fmtNum(it.saldoEmpenhado)}</div>` : ''}</td>
        <td class="text-right mono">${st.confirmed != null ? fmtNum(st.confirmed) : '—'}</td>
        <td class="text-right mono" style="color:${st.diff > 0 ? 'var(--warning)' : st.diff < 0 ? 'var(--critical)' : 'inherit'};">${st.diff != null ? (st.diff > 0 ? '+' : '') + fmtNum(st.diff) : '—'}</td>
        <td><span class="badge badge-${STATUS_META[st.status].cls}">${STATUS_META[st.status].icon} ${STATUS_META[st.status].label}</span></td>
      </tr>`).join('') || `<tr><td colspan="8" class="empty-state">Nenhum item encontrado com esses filtros.</td></tr>`}
    </tbody>
  </table></div>
  <div class="row" style="justify-content:space-between;margin-top:12px;">
    <span class="section-sub" style="margin:0;">${fmtNum(filtered.length)} itens encontrados</span>
    <div class="row" style="width:auto;">
      <button class="btn btn-sm" data-action="itens-page-prev" ${f.page <= 1 ? 'disabled' : ''}>← anterior</button>
      <span class="section-sub" style="margin:0;align-self:center;">página ${f.page} de ${totalPages}</span>
      <button class="btn btn-sm" data-action="itens-page-next" ${f.page >= totalPages ? 'disabled' : ''}>próxima →</button>
    </div>
  </div>`;
}

/* ----------------------------- Divergências ------------------------------ */
function renderDivergencias() {
  const f = state.divergFiltro;
  const armzMap = getArmazens();
  const armazens = Array.from(armzMap.keys()).sort();

  let rows = state.items.map(it => ({ it, st: computeItemStatus(it) })).filter(x => isDivergent(x.st));
  if (f.armazem !== 'todos') rows = rows.filter(x => x.it.armazem === f.armazem);
  if (f.busca.trim()) {
    const q = normalize(f.busca);
    rows = rows.filter(x => normalize(x.it.codigo).includes(q) || normalize(x.it.descricao).includes(q));
  }
  rows.sort((a, b) => Math.abs((b.st.diff || 0) * unitValue(b.it)) - Math.abs((a.st.diff || 0) * unitValue(a.it)));

  const aguardando = rows.filter(x => x.st.needsRecount).length;
  const confirmadas = rows.length - aguardando;
  const valorTotal = rows.reduce((s, x) => s + Math.abs(x.st.diff || 0) * unitValue(x.it), 0);

  return `
  <div class="grid kpi-grid" style="margin-bottom:14px;">
    <div class="kpi bad"><div class="kpi-label">Total de divergências</div><div class="kpi-value">${fmtNum(rows.length)}</div></div>
    <div class="kpi warn"><div class="kpi-label">Aguardando recontagem</div><div class="kpi-value">${fmtNum(aguardando)}</div></div>
    <div class="kpi good"><div class="kpi-label">Confirmadas</div><div class="kpi-value">${fmtNum(confirmadas)}</div></div>
    <div class="kpi"><div class="kpi-label">Valor total divergente</div><div class="kpi-value" style="font-size:1.2rem;">${fmtCur(valorTotal)}</div></div>
  </div>

  <div class="card" style="margin-bottom:14px;">
    <div class="row">
      <div class="field" style="flex:2;min-width:220px;">
        <label>Buscar</label>
        <input type="search" id="divergBusca" placeholder="Código ou descrição" value="${esc(f.busca)}">
      </div>
      <div class="field">
        <label>Depósito</label>
        <select data-action="diverg-filter-armazem">
          <option value="todos">Todos</option>
          ${armazens.map(a => `<option value="${esc(a)}" ${f.armazem === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
      <button class="btn" data-action="diverg-export-csv">⬇ Exportar CSV</button>
    </div>
  </div>

  <div class="table-wrap"><table>
    <thead><tr>
      <th>Código</th><th>Descrição</th><th>Local</th><th class="text-right">Saldo ERP</th>
      <th class="text-right">1ª</th><th class="text-right">2ª</th><th class="text-right">3ª</th>
      <th class="text-right">Diferença</th><th class="text-right">Valor (R$)</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>
      ${rows.map(({ it, st }) => `<tr>
        <td class="mono">${esc(it.codigo)}${it.avulso ? ' <span class="badge badge-sobra">avulso</span>' : ''}</td>
        <td>${esc(it.descricao)}</td>
        <td>${esc(it.armazem)}${it.endereco ? ' / ' + esc(it.endereco) : ''}</td>
        <td class="text-right mono">${fmtNum(it.saldo)}</td>
        <td class="text-right mono">${st.idx[1] ? fmtNum(st.idx[1].qtd) : '—'}</td>
        <td class="text-right mono">${st.idx[2] ? fmtNum(st.idx[2].qtd) : '—'}</td>
        <td class="text-right mono">${st.idx[3] ? fmtNum(st.idx[3].qtd) : '—'}</td>
        <td class="text-right mono" style="color:${st.diff > 0 ? 'var(--warning)' : 'var(--critical)'};">${st.diff != null ? (st.diff > 0 ? '+' : '') + fmtNum(st.diff) : '—'}</td>
        <td class="text-right mono">${fmtCur(Math.abs(st.diff || 0) * unitValue(it))}</td>
        <td><span class="badge badge-${STATUS_META[st.status].cls}">${STATUS_META[st.status].icon} ${STATUS_META[st.status].label}</span></td>
        <td><button class="btn btn-sm" data-action="diverg-goto-count" data-armazem="${esc(it.armazem)}" data-endereco="${esc(it.endereco || NO_CORREDOR)}" data-item-id="${esc(it.id)}">Recontar</button></td>
      </tr>`).join('') || `<tr><td colspan="11" class="empty-state">Nenhuma divergência encontrada. 🎉</td></tr>`}
    </tbody>
  </table></div>`;
}

/* ------------------------------- Auditoria -------------------------------- */
function renderAuditoria() {
  const f = state.auditFiltro;
  const usuarios = Array.from(new Set(state.auditLog.map(l => l.usuario))).sort();
  let logs = state.auditLog;
  if (f.usuario !== 'todos') logs = logs.filter(l => l.usuario === f.usuario);
  if (f.busca.trim()) { const q = normalize(f.busca); logs = logs.filter(l => normalize(l.texto).includes(q)); }

  return `
  <div class="card" style="margin-bottom:14px;">
    <div class="row">
      <div class="field" style="flex:2;min-width:220px;">
        <label>Buscar no histórico</label>
        <input type="search" id="auditBusca" placeholder="ex.: código do item, depósito..." value="${esc(f.busca)}">
      </div>
      <div class="field">
        <label>Usuário</label>
        <select data-action="audit-filter-usuario">
          <option value="todos">Todos</option>
          ${usuarios.map(u => `<option value="${esc(u)}" ${f.usuario === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="section-title">Trilha de auditoria</div>
    <div class="section-sub">${fmtNum(logs.length)} eventos registrados nesta sessão</div>
    ${logs.length ? logs.map(l => `<div class="audit-item">
        <div class="audit-dot"></div>
        <div style="flex:1;">
          <div class="audit-what"><span class="audit-who">${esc(l.usuario)}</span> ${esc(l.texto)}</div>
          <div class="audit-when">${fmtDT(l.timestamp)}</div>
        </div>
      </div>`).join('') : '<p class="section-sub">Nenhum evento ainda.</p>'}
  </div>`;
}

