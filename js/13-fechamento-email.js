'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 13-fechamento-email.js
   Fechamento da contagem: monta o resumo (KPIs + maiores divergências) e abre o rascunho de e-mail (mailto:) com o CSV de divergências baixado.
   ========================================================================= */

/* --------------------- Fechamento da contagem (e-mail) --------------------- */
// Monta o texto do resumo de fechamento da contagem: KPIs gerais + as maiores divergências.
// Não há backend/servidor de e-mail neste app (é 100% front-end), então o envio de fato é feito
// pelo próprio aplicativo de e-mail do usuário: abrimos um rascunho (mailto:) já com assunto e
// corpo preenchidos, e baixamos separadamente o CSV completo de divergências para ser anexado.
function buildFechamentoRelatorio() {
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
  const statusCounts = {};
  ['ok', 'sobra', 'falta', 'conflito', 'pendente'].forEach(k => { statusCounts[k] = statuses.filter(s => s.status === k).length; });

  const topDivergentes = items.map((it, i) => ({ it, st: statuses[i] }))
    .filter(x => isDivergent(x.st) && x.st.diff != null)
    .map(x => ({ ...x, valorAbs: Math.abs(x.st.diff) * unitValue(x.it) }))
    .sort((a, b) => b.valorAbs - a.valorAbs)
    .slice(0, 10);

  const dataStr = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const subject = 'Fechamento da contagem de inventário — ' + dataStr;

  const linhas = [];
  linhas.push('Resumo da contagem de inventário — ' + dataStr);
  linhas.push('');
  linhas.push('Itens no ERP: ' + fmtNum(total));
  linhas.push('Itens contados: ' + fmtNum(contados) + ' (' + fmtNum(progresso, 1) + '%)');
  linhas.push('Divergências: ' + fmtNum(divergentes) + ' (' + (contados ? fmtNum(divergentes / contados * 100, 1) : '0') + '% dos contados)');
  linhas.push('Acurácia: ' + fmtNum(acuracia, 1) + '%');
  linhas.push('Valor divergente estimado: ' + fmtCur(valorDivergente));
  linhas.push('');
  linhas.push('Por status:');
  linhas.push('- OK (bateu): ' + fmtNum(statusCounts.ok));
  linhas.push('- Sobra: ' + fmtNum(statusCounts.sobra));
  linhas.push('- Falta: ' + fmtNum(statusCounts.falta));
  linhas.push('- Conflito (1ª ≠ 2ª, aguardando 3ª contagem): ' + fmtNum(statusCounts.conflito));
  linhas.push('- Não contado: ' + fmtNum(statusCounts.pendente));
  if (topDivergentes.length) {
    linhas.push('');
    linhas.push('Principais divergências (maior valor estimado):');
    topDivergentes.forEach((x, i) => {
      const local = x.it.armazem + (x.it.endereco ? ' / ' + x.it.endereco : '');
      linhas.push((i + 1) + '. ' + x.it.codigo + ' — ' + x.it.descricao + ' (' + local + '): ERP ' + fmtNum(x.it.saldo) +
        ', contado ' + (x.st.confirmed != null ? fmtNum(x.st.confirmed) : '—') +
        ', diferença ' + (x.st.diff > 0 ? '+' : '') + fmtNum(x.st.diff) + ' (' + fmtCur(x.valorAbs) + ')');
    });
  }
  linhas.push('');
  linhas.push('Relatório completo de todas as divergências em anexo (CSV) — anexe o arquivo baixado ao enviar este e-mail.');
  linhas.push('');
  linhas.push('Gerado automaticamente pelo app Contagem de Inventário.');

  return { subject, body: linhas.join('\n'), total, contados, divergentes };
}
function finalizarContagemEmail() {
  if (!state.items.length) { toast('Importe a planilha do ERP antes de gerar o relatório.', 'err'); return; }
  const rel = buildFechamentoRelatorio();
  exportDivergCSV();
  addAudit('fechamento', 'gerou relatório de fechamento da contagem para envio por e-mail (' + fmtNum(rel.contados) + '/' + fmtNum(rel.total) + ' itens contados, ' + fmtNum(rel.divergentes) + ' divergências)');
  saveStateToStorage();
  const mailtoUrl = 'mailto:?subject=' + encodeURIComponent(rel.subject) + '&body=' + encodeURIComponent(rel.body);
  window.location.href = mailtoUrl;
  toast('CSV de divergências baixado. Seu aplicativo de e-mail deve abrir com o resumo pronto — anexe o CSV antes de enviar.', 'ok');
}

