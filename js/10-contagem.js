'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 10-contagem.js
   Tela Contagem: busca global por código, seleção de corredor, lista de contagem por endereço específico, item avulso e commit de cada contagem.
   ========================================================================= */

/* ------------------------------- Contagem -------------------------------- */
function renderBuscaGlobalCard() {
  const c = state.contagem;
  const q = c.buscaGlobal.trim();
  let resultsHtml = '';
  if (q) {
    const nq = normalize(q);
    const results = state.items.filter(it => normalize(it.codigo).includes(nq) || normalize(it.descricao).includes(nq)).slice(0, 8);
    resultsHtml = results.length ? `<div class="count-list" style="margin-top:10px;">
      ${results.map(it => {
        const st = computeItemStatus(it);
        return `<div class="count-row" style="cursor:pointer;" data-action="busca-global-goto" data-item-id="${esc(it.id)}">
          <div class="cr-info">
            <div class="cr-code">${esc(it.codigo)}${it.avulso ? ' <span class="badge badge-sobra" style="margin-left:4px;">avulso</span>' : ''}</div>
            <div class="cr-desc">${esc(it.descricao)}</div>
            <div class="section-sub" style="margin:2px 0 0;">${esc(it.armazem)}${it.endereco ? ' · ' + esc(it.endereco) : ''}</div>
          </div>
          <span class="badge badge-${STATUS_META[st.status].cls}">${STATUS_META[st.status].icon} ${STATUS_META[st.status].label}</span>
        </div>`;
      }).join('')}
    </div>` : `<p class="section-sub" style="margin-top:8px;margin-bottom:0;">Nenhum item encontrado com esse código ou descrição.</p>`;
  }
  return `
  <div class="card" style="margin-bottom:14px;">
    <div class="section-title">🔎 Buscar item por código</div>
    <div class="section-sub">Já sabe o código? Digite aqui para ir direto ao item, em qualquer depósito ou corredor.</div>
    <input type="search" id="buscaGlobalInput" placeholder="Código ou descrição do item" value="${esc(c.buscaGlobal)}">
    ${resultsHtml}
  </div>`;
}

function renderContagem() {
  const c = state.contagem;
  const armzMap = getArmazens();
  const armazens = Array.from(armzMap.keys()).sort();
  const enderecos = getEnderecos(c.armazem);

  const buscaGlobalCard = renderBuscaGlobalCard();

  const controls = `
  <div class="card" style="margin-bottom:14px;">
    <div class="section-title">📍 Selecione o corredor</div>
    <div class="section-sub">A contagem acontece por corredor: escolha o depósito e o corredor para ver a lista de itens esperados ali. Não é necessário digitar ou bipar código.</div>
    <div class="row">
      <div class="field">
        <label>Depósito</label>
        <select data-action="contagem-set-armazem">
          <option value="todos" ${c.armazem === 'todos' ? 'selected' : ''}>Todos os depósitos</option>
          ${armazens.map(a => `<option value="${esc(a)}" ${c.armazem === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Corredor / Endereço</label>
        <select data-action="contagem-set-endereco">
          <option value="">— selecione um corredor —</option>
          ${enderecos.map(en => `<option value="${esc(en)}" ${c.endereco === en ? 'selected' : ''}>${esc(corridorGroupLabel(en))}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>`;

  if (!c.endereco) {
    return buscaGlobalCard + controls + (draftCount() ? sendBarHTML() : '') + `<div class="card empty-state">
      <div class="es-icon">📍</div>
      <h3 style="margin:0 0 6px;">Nenhum corredor selecionado</h3>
      <p style="margin:0;">Escolha um corredor acima — ou use a aba <strong>Locais</strong> para localizar corredores com pendências — para ver a lista de itens a contar.</p>
    </div>`;
  }

  const scopeItems = itemsForLocation(c.armazem, c.endereco);
  let list = scopeItems;
  if (c.busca.trim()) {
    const q = normalize(c.busca);
    list = list.filter(it => normalize(it.codigo).includes(q) || normalize(it.descricao).includes(q));
  }
  list = list.slice().sort((a, b) => {
    const an = nextCountNumber(a) === null ? 1 : 0;
    const bn = nextCountNumber(b) === null ? 1 : 0;
    if (an !== bn) return an - bn;
    // dentro do corredor (que pode juntar vários endereços, ex.: C01, C02, C13...),
    // ordena pelo endereço específico primeiro, para dar pra andar em sequência física
    return (a.endereco || '').localeCompare(b.endereco || '') || a.codigo.localeCompare(b.codigo);
  });

  const contadosScope = scopeItems.filter(isCounted).length;
  const pct = scopeItems.length ? (contadosScope / scopeItems.length * 100) : 0;

  const avulsoCard = `
  <div class="card" style="margin-top:14px;">
    ${c.avulsoAberto ? `
      <div class="section-title">➕ Adicionar item não cadastrado</div>
      <div class="section-sub">Encontrou um item na contagem física que não está nesta lista? Cadastre-o aqui — ele entra na contagem e aparece em Divergências para ser conferido e incluído no ERP depois.</div>
      <div class="row">
        <div class="field"><label>Código</label><input type="text" id="avulsoCodigo" placeholder="Código do item"></div>
        <div class="field" style="flex:2;min-width:200px;"><label>Descrição</label><input type="text" id="avulsoDescricao" placeholder="Descrição"></div>
      </div>
      <div class="row">
        <div class="field"><label>Unidade (opcional)</label><input type="text" id="avulsoUm" placeholder="UN, PC, KG..."></div>
        <div class="field"><label>Quantidade contada</label><input type="number" id="avulsoQtd" min="0" step="1" placeholder="Qtd"></div>
      </div>
      <div class="field" style="margin-bottom:10px;">
        <label>Endereço específico (opcional)</label>
        <input type="text" id="avulsoEndereco" placeholder="Ex.: ${esc(/^[A-Z]$/.test(c.endereco) ? c.endereco + '13' : c.endereco)}" value="${/^[A-Z]$/.test(c.endereco) ? '' : esc(c.endereco === NO_CORREDOR ? '' : c.endereco)}">
      </div>
      <div class="section-sub" style="margin-bottom:10px;">Local: <strong>${esc(c.armazem)} · ${esc(corridorGroupLabel(c.endereco))}</strong></div>
      <div class="row">
        <button class="btn btn-primary btn-sm" data-action="contagem-avulso-submit">Adicionar à contagem</button>
        <button class="btn btn-ghost btn-sm" data-action="contagem-avulso-cancel">Cancelar</button>
      </div>
    ` : `<button class="btn btn-block" data-action="contagem-avulso-open">➕ Apareceu um item que não está nesta lista? Adicionar item não cadastrado</button>`}
  </div>`;

  return buscaGlobalCard + controls + `
  <div class="card" style="margin-bottom:12px;" id="corredorHeader">
    <div class="row" style="align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div><strong>${esc(c.armazem)} · ${esc(corridorGroupLabel(c.endereco))}</strong><div class="section-sub" id="corredorContadosLabel" style="margin:2px 0 0;">${fmtNum(contadosScope)} de ${fmtNum(scopeItems.length)} itens contados</div></div>
      <div style="min-width:140px;flex:1;max-width:220px;"><div class="progress-track"><div class="progress-fill" id="corredorProgressFill" data-w="${pct}" style="width:0%;"></div></div></div>
    </div>
    <div class="blind-note"><span>🙈</span><span>Contagem cega: o saldo do sistema e as contagens anteriores não aparecem aqui, para não influenciar o resultado. Digite apenas o que você contou fisicamente — os números ficam guardados no aparelho até você tocar em <strong>Enviar contagem</strong>, lá embaixo.</span></div>
  </div>
  <div class="field" style="margin-bottom:10px;">
    <input type="search" id="contagemBusca" placeholder="Filtrar itens deste corredor por código ou descrição (opcional)" value="${esc(c.busca)}">
  </div>
  <div class="count-list" id="countList">
    ${list.length ? list.map(it => countRowHTML(it)).join('') : '<p class="section-sub">Nenhum item encontrado com esse filtro.</p>'}
  </div>
  ${sendBarHTML()}
  ${avulsoCard}`;
}

// navega até um item específico na tela de Contagem (usado pela busca global e por "Recontar" em Divergências)
function jumpToItemInContagem(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  state.contagem.armazem = item.armazem;
  state.contagem.endereco = corridorGroupKey(item.endereco);
  state.contagem.busca = '';
  state.contagem.buscaGlobal = '';
  state.contagem.highlightItemId = item.id;
  state.tab = 'contagem';
  render();
  const row = document.querySelector(`[data-item-id="${cssEsc(item.id)}"]`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = row.querySelector('.cr-qty-input');
    if (input) input.focus();
  }
}

function countRowHTML(item) {
  const c = state.contagem;
  const idx = state.countsIndex[item.id] || {};
  const numero = nextCountNumber(item);
  const st = computeItemStatus(item);
  const hl = c.highlightItemId === item.id ? ' row-highlight' : '';

  // dentro de um corredor agrupado por letra (ex.: Corredor C), mostra o endereço específico
  // de cada item (ex.: C13) para saber exatamente onde procurar fisicamente
  const enderecoTag = item.endereco ? `<span class="badge badge-pending" style="margin-left:4px;">${esc(item.endereco)}</span>` : '';

  if (c.pendingRestartId === item.id) {
    return `<div class="count-row count-row-confirm${hl}" data-item-id="${esc(item.id)}">
      <div class="cr-info"><div class="cr-code">${esc(item.codigo)}${enderecoTag}</div><div class="cr-desc">${esc(item.descricao)}</div></div>
      <div class="cr-confirm-actions">
        <span class="cr-confirm-text">Apagar contagens e reiniciar?</span>
        <button class="btn btn-sm btn-danger" data-action="contagem-confirm-restart" data-id="${esc(item.id)}">Sim</button>
        <button class="btn btn-sm btn-ghost" data-action="contagem-cancel-restart" data-id="${esc(item.id)}">Não</button>
      </div>
    </div>`;
  }

  if (numero === null) {
    return `<div class="count-row count-row-done${hl}" data-item-id="${esc(item.id)}">
      <div class="cr-info"><div class="cr-code">${esc(item.codigo)}${enderecoTag}</div><div class="cr-desc">${esc(item.descricao)}</div></div>
      <span class="badge badge-${STATUS_META[st.status].cls}">${STATUS_META[st.status].icon} ${STATUS_META[st.status].label}</span>
      <button class="btn btn-ghost btn-sm" data-action="contagem-restart-item" data-id="${esc(item.id)}">recontar</button>
    </div>`;
  }

  const naFila = isServer() && sync.queue.find(q => q.itemId === item.id);
  if (naFila) {
    return `<div class="count-row count-row-queued${hl}" data-item-id="${esc(item.id)}">
      <div class="cr-info"><div class="cr-code">${esc(item.codigo)}${enderecoTag}</div><div class="cr-desc">${esc(item.descricao)}</div></div>
      <span class="badge badge-pending">⏳ ${fmtNum(naFila.qtd)} ${esc(item.um || '')} · aguardando conexão</span>
    </div>`;
  }

  const draftVal = (c.rascunho && c.rascunho[item.id] != null) ? c.rascunho[item.id] : '';
  const showConflict = numero === 3 && idx[1] && idx[2];
  return `<div class="count-row${hl}${draftVal !== '' ? ' has-draft' : ''}" data-item-id="${esc(item.id)}">
    <div class="cr-info">
      <div class="cr-code">${esc(item.codigo)}${enderecoTag} <span class="badge badge-pending" style="margin-left:4px;">${numero}ª contagem</span></div>
      <div class="cr-desc">${esc(item.descricao)}</div>
      ${showConflict ? `<div class="cr-conflict">⚠ 1ª: ${fmtNum(idx[1].qtd)} · 2ª: ${fmtNum(idx[2].qtd)} — informe a contagem de arbitragem</div>` : ''}
    </div>
    <div class="cr-qty-wrap">
      <input type="text" class="cr-qty-input" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="Qtd" value="${esc(draftVal)}" data-item-id="${esc(item.id)}" data-numero="${numero}">
      <span class="cr-um">${esc(item.um || '')}</span>
    </div>
  </div>`;
}

// Enter / "Próximo" no teclado do celular: só avança para o próximo campo.
// A contagem é gravada no rascunho a cada tecla e enviada pelo botão "Enviar contagem".
function focusNextCountInput(inputEl) {
  setDraftFromInput(inputEl);
  const list = document.getElementById('countList');
  const inputs = list ? Array.from(list.querySelectorAll('.cr-qty-input')) : [];
  const pos = inputs.indexOf(inputEl);
  const next = inputs[pos + 1];
  if (next) { next.focus(); if (next.select) next.select(); next.closest('.count-row').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else { inputEl.blur(); const bar = document.getElementById('sendBar'); if (bar) bar.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

