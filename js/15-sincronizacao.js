'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 15-sincronizacao.js
   Sincronização em tempo real com o servidor central (server.js):
   - modo "servidor": todos os aparelhos compartilham itens/contagens; cada
     alteração chega aos demais na hora (Server-Sent Events)
   - modo "local": app aberto sem servidor (ex.: arquivo aberto direto) —
     funciona como antes, salvando só neste aparelho
   - fila de envio: contagens enviadas sem conexão ficam guardadas no aparelho
     e são reenviadas automaticamente quando a rede volta
   ========================================================================= */

const QUEUE_KEY = 'contagem_inventario_fila_envio_v1';
const DRAFT_KEY = 'contagem_inventario_rascunho_v1';
const MODE_KEY = 'contagem_inventario_modo_v1';
const SESSION_KEY = 'contagem_inventario_sessao_v1';

const sync = {
  mode: 'local',         // 'servidor' | 'local'
  auth: false,           // servidor exige senha
  senhaGestorSeparada: false,
  token: null,
  online: false,         // conexão em tempo real ativa
  version: 0,
  es: null,              // EventSource
  presenca: [],
  queue: [],             // [{cid, itemId, numero, qtd, usuario, ts}]
  flushing: false,
  retryTimer: null,
};

/* ------------------------- persistência auxiliar ------------------------- */
function lsGet(key, fallback) {
  if (!storageAvailable) return fallback;
  try { const r = window.localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch (e) { return fallback; }
}
function lsSet(key, val) {
  if (!storageAvailable) return;
  try { window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
}
function saveQueue() { lsSet(QUEUE_KEY, sync.queue); }
function saveDraft() { lsSet(DRAFT_KEY, state.contagem.rascunho); }
function newCid() { return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); }

/* --------------------------------- API ---------------------------------- */
async function api(method, url, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, {
      method, signal: ctrl.signal, cache: 'no-store',
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, sync.token ? { 'Authorization': 'Bearer ' + sync.token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* sem json */ }
    if (!r.ok) {
      const err = new Error((data && data.erro) || ('Erro ' + r.status)); err.status = r.status; err.http = true;
      if (r.status === 401 && data && data.sessao) sessaoExpirada();
      throw err;
    }
    return data;
  } finally { clearTimeout(t); }
}
function isServer() { return sync.mode === 'servidor'; }

/* ------------------------------ Inicialização ----------------------------- */
async function syncInit() {
  sync.queue = lsGet(QUEUE_KEY, []);
  state.contagem.rascunho = lsGet(DRAFT_KEY, {}) || {};
  if (location.protocol === 'file:') { sync.mode = 'local'; return; }
  const sessao = lsGet(SESSION_KEY, null);
  try {
    const cfg = await api('GET', '/api/config', null, 6000);
    sync.mode = 'servidor'; sync.auth = !!cfg.auth; sync.senhaGestorSeparada = !!cfg.senhaGestorSeparada;
    lsSet(MODE_KEY, 'servidor');
  } catch (e) {
    if (e.http && e.status === 404) { sync.mode = 'local'; lsSet(MODE_KEY, 'local'); return; }
    // sem rede agora, mas este aparelho já trabalhou com o servidor: continua com o que está salvo
    if (lsGet(MODE_KEY, null) === 'servidor') {
      sync.mode = 'servidor';
      if (sessao) entrarComSessao(sessao);
      scheduleRetry();
    } else sync.mode = 'local';
    return;
  }
  // já tinha entrado neste aparelho: entra direto, sem pedir a senha de novo
  if (sessao && sessao.token) {
    sync.token = sessao.token;
    try {
      const data = await api('GET', '/api/state', null, 20000);
      applyFullState(data);
      entrarComSessao(sessao);
    } catch (e) {
      if (!e.http) { entrarComSessao(sessao); scheduleRetry(); }   // sem rede: segue com os dados salvos
      else { sync.token = null; lsSet(SESSION_KEY, null); }        // sessão inválida: pede login
    }
  }
}
function entrarComSessao(sessao) {
  sync.token = sessao.token;
  state.currentUser = { name: sessao.nome, perfil: sessao.perfil };
  state.screen = 'app';
  state.tab = sessao.perfil === 'gestor' ? 'dashboard' : 'contagem';
}
// login pelo servidor (valida a senha e recebe um token de sessão)
async function loginServidor(nome, perfil, senha) {
  const d = await api('POST', '/api/login', { nome, perfil, senha: senha || '' });
  const sessao = { token: d.token, nome: d.nome, perfil: d.perfil };
  lsSet(SESSION_KEY, sessao);
  sync.token = d.token;
  const data = await api('GET', '/api/state', null, 30000);
  applyFullState(data);
  entrarComSessao(sessao);
}
function logoutServidor() {
  if (isServer() && sync.token) api('POST', '/api/logout', {}).catch(() => {});
  sync.token = null;
  lsSet(SESSION_KEY, null);
}
let _expirandoSessao = false;
function sessaoExpirada() {
  if (_expirandoSessao) return;
  _expirandoSessao = true;
  disconnectLive();
  sync.token = null; lsSet(SESSION_KEY, null);
  state.screen = 'login'; state.currentUser = null;
  render();
  toast('Sua sessão expirou (ou a senha foi trocada). Entre novamente — as contagens não enviadas continuam guardadas.', 'err');
  setTimeout(() => { _expirandoSessao = false; }, 2000);
}

function applyFullState(data) {
  state.items = data.items || [];
  state.countsIndex = data.countsIndex || {};
  state.auditLog = data.auditLog || [];
  state.importInfo = data.importInfo || null;
  sync.version = data.version || 0;
  if (data.presenca) sync.presenca = data.presenca;
  saveStateToStorage();
}
async function refetchState() {
  const data = await api('GET', '/api/state', null, 20000);
  applyFullState(data);
  liveRefresh(null, true);
}

/* --------------------------- Conexão em tempo real --------------------------- */
function connectLive() {
  if (!isServer() || !state.currentUser || typeof EventSource === 'undefined') return;
  disconnectLive();
  if (!sync.token) return;
  const u = '/api/events?token=' + encodeURIComponent(sync.token);
  const es = new EventSource(u);
  sync.es = es;
  es.addEventListener('hello', ev => {
    const d = JSON.parse(ev.data);
    sync.online = true;
    updateSyncBadge();
    // ao (re)conectar, garante que está com a versão mais recente e envia o que ficou na fila
    if (d.version !== sync.version) refetchState().catch(() => {});
    flushQueue();
  });
  es.addEventListener('patch', ev => applyPatch(JSON.parse(ev.data)));
  es.addEventListener('reload', () => { refetchState().catch(() => {}); });
  es.addEventListener('presenca', ev => {
    sync.presenca = JSON.parse(ev.data);
    liveRefresh(null, false, true);
  });
  es.onerror = () => {
    sync.online = false; updateSyncBadge();
    // o EventSource não mostra o motivo do erro; confere se foi a sessão que caiu
    api('GET', '/api/config', null, 5000).then(() => api('POST', '/api/auditoria', {}, 5000)).catch(() => {});
  };
}
function disconnectLive() {
  if (sync.es) { try { sync.es.close(); } catch (e) { /* ignore */ } }
  sync.es = null; sync.online = false;
}

function applyPatch(p) {
  const changed = new Set();
  if (p.items) p.items.forEach(it => {
    if (!state.items.some(i => i.id === it.id)) state.items.push(it);
    changed.add(it.id);
  });
  if (p.counts) Object.keys(p.counts).forEach(id => {
    if (p.counts[id]) state.countsIndex[id] = p.counts[id]; else delete state.countsIndex[id];
    changed.add(id);
  });
  if (p.audit) mergeAudit(p.audit);
  if (p.version) sync.version = Math.max(sync.version, p.version);
  saveStateToStorageSoon();
  liveRefresh(changed, !!(p.items && p.items.length));
}
function mergeAudit(entries) {
  const ids = new Set(state.auditLog.slice(0, 500).map(l => l.id));
  const novos = entries.filter(e => !ids.has(e.id));
  if (novos.length) state.auditLog = novos.concat(state.auditLog).sort((a, b) => b.timestamp - a.timestamp);
}
let _saveSoonTimer = null;
function saveStateToStorageSoon() { clearTimeout(_saveSoonTimer); _saveSoonTimer = setTimeout(saveStateToStorage, 1500); }

/* -------------------- Atualização da tela sem atrapalhar quem digita -------------------- */
let _liveTimer = null, _liveChanged = new Set(), _liveStructural = false;
function liveRefresh(changedIds, structural, presenceOnly) {
  if (changedIds) changedIds.forEach(id => _liveChanged.add(id));
  if (structural) _liveStructural = true;
  if (presenceOnly && state.tab !== 'dashboard') return;
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(runLiveRefresh, 250);
}
function runLiveRefresh() {
  const changed = _liveChanged; const structural = _liveStructural;
  _liveChanged = new Set(); _liveStructural = false;
  if (state.screen !== 'app') return;
  updateSyncBadge();
  if (state.importDraft || state.tab === 'importar') return; // não atrapalha a importação em andamento

  if (state.tab === 'contagem' && state.contagem.endereco && document.getElementById('countList')) {
    liveUpdateContagem(changed, structural);
    return;
  }
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.type !== 'button';
  if (typing && !active.id) { _liveChanged = changed; setTimeout(() => liveRefresh(null, structural), 1500); return; }
  const y = window.scrollY;
  if (typing) softRenderTable(); else render();
  window.scrollTo(0, y);
}
// Na tela de contagem só troca as linhas que mudaram — nunca a linha onde a pessoa está digitando
function liveUpdateContagem(changed, structural) {
  const list = document.getElementById('countList');
  const active = document.activeElement;
  const focusInList = active && list.contains(active);
  if (structural && !focusInList) {
    const y = window.scrollY; renderCountListSoft(); updateCorredorHeader(); updateSendBar(); window.scrollTo(0, y); return;
  }
  const pendentes = new Set();
  changed.forEach(id => {
    const row = list.querySelector(`.count-row[data-item-id="${cssEsc(id)}"]`);
    if (!row) return;
    if (row.contains(active)) { pendentes.add(id); return; }
    const item = state.items.find(i => i.id === id);
    if (item) row.outerHTML = countRowHTML(item);
  });
  updateCorredorHeader();
  updateSendBar();
  if (pendentes.size || (structural && focusInList)) {
    // atualiza a linha em uso quando a pessoa sair do campo
    const retry = () => liveRefresh(pendentes, structural && focusInList);
    if (active) active.addEventListener('blur', retry, { once: true }); else setTimeout(retry, 1000);
  }
}
function updateCorredorHeader() {
  const scopeItems = itemsForLocation(state.contagem.armazem, state.contagem.endereco);
  const contados = scopeItems.filter(isCounted).length;
  const pct = scopeItems.length ? (contados / scopeItems.length * 100) : 0;
  const label = document.getElementById('corredorContadosLabel');
  const fill = document.getElementById('corredorProgressFill');
  if (label) label.textContent = fmtNum(contados) + ' de ' + fmtNum(scopeItems.length) + ' itens contados';
  if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

/* ----------------------------- Indicador na barra ----------------------------- */
function syncBadgeHTML() {
  const fila = sync.queue.length;
  if (!isServer()) return `<span class="sync-badge sync-local" id="syncBadge" title="Sem servidor: dados salvos só neste aparelho">💾 Só neste aparelho</span>`;
  if (sync.online) return `<span class="sync-badge sync-on" id="syncBadge" title="Conectado — alterações chegam em tempo real"><i></i>Ao vivo${fila ? ' · ' + fila + ' na fila' : ''}</span>`;
  return `<span class="sync-badge sync-off" id="syncBadge" title="Sem conexão com o servidor — as contagens ficam guardadas e serão enviadas quando a rede voltar"><i></i>Sem conexão${fila ? ' · ' + fila + ' aguardando' : ''}</span>`;
}
function updateSyncBadge() {
  const el = document.getElementById('syncBadge');
  if (el) el.outerHTML = syncBadgeHTML();
}

/* ------------------------------ Fila de envio ------------------------------ */
function scheduleRetry() {
  clearTimeout(sync.retryTimer);
  sync.retryTimer = setTimeout(() => {
    if (!isServer()) return;
    if (!sync.version || !sync.es) refetchState().then(() => { if (state.currentUser && !sync.es) connectLive(); }).catch(scheduleRetry);
    if (sync.queue.length) flushQueue(); 
  }, 5000);
}
async function flushQueue() {
  if (!isServer() || sync.flushing || !sync.queue.length) return null;
  sync.flushing = true;
  const lote = sync.queue.slice(0, 1000);
  try {
    const data = await api('POST', '/api/contagens', { entries: lote });
    const resp = new Set(data.resultados.map(r => r.cid));
    sync.queue = sync.queue.filter(e => !resp.has(e.cid));
    saveQueue();
    if (data.counts) applyPatch({ counts: data.counts, version: data.version });
    sync.flushing = false;
    updateSyncBadge();
    if (sync.queue.length) flushQueue();
    return data.resultados;
  } catch (e) {
    sync.flushing = false;
    sync.online = sync.online && !!e.http;
    updateSyncBadge();
    scheduleRetry();
    return null;
  }
}
window.addEventListener('online', () => { if (isServer()) flushQueue(); });

/* ------------------------ Rascunho + botão Enviar contagem ------------------------ */
function draftCount() { return Object.keys(state.contagem.rascunho || {}).length; }
function queuedIds() { return new Set(sync.queue.map(q => q.itemId)); }

function sendBarInfoHTML() {
  const n = draftCount();
  const fila = isServer() ? sync.queue.length : 0;
  return `${n ? `<strong>${fmtNum(n)} ${n === 1 ? 'item contado' : 'itens contados'}</strong> aguardando envio`
              : `<span>Digite as quantidades acima e envie tudo de uma vez.</span>`}
      ${fila ? `<div class="send-bar-queue">⏳ ${fmtNum(fila)} já enviados aguardando conexão</div>` : ''}`;
}
function sendBarHTML() {
  const n = draftCount();
  return `<div class="send-bar ${n ? 'has-items' : ''}" id="sendBar">
    <div class="send-bar-info" id="sendBarInfo">${sendBarInfoHTML()}</div>
    <div class="send-bar-actions">
      <button class="btn btn-ghost btn-sm" data-action="contagem-limpar-rascunho" id="sendBarClear" ${n ? '' : 'hidden'}>Limpar</button>
      <button class="btn btn-primary btn-send" data-action="contagem-enviar" id="sendBarBtn" ${n ? '' : 'disabled'}>📤 Enviar contagem${n ? ' (' + fmtNum(n) + ')' : ''}</button>
    </div>
  </div>`;
}
// atualiza a barra SEM recriar os botões — senão o toque no botão se perde quando o
// campo de quantidade perde o foco no mesmo instante (comum no celular)
function updateSendBar() {
  const bar = document.getElementById('sendBar');
  if (!bar) return;
  const n = draftCount();
  bar.classList.toggle('has-items', !!n);
  document.getElementById('sendBarInfo').innerHTML = sendBarInfoHTML();
  const btn = document.getElementById('sendBarBtn');
  if (!btn.classList.contains('sending')) {
    btn.disabled = !n;
    btn.textContent = '📤 Enviar contagem' + (n ? ' (' + fmtNum(n) + ')' : '');
  }
  document.getElementById('sendBarClear').hidden = !n;
}
function setDraftFromInput(inputEl) {
  const id = inputEl.getAttribute('data-item-id');
  const v = inputEl.value.trim();
  if (v === '') delete state.contagem.rascunho[id]; else state.contagem.rascunho[id] = v;
  const row = inputEl.closest('.count-row');
  if (row) row.classList.toggle('has-draft', v !== '');
  saveDraft();
  updateSendBar();
}

async function enviarContagem() {
  const draft = state.contagem.rascunho || {};
  const ids = Object.keys(draft);
  if (!ids.length) { toast('Nenhuma quantidade digitada para enviar.', 'err'); return; }

  const entries = []; const invalidos = []; let finalizados = 0;
  ids.forEach(id => {
    const item = state.items.find(i => i.id === id);
    if (!item) { delete draft[id]; return; }
    const qtd = parseFloat(String(draft[id]).replace(',', '.'));
    if (isNaN(qtd) || qtd < 0) { invalidos.push(item); return; }
    const numero = nextCountNumber(item);
    if (numero === null) { finalizados++; delete draft[id]; return; }
    entries.push({ cid: newCid(), itemId: id, numero, qtd, item });
  });
  if (invalidos.length) {
    toast(invalidos.length + ' quantidade(s) inválida(s) — corrija os campos em vermelho.', 'err');
    invalidos.forEach(it => {
      const inp = document.querySelector(`.cr-qty-input[data-item-id="${cssEsc(it.id)}"]`);
      if (inp) inp.classList.add('invalid');
    });
    return;
  }
  if (!entries.length) { saveDraft(); updateSendBar(); if (finalizados) toast('Esses itens já estavam finalizados.', 'err'); return; }

  const btn = document.getElementById('sendBarBtn');
  if (btn) { btn.disabled = true; btn.classList.add('sending'); btn.textContent = 'Enviando...'; }

  if (!isServer()) {
    entries.forEach(e => { registerCount(e.item, e.numero, e.qtd); delete draft[e.itemId]; });
    saveDraft();
    toast(`✓ ${entries.length} contage${entries.length === 1 ? 'm salva' : 'ns salvas'} neste aparelho.`, 'ok');
    afterSendRender();
    return;
  }

  const usuario = state.currentUser.name;
  entries.forEach(e => {
    sync.queue.push({ cid: e.cid, itemId: e.itemId, numero: e.numero, qtd: e.qtd, usuario, ts: Date.now() });
    delete draft[e.itemId];
  });
  saveQueue(); saveDraft();
  const resultados = await flushQueue();
  if (!resultados) {
    toast(`Sem conexão: ${entries.length} contagem(ns) guardada(s) no aparelho. Serão enviadas automaticamente quando a rede voltar.`, 'err');
  } else {
    const ok = resultados.filter(r => r.status === 'ok' || r.status === 'duplicado').length;
    const ren = resultados.filter(r => r.status === 'renumerado').length;
    const fin = resultados.filter(r => r.status === 'finalizado').length;
    const inex = resultados.filter(r => r.status === 'item-inexistente').length;
    let msg = `✓ ${ok + ren} contage${ok + ren === 1 ? 'm enviada' : 'ns enviadas'}.`;
    if (ren) msg += ` ${ren} já tinha(m) sido contado(s) por outra pessoa e entrou(aram) como próxima contagem.`;
    if (fin) msg += ` ${fin} já estava(m) finalizado(s) e foi(ram) ignorado(s).`;
    if (inex) msg += ` ${inex} não existe(m) mais na planilha.`;
    toast(msg, fin || inex ? 'err' : 'ok');
  }
  afterSendRender();
}
function afterSendRender() {
  const btn = document.getElementById('sendBarBtn');
  if (btn) btn.classList.remove('sending');
  const y = window.scrollY;
  state.contagem.highlightItemId = null;
  if (document.getElementById('countList')) { renderCountListSoft(); updateCorredorHeader(); updateSendBar(); updateSyncBadge(); }
  else render();
  window.scrollTo(0, y);
}

/* ---------------------- Ações que passam pelo servidor ---------------------- */
async function acaoRecontar(item) {
  if (!isServer()) { resetItemCounts(item); return true; }
  try { await api('POST', '/api/recontar', { usuario: state.currentUser.name, itemId: item.id }); delete state.countsIndex[item.id]; return true; }
  catch (e) { toast('Não foi possível reiniciar: ' + (e.http ? e.message : 'sem conexão com o servidor.'), 'err'); return false; }
}
async function acaoAvulso(codigo, descricao, um, armazem, endereco, qtd) {
  if (!isServer()) return addAvulsoItem(codigo, descricao, um, armazem, endereco, qtd);
  try {
    const d = await api('POST', '/api/avulso', { usuario: state.currentUser.name, item: { codigo, descricao, um, armazem, endereco }, qtd });
    applyPatch({ items: [d.item], counts: { [d.item.id]: { 1: { qtd, usuario: state.currentUser.name, timestamp: Date.now() } } } });
    return { ok: true, item: d.item };
  } catch (e) { return { ok: false, error: e.http ? e.message : 'Sem conexão com o servidor — tente novamente.' }; }
}
async function acaoImportar(newItems, fileName) {
  const d = await api('POST', '/api/importar', { usuario: state.currentUser.name, items: newItems, fileName }, 120000);
  await refetchState();
  return d;
}
async function acaoLimparTudo() {
  await api('POST', '/api/limpar', { usuario: state.currentUser.name });
  sync.queue = []; saveQueue();
  state.contagem.rascunho = {}; saveDraft();
  await refetchState();
}
async function baixarBackup() {
  try {
    const r = await fetch('/api/backup', { headers: { 'Authorization': 'Bearer ' + sync.token }, cache: 'no-store' });
    if (!r.ok) throw new Error('Erro ' + r.status);
    const blob = await r.blob();
    const nome = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'backup-contagem.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Backup baixado. Guarde o arquivo em local seguro.', 'ok');
  } catch (e) { toast('Não foi possível baixar o backup: ' + e.message, 'err'); }
}
function enviarAuditoriaServidor(entry) {
  if (!isServer()) return;
  api('POST', '/api/auditoria', { entry }).catch(() => { /* registro informativo, pode falhar sem problema */ });
}

/* ------------------------- Painel "ao vivo" do gestor ------------------------- */
function renderPainelAoVivo() {
  if (!isServer()) {
    return `<div class="card live-card" style="margin-bottom:16px;">
      <div class="section-title">👥 Equipe ao vivo</div>
      <p class="section-sub" style="margin-bottom:0;">O app está aberto sem o servidor, então cada aparelho guarda só a própria contagem. Para acompanhar a equipe em tempo real, inicie o <strong>server.js</strong> e abra o app pelo endereço que ele mostra (veja o LEIAME).</p>
    </div>`;
  }
  // pessoas conectadas agora (um por nome)
  const online = new Map();
  sync.presenca.forEach(p => { if (!online.has(p.nome)) online.set(p.nome, p); });

  // produtividade por pessoa a partir das contagens
  const porUsuario = {};
  Object.keys(state.countsIndex).forEach(id => {
    const idx = state.countsIndex[id];
    [1, 2, 3].forEach(n => {
      const c = idx[n]; if (!c) return;
      const u = porUsuario[c.usuario] || (porUsuario[c.usuario] = { total: 0, ultima: 0, ultimos15: 0 });
      u.total++;
      if (c.timestamp > u.ultima) u.ultima = c.timestamp;
      if (Date.now() - c.timestamp < 15 * 60 * 1000) u.ultimos15++;
    });
  });
  const nomes = Array.from(new Set(Array.from(online.keys()).concat(Object.keys(porUsuario))));
  nomes.sort((a, b) => (online.has(b) - online.has(a)) || ((porUsuario[b] || {}).total || 0) - ((porUsuario[a] || {}).total || 0));

  const feed = state.auditLog.filter(l => l.tipo === 'contagem' || l.tipo === 'recontagem' || l.tipo === 'item-avulso').slice(0, 12);

  return `<div class="grid two-col" style="margin-bottom:16px;">
    <div class="card live-card">
      <div class="section-title"><span class="live-dot ${sync.online ? '' : 'off'}"></span> Equipe ao vivo</div>
      <div class="section-sub">${online.size} ${online.size === 1 ? 'pessoa conectada' : 'pessoas conectadas'} agora · atualiza sozinho</div>
      ${nomes.length ? `<div class="team-list">${nomes.map(n => {
        const u = porUsuario[n] || { total: 0, ultima: 0, ultimos15: 0 };
        const on = online.get(n);
        return `<div class="team-row">
          <span class="avatar-sm ${on ? 'on' : ''}">${esc(initials(n))}</span>
          <div class="team-info"><div class="team-name">${esc(n)}${on && on.perfil === 'gestor' ? ' <span class="badge badge-pending">gestor</span>' : ''}</div>
            <div class="team-sub">${on ? '🟢 online' : '⚪ offline'}${u.ultima ? ' · última contagem ' + fmtHora(u.ultima) : ''}</div></div>
          <div class="team-stats"><strong>${fmtNum(u.total)}</strong><span>contagens</span>${u.ultimos15 ? `<em>${fmtNum(u.ultimos15)} nos últimos 15 min</em>` : ''}</div>
        </div>`;
      }).join('')}</div>` : '<p class="section-sub" style="margin:0;">Ninguém conectado ainda.</p>'}
    </div>
    <div class="card live-card">
      <div class="section-title">⚡ Últimas contagens</div>
      <div class="section-sub">Chegam aqui assim que o operador toca em "Enviar contagem"</div>
      ${feed.length ? `<div class="feed">${feed.map(l => `<div class="feed-row">
        <span class="feed-when">${fmtHora(l.timestamp)}</span>
        <span class="feed-what"><strong>${esc(l.usuario)}</strong> ${esc(l.texto)}</span>
      </div>`).join('')}</div>` : '<p class="section-sub" style="margin:0;">Nenhuma contagem recebida ainda.</p>'}
    </div>
  </div>`;
}
function fmtHora(ts) {
  const d = new Date(ts);
  const hoje = new Date();
  const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoje.toDateString() ? hh : fmtDT(ts);
}
// mantém os horários "relativos" do painel atualizados
setInterval(() => { if (state.screen === 'app' && state.tab === 'dashboard' && isServer()) liveRefresh(null, false); }, 60000);
