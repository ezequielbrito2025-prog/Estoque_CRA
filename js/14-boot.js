'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 14-boot.js
   Inicialização: recupera o estado salvo neste aparelho (se houver) e faz a primeira renderização.
   ========================================================================= */

/* --------------------------------- Boot ---------------------------------- */
(async function boot() {
  const restored = loadStateFromStorage();
  if (storageAvailable) {
    try {
      const lastName = window.localStorage.getItem(STORAGE_USER_KEY);
      if (lastName) state._loginName = lastName;
    } catch (e) { /* ignore */ }
  }
  document.getElementById('app').innerHTML = '<div class="empty-state" style="padding-top:30vh;">Conectando ao servidor...</div>';
  await syncInit();
  if (sync.mode === 'local' && restored && state.items.length) {
    toast('Contagem em andamento recuperada deste aparelho (' + fmtNum(state.items.length) + ' itens).', 'ok');
  }
  if (sync.mode === 'servidor' && sync.queue.length) {
    toast(sync.queue.length + ' contagem(ns) deste aparelho ainda aguardam envio — serão enviadas assim que conectar.', 'err');
  }
  render();
  if (state.screen === 'app') connectLive();   // sessão salva neste aparelho: entrou direto
})();
