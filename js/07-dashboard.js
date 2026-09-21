'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 07-dashboard.js
   Tela Dashboard: KPIs gerais, gráficos de divergência por depósito e por status, card de finalizar contagem.
   ========================================================================= */

/* ------------------------------- Dashboard ------------------------------- */
function renderDashboard() {
  const items = state.items;
  const total = items.length;
  const statuses = items.map(computeItemStatus);
  const contados = statuses.filter((s, i) => isCounted(items[i])).length;
  const divergentes = statuses.filter(isDivergent).length;
  const okCount = statuses.filter(s => s.status === 'ok').length;
  const progresso = total ? (contados / total * 100) : 0;
  const acuracia = contados ? (okCount / contados * 100) : 0;
  const valorDivergente = items.reduce((sum, it, i) => {
    const s = statuses[i];
    if (!isDivergent(s) || s.diff == null) return sum;
    return sum + Math.abs(s.diff) * unitValue(it);
  }, 0);

  // gráfico 1: divergências por armazém (categórico)
  const byArmz = {};
  items.forEach((it, i) => { if (isDivergent(statuses[i])) byArmz[it.armazem] = (byArmz[it.armazem] || 0) + 1; });
  let armzEntries = Object.entries(byArmz).sort((a, b) => b[1] - a[1]);
  let armzTop = armzEntries.slice(0, 5);
  const armzRest = armzEntries.slice(5).reduce((s, e) => s + e[1], 0);
  if (armzRest > 0) armzTop.push(['Outros', armzRest]);
  const armzMax = Math.max(1, ...armzTop.map(e => e[1]));

  // gráfico 2: distribuição por status
  const statusOrder = ['pendente', 'ok', 'sobra', 'falta', 'conflito'];
  const statusCounts = statusOrder.map(k => statuses.filter(s => s.status === k).length);
  const statusMax = Math.max(1, ...statusCounts);

  return `
  ${renderPainelAoVivo()}
  <div class="grid kpi-grid" style="margin-bottom:16px;">
    <div class="kpi"><div class="kpi-label">Itens no ERP</div><div class="kpi-value">${fmtNum(total)}</div><div class="kpi-sub">${state.importInfo ? esc(state.importInfo.fileName) : ''}</div></div>
    <div class="kpi accent"><div class="kpi-label">Itens contados</div><div class="kpi-value">${fmtNum(contados)}</div><div class="kpi-sub">${fmtNum(progresso, 1)}% do estoque</div></div>
    <div class="kpi bad"><div class="kpi-label">Divergências</div><div class="kpi-value">${fmtNum(divergentes)}</div><div class="kpi-sub">${contados ? fmtNum(divergentes / contados * 100, 1) : '0'}% dos contados</div></div>
    <div class="kpi good"><div class="kpi-label">Acurácia</div><div class="kpi-value">${fmtNum(acuracia, 1)}%</div><div class="kpi-sub">contagens que bateram com o ERP</div></div>
    <div class="kpi warn"><div class="kpi-label">Valor divergente</div><div class="kpi-value" style="font-size:1.25rem;">${fmtCur(valorDivergente)}</div><div class="kpi-sub">estimado pelas diferenças</div></div>
  </div>

  <div class="card" style="margin-bottom:16px;">
    <div class="section-title">Progresso geral da contagem</div>
    <div class="progress-track"><div class="progress-fill" data-w="${progresso}" style="width:0%;"></div></div>
    <div class="section-sub" style="margin-top:8px;margin-bottom:0;">${fmtNum(contados)} de ${fmtNum(total)} itens já receberam ao menos uma contagem</div>
  </div>

  <div class="card" style="margin-bottom:16px;">
    <div class="section-title">📧 Finalizar contagem</div>
    <div class="section-sub">Gera um resumo da contagem (KPIs e principais divergências) pronto para enviar por e-mail, e baixa a planilha CSV completa de divergências para anexar na mensagem.</div>
    ${!total ? `<p class="section-sub" style="margin-bottom:0;">Importe a planilha do ERP para poder gerar o relatório.</p>` :
      progresso >= 100
        ? `<p class="section-sub" style="color:var(--good);font-weight:700;margin-bottom:10px;">✓ Contagem 100% concluída — pronta para fechar.</p>`
        : `<p class="section-sub" style="color:var(--warning);font-weight:700;margin-bottom:10px;">Ainda restam ${fmtNum(total - contados)} itens sem contagem. É possível gerar o relatório mesmo assim, com o status parcial.</p>`}
    <button class="btn btn-primary" data-action="finalizar-contagem-email" ${!total ? 'disabled' : ''}>📧 Gerar relatório e abrir e-mail</button>
  </div>

  <div class="grid two-col">
    <div class="card">
      <div class="section-title">Divergências por depósito</div>
      <div class="section-sub">Itens com contagem diferente do saldo do ERP, agrupados por depósito/armazém</div>
      ${armzTop.length ? `<div class="barchart">
        ${armzTop.map((e, i) => `<div class="bar-row">
          <div class="bar-label" title="${esc(e[0])}">${esc(e[0])}</div>
          <div class="bar-track"><div class="bar-fill" data-w="${e[1] / armzMax * 100}" style="width:0%;background:${e[0] === 'Outros' ? 'var(--text-muted)' : CAT_COLORS[i % CAT_COLORS.length]};"></div></div>
          <div class="bar-value">${fmtNum(e[1])}</div>
        </div>`).join('')}
      </div>` : `<p class="section-sub">Nenhuma divergência registrada ainda.</p>`}
    </div>

    <div class="card">
      <div class="section-title">Status da contagem</div>
      <div class="section-sub">Distribuição de todos os itens por situação</div>
      <div class="barchart">
        ${statusOrder.map((k, i) => `<div class="bar-row">
          <div class="bar-label">${STATUS_META[k].icon} ${STATUS_META[k].label}</div>
          <div class="bar-track"><div class="bar-fill" data-w="${statusCounts[i] / statusMax * 100}" style="width:0%;background:var(--${k === 'pendente' ? 'pending' : k === 'ok' ? 'good' : k === 'sobra' ? 'warning' : k === 'falta' ? 'critical' : 'serious'});"></div></div>
          <div class="bar-value">${fmtNum(statusCounts[i])}</div>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

