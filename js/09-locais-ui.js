'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 09-locais-ui.js
   Tela Locais: tabela de corredores (já agrupados por letra) com progresso, busca e paginação.
   ========================================================================= */

/* -------------------------------- Locais -------------------------------- */
function renderLocais() {
  const f = state.locaisFiltro;
  const armzMap = getArmazens();
  const armazens = Array.from(armzMap.keys()).sort();

  const allCorredores = getCorredores().map(c => {
    const contados = c.items.filter(isCounted).length;
    const divergentes = c.items.filter(it => isDivergent(computeItemStatus(it))).length;
    return { ...c, total: c.items.length, contados, pendentes: c.items.length - contados, divergentes, pct: c.items.length ? (contados / c.items.length * 100) : 0 };
  });

  let corredores = allCorredores;
  if (f.armazem !== 'todos') corredores = corredores.filter(c => c.armazem === f.armazem);
  if (f.busca.trim()) {
    const q = normalize(f.busca);
    // busca pelo grupo (ex.: "Corredor C") mas também por qualquer endereço específico dentro
    // dele (ex.: digitar "C13" encontra o grupo "Corredor C", já que C13 está agrupado ali)
    corredores = corredores.filter(c =>
      normalize(c.armazem).includes(q) ||
      normalize(c.endereco).includes(q) ||
      normalize(corridorGroupLabel(c.endereco)).includes(q) ||
      c.items.some(it => normalize(it.endereco).includes(q) || normalize(it.codigo).includes(q)));
  }
  corredores = corredores.slice().sort((a, b) => b.pendentes - a.pendentes || a.armazem.localeCompare(b.armazem) || a.endereco.localeCompare(b.endereco));

  const totalPages = Math.max(1, Math.ceil(corredores.length / f.pageSize));
  if (f.page > totalPages) f.page = totalPages;
  const pageRows = corredores.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  const corredoresPendentes = allCorredores.filter(c => c.pendentes > 0).length;

  return `
  <div class="grid kpi-grid" style="margin-bottom:14px;">
    <div class="kpi"><div class="kpi-label">Depósitos</div><div class="kpi-value">${fmtNum(armazens.length)}</div></div>
    <div class="kpi"><div class="kpi-label">Corredores</div><div class="kpi-value">${fmtNum(allCorredores.length)}</div></div>
    <div class="kpi accent"><div class="kpi-label">Corredores com pendências</div><div class="kpi-value">${fmtNum(corredoresPendentes)}</div></div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <div class="section-title">A contagem é feita por corredor</div>
    <div class="section-sub">Encontre o corredor e clique em "Contar" para ver a lista de itens esperados ali — sem precisar digitar código de cada item.</div>
    <div class="row">
      <div class="field" style="flex:2;min-width:220px;">
        <label>Buscar</label>
        <input type="search" id="locaisBusca" placeholder="Depósito ou corredor" value="${esc(f.busca)}">
      </div>
      <div class="field">
        <label>Depósito</label>
        <select data-action="locais-filter-armazem">
          <option value="todos">Todos</option>
          ${armazens.map(a => `<option value="${esc(a)}" ${f.armazem === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>

  <div class="table-wrap"><table>
    <thead><tr>
      <th>Depósito</th><th>Corredor</th><th class="text-right">Itens</th><th class="text-right">Contados</th>
      <th class="text-right">Pendentes</th><th>Progresso</th><th></th>
    </tr></thead>
    <tbody>
      ${pageRows.map(c => `<tr>
        <td>${esc(c.armazem)}</td>
        <td><strong>${esc(corridorGroupLabel(c.endereco))}</strong>${c.divergentes ? ` <span class="badge badge-falta" style="margin-left:6px;">${c.divergentes} diverg.</span>` : ''}</td>
        <td class="text-right mono">${fmtNum(c.total)}</td>
        <td class="text-right mono">${fmtNum(c.contados)}</td>
        <td class="text-right mono">${fmtNum(c.pendentes)}</td>
        <td style="min-width:120px;"><div class="progress-track"><div class="progress-fill" data-w="${c.pct}" style="width:0%;"></div></div></td>
        <td><button class="btn btn-primary btn-sm" data-action="locais-goto-count" data-armazem="${esc(c.armazem)}" data-endereco="${esc(c.endereco)}">Contar</button></td>
      </tr>`).join('') || `<tr><td colspan="7" class="empty-state">Nenhum corredor encontrado com esses filtros.</td></tr>`}
    </tbody>
  </table></div>
  <div class="row" style="justify-content:space-between;margin-top:12px;">
    <span class="section-sub" style="margin:0;">${fmtNum(corredores.length)} corredores encontrados</span>
    <div class="row" style="width:auto;">
      <button class="btn btn-sm" data-action="locais-page-prev" ${f.page <= 1 ? 'disabled' : ''}>← anterior</button>
      <span class="section-sub" style="margin:0;align-self:center;">página ${f.page} de ${totalPages}</span>
      <button class="btn btn-sm" data-action="locais-page-next" ${f.page >= totalPages ? 'disabled' : ''}>próxima →</button>
    </div>
  </div>`;
}

