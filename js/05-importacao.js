'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 05-importacao.js
   Importação da planilha do ERP: leitura do arquivo, detecção automática de colunas, mapeamento e confirmação da importação (com dedução do saldo empenhado).
   ========================================================================= */

/* ------------------------------ Importação ------------------------------ */
function guessMapping(headers) {
  const normHeaders = headers.map(normalize);
  const mapping = {};
  FIELD_DEFS.forEach(f => {
    let found = -1;
    for (const syn of f.synonyms) {
      const nsyn = normalize(syn);
      found = normHeaders.findIndex(h => h === nsyn);
      if (found >= 0) break;
    }
    if (found < 0) {
      for (const syn of f.synonyms) {
        const nsyn = normalize(syn);
        found = normHeaders.findIndex(h => h.includes(nsyn) || nsyn.includes(h));
        if (found >= 0) break;
      }
    }
    mapping[f.key] = found;
  });
  return mapping;
}
function looksLikeHeaderRow(row) {
  const norm = row.map(normalize);
  let hits = 0;
  FIELD_DEFS.forEach(f => { if (f.synonyms.some(syn => norm.includes(normalize(syn)))) hits++; });
  return hits >= 2;
}
function parseFile(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: false });
      const sheetName = wb.SheetNames.find(n => {
        const ws = wb.Sheets[n];
        const rng = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
        return rng.e.r > 0;
      }) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
      if (!rows.length) { toast('A planilha parece estar vazia.', 'err'); return; }

      let headerRowIndex = rows.findIndex(r => looksLikeHeaderRow(r));
      if (headerRowIndex < 0) headerRowIndex = 0;
      const headers = rows[headerRowIndex].map(h => String(h == null ? '' : h).trim() || '(coluna vazia)');
      const dataRows = rows.slice(headerRowIndex + 1);
      const mapping = guessMapping(headers);

      state.importDraft = { fileName: file.name, sheetName, headers, dataRows, mapping };
      render();
      toast('Planilha lida: ' + dataRows.length + ' linhas encontradas. Confira o mapeamento de colunas.', 'ok');
    } catch (err) {
      console.error(err);
      toast('Não foi possível ler o arquivo: ' + err.message, 'err');
    }
  };
  reader.onerror = function () { toast('Falha ao carregar o arquivo.', 'err'); };
  reader.readAsArrayBuffer(file);
}
function confirmImport() {
  const draft = state.importDraft;
  if (!draft) return;
  const map = draft.mapping;
  const missing = FIELD_DEFS.filter(f => f.required && (map[f.key] == null || map[f.key] < 0));
  if (missing.length) { toast('Defina as colunas obrigatórias: ' + missing.map(f => f.label).join(', '), 'err'); return; }

  const headerNormSet = new Set();
  FIELD_DEFS.forEach(f => f.synonyms.forEach(s => headerNormSet.add(normalize(s))));

  const newItems = [];
  const seenIds = new Map();
  draft.dataRows.forEach(row => {
    const rawCodigo = map.codigo >= 0 ? row[map.codigo] : '';
    const codigo = String(rawCodigo == null ? '' : rawCodigo).trim();
    if (!codigo) return;
    if (headerNormSet.has(normalize(codigo))) return; // linha de cabeçalho repetida
    const descricao = map.descricao >= 0 ? String(row[map.descricao] || '').trim() : '(sem descrição)';
    const armazem = map.armazem >= 0 ? (String(row[map.armazem] || '').trim() || 'Depósito único') : 'Depósito único';
    const endereco = map.endereco >= 0 ? String(row[map.endereco] || '').trim() : '';
    const saldoBruto = map.saldo >= 0 ? parseNumberBR(row[map.saldo]) : 0;
    const saldoEmpenhado = map.saldoEmpenhado >= 0 ? parseNumberBR(row[map.saldoEmpenhado]) : 0;
    // o saldo empenhado (reservado para requisição/pedido de venda) é deduzido do saldo atual —
    // a contagem física é comparada contra o saldo realmente disponível, não o saldo bruto.
    const saldo = saldoBruto - saldoEmpenhado;
    const valor = map.valor >= 0 ? parseNumberBR(row[map.valor]) : null;
    const um = map.um >= 0 ? String(row[map.um] || '').trim() : '';
    const grupo = map.grupo >= 0 ? String(row[map.grupo] || '').trim() : '';

    let baseId = codigo + '::' + armazem + '::' + (endereco || '-');
    let finalId = baseId;
    if (seenIds.has(baseId)) {
      const n = seenIds.get(baseId) + 1; seenIds.set(baseId, n); finalId = baseId + '::' + n;
    } else seenIds.set(baseId, 1);

    newItems.push({ id: finalId, codigo, descricao, um, grupo, armazem, endereco, saldo, saldoBruto, saldoEmpenhado, valor });
  });

  if (!newItems.length) { toast('Nenhuma linha válida encontrada para importar.', 'err'); return; }

  // modo servidor: o servidor faz a mesclagem (preservando contagens e avulsos de toda a equipe)
  if (isServer()) {
    toast('Enviando planilha para o servidor...', 'ok');
    acaoImportar(newItems, draft.fileName).then(() => {
      state.importDraft = null;
      state.itensFiltro.page = 1;
      state.tab = 'dashboard';
      toast('Importação concluída: ' + state.items.length + ' itens — já disponível para toda a equipe.', 'ok');
      render();
    }).catch(e => toast('Falha ao importar no servidor: ' + (e.http ? e.message : 'sem conexão.'), 'err'));
    return;
  }

  const oldIds = new Set(state.items.map(i => i.id));
  const newIds = new Set(newItems.map(i => i.id));
  let novos = 0, atualizados = 0;
  newItems.forEach(i => oldIds.has(i.id) ? atualizados++ : novos++);
  const removidos = state.items.filter(i => !newIds.has(i.id)).length;

  // itens avulsos (adicionados manualmente durante a contagem, sem existir no ERP) sobrevivem à reimportação
  const newIdSet = new Set(newItems.map(i => i.id));
  const avulsosPreservados = state.items.filter(i => i.avulso && !newIdSet.has(i.id));
  const finalItems = newItems.concat(avulsosPreservados);

  // preserva contagens de itens cujo id (código+local) se mantém
  const preservedCounts = {};
  finalItems.forEach(i => { if (state.countsIndex[i.id]) preservedCounts[i.id] = state.countsIndex[i.id]; });

  state.items = finalItems;
  state.countsIndex = preservedCounts;
  state.importInfo = { fileName: draft.fileName, importedAt: Date.now(), total: finalItems.length, novos, atualizados, removidos };
  state.importDraft = null;
  state.itensFiltro.page = 1;

  addAudit('importacao', `importou "${state.importInfo.fileName}": ${newItems.length} itens do ERP (${novos} novos, ${atualizados} atualizados, ${removidos} removidos)${avulsosPreservados.length ? ` · ${avulsosPreservados.length} itens avulsos mantidos` : ''}`);
  toast('Importação concluída: ' + finalItems.length + ' itens.', 'ok');
  state.tab = 'dashboard';
  saveStateToStorage();
  render();
}

