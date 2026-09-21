'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 08-importar-ui.js
   Tela Importar: dropzone de upload, resumo da última importação, tela de mapeamento de colunas com pré-visualização.
   ========================================================================= */

/* ------------------------------- Importar ------------------------------- */
function renderImportar() {
  if (state.importDraft) return renderImportMapping();
  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="section-title">Importar planilha do ERP</div>
    <div class="section-sub">Aceita .xlsx, .xls ou .csv — as colunas são mapeadas automaticamente e podem ser ajustadas.</div>
    <div class="dropzone" id="dropzone" data-action="go-file-pick">
      <div class="dz-icon">📄</div>
      <div><strong>Clique para escolher o arquivo</strong> ou arraste aqui</div>
      <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none;">
    </div>
  </div>
  ${state.importInfo ? `<div class="card" style="margin-bottom:16px;">
    <div class="section-title">Última importação</div>
    <table><tbody>
      <tr><td>Arquivo</td><td class="text-right mono">${esc(state.importInfo.fileName)}</td></tr>
      <tr><td>Quando</td><td class="text-right mono">${fmtDT(state.importInfo.importedAt)}</td></tr>
      <tr><td>Itens totais</td><td class="text-right mono">${fmtNum(state.importInfo.total)}</td></tr>
      <tr><td>Novos / atualizados / removidos</td><td class="text-right mono">${fmtNum(state.importInfo.novos)} / ${fmtNum(state.importInfo.atualizados)} / ${fmtNum(state.importInfo.removidos)}</td></tr>
    </tbody></table>
    <p class="section-sub" style="margin-top:10px;margin-bottom:0;">Contagens já registradas são preservadas quando o código do item e o local continuam iguais na nova planilha. Itens avulsos (não cadastrados no ERP) também são mantidos.</p>
  </div>` : ''}
  ${state.items.length ? `<div class="card">
    <div class="section-title">${isServer() ? '🗄 Dados no servidor' : '💾 Dados salvos neste aparelho'}</div>
    <p class="section-sub">${isServer() ? 'Itens, contagens e histórico ficam no servidor e são compartilhados em tempo real com todos os celulares, tablets e o painel do gestor.' : (storageAvailable ? 'A contagem é salva automaticamente neste navegador — se a página for fechada ou recarregada, o progresso continua aqui.' : 'Este navegador não permite salvar dados localmente; a contagem só dura enquanto a aba ficar aberta.')}</p>
    ${state._resetConfirm ? `
      <p class="section-sub" style="color:var(--critical);font-weight:700;">${isServer() ? 'Isso apaga todos os itens, contagens e o histórico do SERVIDOR — para toda a equipe. Confirma?' : 'Isso apaga todos os itens, contagens e o histórico salvos neste aparelho. Confirma?'}</p>
      <div class="row"><button class="btn btn-danger btn-sm" data-action="clear-storage-confirm">Sim, apagar tudo</button><button class="btn btn-ghost btn-sm" data-action="clear-storage-cancel">Cancelar</button></div>
    ` : `<div class="row">${isServer() ? '<button class="btn btn-sm" data-action="baixar-backup">💾 Baixar backup</button>' : ''}<button class="btn btn-sm" data-action="clear-storage">🗑 ${isServer() ? 'Apagar todos os dados do servidor' : 'Limpar dados salvos neste aparelho'}</button></div>`}
  </div>` : ''}`;
}
function renderImportMapping() {
  const d = state.importDraft;
  const preview = d.dataRows.slice(0, 6);
  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="section-title">Mapeamento de colunas</div>
    <div class="section-sub">Arquivo <strong>${esc(d.fileName)}</strong> — ${fmtNum(d.dataRows.length)} linhas de dados detectadas. Confira se cada campo aponta para a coluna correta.</div>
    <div class="map-grid">
      ${FIELD_DEFS.map(f => `
        <div class="map-row">
          <div style="min-width:150px;font-size:.82rem;font-weight:700;">${esc(f.label)}${f.required ? ' *' : ''}</div>
          <span class="arrow">→</span>
          <select data-action="map-field-change" data-field="${f.key}">
            <option value="-1">${f.required ? '— selecione —' : '— nenhuma —'}</option>
            ${d.headers.map((h, i) => `<option value="${i}" ${d.mapping[f.key] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}
          </select>
        </div>`).join('')}
    </div>
    <div class="row" style="margin-top:18px;">
      <button class="btn" data-action="cancel-import-draft">Cancelar</button>
      <button class="btn btn-primary" data-action="confirm-import">Confirmar importação</button>
    </div>
  </div>
  <div class="card">
    <div class="section-title">Pré-visualização</div>
    <div class="section-sub">Primeiras linhas conforme o mapeamento atual</div>
    <div class="table-wrap"><table>
      <thead><tr>${FIELD_DEFS.map(f => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>
      <tbody>${preview.map(row => `<tr>${FIELD_DEFS.map(f => {
        const idx = d.mapping[f.key];
        const val = idx >= 0 ? row[idx] : '';
        return `<td>${esc(val)}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

