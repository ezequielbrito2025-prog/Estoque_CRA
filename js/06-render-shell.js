'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 06-render-shell.js
   Casca da interface: função render() principal, tela de login, topbar/abas/rodapé (shell) e roteamento entre as abas.
   ========================================================================= */

/* =========================================================================
   RENDER
   ========================================================================= */
function render() {
  const app = document.getElementById('app');
  app.innerHTML = state.screen === 'login' ? renderLogin() : renderShell();
  wireDynamic();
}

function renderLogin() {
  const perfil = state._loginPerfil || 'operador';
  return `
  <div class="login-wrap">
    <div class="login-card">
      <img class="login-logo" src="${LOGO_FULL_SRC}" alt="Consórcio Recife Ambiental">
      <h1 class="login-title">Contagem de Inventário</h1>
      <p class="login-sub">Contagem de estoque com divergência automática, coletor mobile e portal web.</p>
      <div class="field">
        <label for="loginName">Seu nome</label>
        <input type="text" id="loginName" placeholder="Ex.: Ana Souza" value="${esc(state._loginName || '')}" autocomplete="off">
      </div>
      <div class="field">
        <label>Perfil de acesso</label>
        <div class="profile-pick">
          <button type="button" class="profile-opt ${perfil === 'operador' ? 'active' : ''}" data-action="login-pick-profile" data-perfil="operador">📱<br>Operador de coletor</button>
          <button type="button" class="profile-opt ${perfil === 'gestor' ? 'active' : ''}" data-action="login-pick-profile" data-perfil="gestor">💻<br>Gestor do portal</button>
        </div>
      </div>
      ${isServer() && sync.auth ? `<div class="field">
        <label for="loginSenha">${perfil === 'gestor' && sync.senhaGestorSeparada ? 'Senha do gestor' : 'Senha da equipe'}</label>
        <input type="password" id="loginSenha" placeholder="Digite a senha" autocomplete="current-password" enterkeyhint="go">
      </div>` : ''}
      <button class="btn btn-primary btn-block btn-lg" data-action="login-submit" id="loginBtn">Entrar</button>
      <p class="section-sub" style="margin-top:14px;text-align:center;">${isServer() && sync.auth
        ? '🔒 Acesso protegido. Depois de entrar, este aparelho fica conectado — não é preciso digitar a senha de novo até tocar em "sair".'
        : 'O nome identifica quem fez cada contagem no histórico.'}</p>
    </div>
  </div>`;
}

function tabsVisiveis() {
  // no modo compartilhado só o gestor importa planilha / apaga dados
  if (isServer() && state.currentUser && state.currentUser.perfil !== 'gestor') return TABS.filter(t => t.key !== 'importar');
  return TABS;
}
function renderShell() {
  const TABS = tabsVisiveis();
  const divergCount = state.items.reduce((n, it) => n + (isDivergent(computeItemStatus(it)) ? 1 : 0), 0);
  return `
  <div class="topbar">
    <div class="brand"><span class="logo-mark"><img src="${LOGO_ICON_SRC}" alt="logo"></span> Contagem de Inventário</div>
    <div class="spacer"></div>
    ${syncBadgeHTML()}
    <div class="user-chip">
      <span class="avatar">${esc(initials(state.currentUser.name))}</span>
      <span>${esc(state.currentUser.name)} · ${state.currentUser.perfil === 'gestor' ? 'Gestor' : 'Operador'}</span>
      <button data-action="logout">sair</button>
    </div>
  </div>
  <div class="tabs">
    ${TABS.map(t => `<button class="tab-btn ${state.tab === t.key ? 'active' : ''}" data-action="switch-tab" data-tab="${t.key}">
      <span>${t.icon}</span><span>${t.label}</span>
      ${t.key === 'divergencias' && divergCount ? `<span class="badge-count">${divergCount}</span>` : ''}
    </button>`).join('')}
  </div>
  <main>${renderTabContent()}</main>
  <footer class="app-footer">Contagem de Inventário &middot; ${isServer() ? 'contagem compartilhada em tempo real com todos os aparelhos conectados ao servidor' : 'modo local: a contagem fica salva só neste aparelho'}</footer>
  <nav class="bottom-nav"><div class="bn-row">
    ${TABS.map(t => `<button class="bn-btn ${state.tab === t.key ? 'active' : ''}" data-action="switch-tab" data-tab="${t.key}">
      <span class="bn-icon">${t.icon}</span><span>${t.label}</span>
      ${t.key === 'divergencias' && divergCount ? `<span class="badge-count">${divergCount}</span>` : ''}
    </button>`).join('')}
  </div></nav>`;
}

function renderTabContent() {
  if (state.tab === 'importar' && !tabsVisiveis().some(t => t.key === 'importar')) state.tab = 'contagem';
  if (!state.items.length && state.tab !== 'importar' && !state.importDraft) {
    return renderEmptyNoData();
  }
  switch (state.tab) {
    case 'dashboard': return renderDashboard();
    case 'importar': return renderImportar();
    case 'locais': return renderLocais();
    case 'contagem': return renderContagem();
    case 'itens': return renderItens();
    case 'divergencias': return renderDivergencias();
    case 'auditoria': return renderAuditoria();
    default: return '';
  }
}
function renderEmptyNoData() {
  if (isServer() && state.currentUser && state.currentUser.perfil !== 'gestor') {
    return `<div class="card empty-state">
      <div class="es-icon">⏳</div>
      <h3 style="margin:0 0 6px;">Aguardando a planilha do gestor</h3>
      <p style="margin:0;">Assim que o gestor importar a planilha do ERP, a lista de itens aparece aqui automaticamente.</p>
    </div>`;
  }
  return `<div class="card empty-state">
    <div class="es-icon">📥</div>
    <h3 style="margin:0 0 6px;">Nenhum item importado ainda</h3>
    <p style="margin:0 0 16px;">Importe a planilha de estoque do ERP para começar a contagem.</p>
    <button class="btn btn-primary" data-action="switch-tab" data-tab="importar">Importar planilha</button>
  </div>`;
}

