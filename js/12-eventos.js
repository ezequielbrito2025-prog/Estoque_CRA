'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 12-eventos.js
   Delegação de eventos (click/change/input/keydown) de toda a aplicação, e as funções de exportação CSV usadas por elas.
   ========================================================================= */

/* =========================================================================
   EVENTOS (delegação)
   ========================================================================= */
function wireDynamic() {
  // barras/progresso animadas
  requestAnimationFrame(() => {
    document.querySelectorAll('[data-w]').forEach(el => {
      const w = parseFloat(el.getAttribute('data-w')) || 0;
      el.style.width = Math.max(0, Math.min(100, w)) + '%';
    });
  });
  // ao abrir a lista de um corredor, foca automaticamente o primeiro campo de quantidade pendente
  if (state.tab === 'contagem' && state.contagem.endereco && !state.contagem.highlightItemId) {
    const firstInput = document.querySelector('#countList .cr-qty-input');
    if (firstInput) firstInput.focus();
  }
}

document.addEventListener('click', function (e) {
  const t = e.target.closest('[data-action]');
  if (!t) {
    if (e.target.closest('#dropzone')) document.getElementById('fileInput').click();
    return;
  }
  const action = t.getAttribute('data-action');
  switch (action) {
    case 'login-pick-profile':
      state._loginPerfil = t.getAttribute('data-perfil');
      { const se = document.getElementById('loginSenha'); const v = se ? se.value : ''; render();
        const ne = document.getElementById('loginSenha'); if (ne) ne.value = v; }
      break;
    case 'login-submit': {
      const nameEl = document.getElementById('loginName');
      const name = (nameEl ? nameEl.value : '').trim();
      if (!name) { toast('Digite seu nome para continuar.', 'err'); return; }
      const perfil = state._loginPerfil || 'operador';
      if (storageAvailable) { try { window.localStorage.setItem(STORAGE_USER_KEY, name); } catch (e) { /* ignore */ } }
      if (isServer()) {
        const senhaEl = document.getElementById('loginSenha');
        const senha = senhaEl ? senhaEl.value : '';
        if (sync.auth && !senha) { toast('Digite a senha.', 'err'); if (senhaEl) senhaEl.focus(); return; }
        t.disabled = true; t.textContent = 'Entrando...';
        loginServidor(name, perfil, senha).then(() => {
          connectLive();
          render();
          if (sync.queue.length) flushQueue();
        }).catch(err => {
          t.disabled = false; t.textContent = 'Entrar';
          toast(err.http ? err.message : 'Sem conexão com o servidor. Verifique a internet/Wi-Fi.', 'err');
          const se = document.getElementById('loginSenha'); if (se && err.status === 401) { se.value = ''; se.focus(); }
        });
        break;
      }
      state.currentUser = { name, perfil };
      state.screen = 'app';
      state.tab = perfil === 'gestor' ? 'dashboard' : (state.items.length ? 'contagem' : 'importar');
      addAudit('login', 'entrou no sistema como ' + (perfil === 'gestor' ? 'Gestor do portal' : 'Operador de coletor'));
      render();
      break;
    }
    case 'logout':
      if (isServer() && sync.queue.length) {
        toast(sync.queue.length + ' contagem(ns) ainda aguardam conexão. Elas serão enviadas quando alguém entrar de novo neste aparelho.', 'err');
      }
      disconnectLive();
      logoutServidor();
      state.screen = 'login'; state.currentUser = null; render(); break;
    case 'switch-tab':
      state.tab = t.getAttribute('data-tab'); render(); break;
    case 'go-file-pick':
      document.getElementById('fileInput').click(); break;
    case 'cancel-import-draft':
      state.importDraft = null; render(); break;
    case 'confirm-import':
      confirmImport(); break;
    case 'locais-goto-count':
      state.contagem.armazem = t.getAttribute('data-armazem');
      state.contagem.endereco = t.getAttribute('data-endereco');
      state.contagem.busca = '';
      state.tab = 'contagem'; render(); break;
    case 'contagem-restart-item':
      state.contagem.pendingRestartId = t.getAttribute('data-id');
      renderCountListSoft(); break;
    case 'contagem-cancel-restart':
      state.contagem.pendingRestartId = null;
      renderCountListSoft(); break;
    case 'contagem-confirm-restart': {
      const item = state.items.find(i => i.id === t.getAttribute('data-id'));
      state.contagem.pendingRestartId = null;
      if (!item) { renderCountListSoft(); break; }
      acaoRecontar(item).then(() => { renderCountListSoft(); updateCorredorHeader(); });
      break;
    }
    case 'contagem-enviar':
      enviarContagem(); break;
    case 'contagem-limpar-rascunho':
      if (!t.classList.contains('confirm')) {
        t.classList.add('confirm'); t.textContent = 'Toque de novo para apagar';
        setTimeout(() => { if (t.isConnected) { t.classList.remove('confirm'); t.textContent = 'Limpar'; } }, 3000);
        break;
      }
      t.classList.remove('confirm'); t.textContent = 'Limpar';
      state.contagem.rascunho = {}; saveDraft();
      renderCountListSoft(); updateSendBar();
      toast('Quantidades digitadas foram apagadas.', 'ok');
      break;
    case 'itens-filter-status':
      state.itensFiltro.status = t.getAttribute('data-status'); state.itensFiltro.page = 1; render(); break;
    case 'itens-page-prev':
      state.itensFiltro.page = Math.max(1, state.itensFiltro.page - 1); render(); break;
    case 'itens-page-next':
      state.itensFiltro.page += 1; render(); break;
    case 'itens-export-csv':
      exportItensCSV(); break;
    case 'diverg-export-csv':
      exportDivergCSV(); break;
    case 'finalizar-contagem-email':
      finalizarContagemEmail(); render(); break;
    case 'locais-page-prev':
      state.locaisFiltro.page = Math.max(1, state.locaisFiltro.page - 1); render(); break;
    case 'locais-page-next':
      state.locaisFiltro.page += 1; render(); break;
    case 'diverg-goto-count':
      jumpToItemInContagem(t.getAttribute('data-item-id')); break;
    case 'busca-global-goto':
      jumpToItemInContagem(t.getAttribute('data-item-id')); break;
    case 'contagem-avulso-open':
      state.contagem.avulsoAberto = true; render(); break;
    case 'contagem-avulso-cancel':
      state.contagem.avulsoAberto = false; render(); break;
    case 'contagem-avulso-submit': {
      const codigo = (document.getElementById('avulsoCodigo') || {}).value || '';
      const descricao = (document.getElementById('avulsoDescricao') || {}).value || '';
      const um = (document.getElementById('avulsoUm') || {}).value || '';
      const qtdRaw = (document.getElementById('avulsoQtd') || {}).value || '';
      const enderecoEspecifico = (document.getElementById('avulsoEndereco') || {}).value || '';
      if (!codigo.trim()) { toast('Digite o código do item.', 'err'); break; }
      if (qtdRaw.trim() === '') { toast('Digite a quantidade contada.', 'err'); break; }
      const qtd = parseFloat(String(qtdRaw).replace(',', '.'));
      if (isNaN(qtd) || qtd < 0) { toast('Quantidade inválida.', 'err'); break; }
      // usa o endereço específico digitado (ex.: "C13"), ou cai para a letra do corredor selecionado
      const fallback = state.contagem.endereco === NO_CORREDOR ? '' : state.contagem.endereco;
      const enderecoVal = enderecoEspecifico.trim() || fallback;
      t.disabled = true;
      Promise.resolve(acaoAvulso(codigo, descricao, um, state.contagem.armazem, enderecoVal, qtd)).then(result => {
        t.disabled = false;
        if (!result.ok) { toast(result.error, 'err'); return; }
        state.contagem.avulsoAberto = false;
        toast('Item avulso adicionado e contado.', 'ok');
        render();
      });
      break;
    }
    case 'baixar-backup':
      baixarBackup(); break;
    case 'clear-storage':
      state._resetConfirm = true; render(); break;
    case 'clear-storage-cancel':
      state._resetConfirm = false; render(); break;
    case 'clear-storage-confirm':
      state._resetConfirm = false;
      if (isServer()) {
        acaoLimparTudo().then(() => { toast('Todos os dados do servidor foram apagados.', 'ok'); state.tab = 'importar'; render(); })
          .catch(e => toast('Não foi possível apagar: ' + (e.http ? e.message : 'sem conexão.'), 'err'));
        break;
      }
      state.items = []; state.countsIndex = {}; state.auditLog = []; state.importInfo = null;
      state.contagem.rascunho = {}; saveDraft();
      clearStoredState();
      toast('Dados salvos neste aparelho foram apagados.', 'ok');
      state.tab = 'importar';
      render();
      break;
    default: break;
  }
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.id === 'itensBusca') return; // handled by input
  const action = el.getAttribute && el.getAttribute('data-action');
  if (action === 'map-field-change') {
    const field = el.getAttribute('data-field');
    state.importDraft.mapping[field] = parseInt(el.value, 10);
    render();
  } else if (action === 'contagem-set-armazem') {
    state.contagem.armazem = el.value; state.contagem.endereco = ''; render();
  } else if (action === 'contagem-set-endereco') {
    state.contagem.endereco = el.value; render();
  } else if (action === 'itens-filter-armazem') {
    state.itensFiltro.armazem = el.value; state.itensFiltro.page = 1; render();
  } else if (action === 'diverg-filter-armazem') {
    state.divergFiltro.armazem = el.value; render();
  } else if (action === 'locais-filter-armazem') {
    state.locaisFiltro.armazem = el.value; state.locaisFiltro.page = 1; render();
  } else if (action === 'audit-filter-usuario') {
    state.auditFiltro.usuario = el.value; render();
  } else if (el.id === 'fileInput' && el.files && el.files[0]) {
    parseFile(el.files[0]);
  }
});

document.addEventListener('input', function (e) {
  const el = e.target;
  if (el.id === 'itensBusca') { state.itensFiltro.busca = el.value; state.itensFiltro.page = 1; softRenderTable(); }
  else if (el.id === 'divergBusca') { state.divergFiltro.busca = el.value; softRenderTable(); }
  else if (el.id === 'auditBusca') { state.auditFiltro.busca = el.value; softRenderTable(); }
  else if (el.id === 'locaisBusca') { state.locaisFiltro.busca = el.value; state.locaisFiltro.page = 1; softRenderTable(); }
  else if (el.id === 'contagemBusca') { state.contagem.busca = el.value; softRenderTable(); }
  else if (el.id === 'buscaGlobalInput') { state.contagem.buscaGlobal = el.value; softRenderTable(); }
  else if (el.id === 'loginName') { state._loginName = el.value; }
  else if (el.classList && el.classList.contains('cr-qty-input')) { el.classList.remove('invalid'); setDraftFromInput(el); }
});
// garante o rascunho também quando o teclado do celular fecha sem disparar "input" (alguns Android)
document.addEventListener('change', function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('cr-qty-input')) setDraftFromInput(e.target);
}, true);
document.addEventListener('focusout', function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('cr-qty-input')) setDraftFromInput(e.target);
});
// re-render mantendo o foco no campo de busca durante digitação
function softRenderTable() {
  const active = document.activeElement;
  const id = active ? active.id : null;
  const selStart = active && 'selectionStart' in active ? active.selectionStart : null;
  render();
  if (id) {
    const el = document.getElementById(id);
    if (el) { el.focus(); if (selStart != null && el.setSelectionRange) el.setSelectionRange(selStart, selStart); }
  }
}
// re-renderiza só a lista de contagem (mantém a posição de leitura ao confirmar/cancelar recontagem)
function renderCountListSoft() {
  const list = document.getElementById('countList');
  if (!list) { render(); return; }
  const scopeItems = itemsForLocation(state.contagem.armazem, state.contagem.endereco);
  let visible = scopeItems;
  if (state.contagem.busca.trim()) {
    const q = normalize(state.contagem.busca);
    visible = visible.filter(it => normalize(it.codigo).includes(q) || normalize(it.descricao).includes(q));
  }
  visible = visible.slice().sort((a, b) => {
    const an = nextCountNumber(a) === null ? 1 : 0;
    const bn = nextCountNumber(b) === null ? 1 : 0;
    if (an !== bn) return an - bn;
    return (a.endereco || '').localeCompare(b.endereco || '') || a.codigo.localeCompare(b.codigo);
  });
  list.innerHTML = visible.length ? visible.map(it => countRowHTML(it)).join('') : '<p class="section-sub">Nenhum item encontrado com esse filtro.</p>';
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target && (e.target.id === 'loginSenha' || e.target.id === 'loginName')) {
    const btn = document.getElementById('loginBtn'); if (btn && !btn.disabled) { e.preventDefault(); btn.click(); } return;
  }
  if ((e.key === 'Enter' || e.keyCode === 13) && e.target && e.target.classList && e.target.classList.contains('cr-qty-input')) {
    e.preventDefault();
    focusNextCountInput(e.target);
  }
});

function exportItensCSV() {
  const rows = [['Codigo', 'Descricao', 'Deposito', 'Local', 'Saldo ERP', 'Confirmado', 'Diferenca', 'Status']];
  state.items.forEach(it => {
    const st = computeItemStatus(it);
    rows.push([it.codigo, it.descricao, it.armazem, it.endereco || '', it.saldo, st.confirmed != null ? st.confirmed : '', st.diff != null ? st.diff : '', STATUS_META[st.status].label]);
  });
  downloadCSV('itens_estoque.csv', rows);
}
function exportDivergCSV() {
  const rows = [['Codigo', 'Descricao', 'Deposito', 'Local', 'Saldo ERP', '1a contagem', '2a contagem', '3a contagem', 'Diferenca', 'Valor divergente', 'Status']];
  state.items.forEach(it => {
    const st = computeItemStatus(it);
    if (!isDivergent(st)) return;
    rows.push([it.codigo, it.descricao, it.armazem, it.endereco || '', it.saldo,
      st.idx[1] ? st.idx[1].qtd : '', st.idx[2] ? st.idx[2].qtd : '', st.idx[3] ? st.idx[3].qtd : '',
      st.diff != null ? st.diff : '', (Math.abs(st.diff || 0) * unitValue(it)).toFixed(2), STATUS_META[st.status].label]);
  });
  downloadCSV('divergencias_estoque.csv', rows);
}

