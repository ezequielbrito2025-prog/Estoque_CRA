'use strict';
/* =========================================================================
   Contagem de Inventário — módulo: 01-estado.js
   Estado global, persistência local (localStorage) e constantes da aplicação (status, cores, logo em base64, mapeamento de colunas do ERP, abas).
   ========================================================================= */

'use strict';
/* =========================================================================
   Contagem de Inventário
   Front-end único (HTML+CSS+JS), estado 100% em memória (sem backend).
   ========================================================================= */

/* ---------------------------- Estado global ---------------------------- */
const state = {
  screen: 'login',           // 'login' | 'app'
  currentUser: null,         // {name, perfil}
  tab: 'dashboard',

  items: [],                 // itens importados do ERP
  countsIndex: {},           // itemId -> {1:{qtd,usuario,timestamp}, 2:{...}, 3:{...}}
  auditLog: [],              // log de auditoria (append-only)
  importInfo: null,          // {fileName, importedAt, total, novos, atualizados, removidos}

  importDraft: null,         // wizard de importação em andamento
  contagem: {
    armazem: 'todos', endereco: '', busca: '', pendingRestartId: null, highlightItemId: null,
    buscaGlobal: '', avulsoAberto: false,
    rascunho: {},            // itemId -> quantidade digitada ainda não enviada
  },
  itensFiltro: { busca: '', status: 'todos', armazem: 'todos', page: 1, pageSize: 50 },
  divergFiltro: { busca: '', armazem: 'todos' },
  auditFiltro: { usuario: 'todos', busca: '' },
  locaisFiltro: { busca: '', armazem: 'todos', page: 1, pageSize: 50 },
  _resetConfirm: false,
};

let uidCounter = 1;
function uid(prefix) { return prefix + '_' + (uidCounter++) + '_' + Math.random().toString(36).slice(2, 7); }

/* --------------------- Persistência local (este aparelho) --------------------- */
// Guarda o progresso da contagem no armazenamento do próprio navegador (celular/computador
// onde o arquivo foi aberto), para não perder nada ao fechar a aba ou recarregar a página.
// Cada aparelho/navegador tem seu próprio armazenamento — isso não sincroniza entre aparelhos.
const STORAGE_KEY = 'contagem_inventario_estado_v1';
const STORAGE_USER_KEY = 'contagem_inventario_ultimo_usuario_v1';
let storageAvailable = true;
try {
  const t = '__test__' + Date.now();
  window.localStorage.setItem(t, '1');
  window.localStorage.removeItem(t);
} catch (e) { storageAvailable = false; }

function saveStateToStorage() {
  if (!storageAvailable) return;
  try {
    const payload = {
      v: 1,
      items: state.items,
      countsIndex: state.countsIndex,
      auditLog: state.auditLog,
      importInfo: state.importInfo,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) { /* armazenamento cheio ou indisponível — segue sem persistir */ }
}
function loadStateFromStorage() {
  if (!storageAvailable) return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return false;
    state.items = data.items;
    state.countsIndex = data.countsIndex || {};
    state.auditLog = data.auditLog || [];
    state.importInfo = data.importInfo || null;
    return true;
  } catch (e) { return false; }
}
function clearStoredState() {
  if (!storageAvailable) return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}

/* ------------------------------ Constantes ------------------------------ */
const STATUS_META = {
  pendente: { label: 'Não contado', cls: 'pending', icon: '○' },
  ok:       { label: 'OK (bateu)', cls: 'ok', icon: '✓' },
  sobra:    { label: 'Sobra', cls: 'sobra', icon: '▲' },
  falta:    { label: 'Falta', cls: 'falta', icon: '▼' },
  conflito: { label: 'Conflito (1ª ≠ 2ª)', cls: 'conflito', icon: '⚠' },
};
const CAT_COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)'];
const CAT_NAMES = ['azul', 'laranja', 'água', 'amarelo', 'magenta'];

const LOGO_ICON_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANwAAADuCAYAAABS6GknAAAFLElEQVR42u3d3W0TURSF0ZmRK0BKJFeTMohroJ7UENqgmkhYpIXLA0I8ESlhOD53z/oqQMFr9vXvrGOM5dY9vq63/0c07eunsfor5LR+/rF4sAty4AQkcBKEwAlA4CQAgRN8wAk+4CTwgBN8wEngASfwgJOOCg84gQeclAkPOIFX2Oa/S7M30/cpLZysHXBSJjxHSjlmWjgpc+0snKwdcFImOkdKOWJaOClz7YATdI6UUuYR08LJ2hWuHXBSITrgpEJ0wEmF6ICTCtEBJxWiA04qRAecVIgOOKkQHXBSITrgpEJ0wEmF6NYxfHbZA0bv7aMfeAZOQBaiA04QFqIDTvAVogNO8BWiO/lTaY8HGXwWTlav3coBJ/AK0QEn8ArRASfwCtH5aJfaPL85QhZO1q7wImPhZO0KLyzA6WbojnjMBE7WrnDlgBN0heiAE3SFeZVS7Y9hSRcV4ARdYY6UcsQETspEB5ygA07KRAecoANOykQHnASclLlywAk64KRMdMBJwEmZKwecoANOykQHnASclLlywEnASZkrB5wEnJS5csBJwEmZK3dall8/SfbyfOd/6mB9+/LdLaSKW8cYy8PTvR+nVBzAjr9tuS3LspwvV482LQ9P98PF13M4gRfzXA44WTzgBB5wAm86dN2OlcApHh1wgg44KRNdp2Pl1vGcK+gsnAQdcBJwsnKexwEnAScrB5wk4GTlgJPmqMMLJ8DJygEnAScJOAk4ScCpIi+cACcBJwEnCTgJOEnAScDpMLkNFnBSH3Ad76MlWThJwElTgXN/b+2VF0wsnAScVF2HFweBk+MkcBJwknXbA9z5cvWXkKrAuSGjrJsjpbRbXT6+CJysG3CCDThpSmydvg0DnCwbcIINOME2HbZuX64GTpatsJM/gUADTjfufLlO/wmkjr/VA5wsWmHrGH8uAm4zBFpKXX+JzsIBJuA8eJWZtwUUV+cfNgZuhzz3FXDQWbfu4DwXEWwWzsrJkVLQWTfgJOCsnKzbX8B54QQ62Cyc5EgpK2fdgIMOtrnAeR4n2CycldPU2ICDTl3AOVbKulk4KwcbcIIOth3AuTOqYCsE586oVg42R0roYMsF59VKwWbhrFwotGRswEFn1TqCc6wUbBbOysGWC857ctDBVgjOe3KCzZHSyk0I7ajY3g3OiyfQWTULJ9hywVk5KwebhYMOtlxwVk6wWTgrB1suOCsH3Vt539bCCbq5wVk5KycLB52VywVn5QSdhbNyygVn5aCzcsULB52gc6S0csoFZ+Wgs3IWTtDlgrNyVk7FCwcddFbOkVLQ5YKzclZOxQsHHXRWrvhICZ2g8xzOyikXnJWDzsoVLxx0gq74SAmdlXOkLM5deKA78spt/qCCLhico6WVc6SEDjorlw0OOh0R3c3f+IbOyjlSQgedlcsFB52Ogq7VZymhs3KOlNBBZ+VywUGnZHRtv54DnZVzpIQOOiuXCw46paGb4hvf0Fk5R0rooLNyueB+owNPM6Ob8keEoLNys6Kb9le7oIPOkRI6Wbk3W8fIuLC5QruIPb6u7R8DmweKXLiA+zA6vwrmaOlI6UrtxOBomQ0OvOOi6wxu86CRo6WFs3YuWJFLt3nwyEUKuP+KDjxHS0dKV3CngwMcLQ8PDrx8dJ3AueWwo6ajpYWzeFYuc+mAA8/REjj4gMtEBxx40AEHH3TACT4rBxx80M2DDrii/9iX5zvogAPO+v1758t12h9mrUYHHISOloXogIMQukJ4wAF5WGC36CeAwYONfnQk1QAAAABJRU5ErkJggg==';
const LOGO_FULL_SRC = 'data:image/png;base64,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';

const FIELD_DEFS = [
  { key: 'codigo',    label: 'Código do item',        required: true,  synonyms: ['CODIGO', 'COD', 'SKU', 'CODIGO PRODUTO', 'COD PRODUTO', 'CODIGO DO PRODUTO', 'ITEM', 'COD ITEM'] },
  { key: 'descricao', label: 'Descrição',              required: true,  synonyms: ['DESCRICAO', 'DESCRICAO DO PRODUTO', 'DESCRICAO PRODUTO', 'PRODUTO', 'NOME', 'NOME DO PRODUTO'] },
  { key: 'um',        label: 'Unidade de medida',      required: false, synonyms: ['U M', 'UM', 'UNIDADE', 'UNID', 'UNIDADE DE MEDIDA'] },
  { key: 'grupo',     label: 'Grupo / Categoria',      required: false, synonyms: ['GRUP', 'GRUPO', 'CATEGORIA', 'FAMILIA'] },
  { key: 'armazem',   label: 'Depósito / Armazém',     required: true,  synonyms: ['DESCRICAO DO ARMAZEM', 'ARMAZEM', 'DEPOSITO', 'DESCRICAO DEPOSITO', 'ARMZ', 'FILIAL'] },
  { key: 'endereco',  label: 'Corredor / Endereço',    required: false, synonyms: ['ENDERECO', 'CORREDOR', 'LOCALIZACAO', 'ENDERECO DO ITEM', 'LOCAL', 'POSICAO'] },
  { key: 'saldo',     label: 'Saldo em estoque (ERP)', required: true,  synonyms: ['SALDO EM ESTOQUE', 'SALDO', 'ESTOQUE', 'QUANTIDADE', 'QTD', 'SALDO ATUAL', 'ESTOQUE DISPONIVEL'] },
  { key: 'saldoEmpenhado', label: 'Saldo empenhado (a deduzir)', required: false, synonyms: ['EMPENHO PARA REQ/PV/RESERVA', 'EMPENHO', 'SALDO EMPENHADO', 'EMPENHADO', 'RESERVADO', 'QTD EMPENHADA', 'QUANTIDADE EMPENHADA'] },
  { key: 'valor',     label: 'Valor em estoque (R$)',  required: false, synonyms: ['VALOR EM ESTOQUE', 'VALOR', 'VALOR TOTAL', 'VALOR ESTOQUE'] },
];

const TABS = [
  { key: 'dashboard',    label: 'Dashboard',     icon: '📊' },
  { key: 'importar',     label: 'Importar',      icon: '📥' },
  { key: 'locais',       label: 'Locais',        icon: '📍' },
  { key: 'contagem',     label: 'Contagem',      icon: '📱' },
  { key: 'itens',        label: 'Itens',         icon: '📦' },
  { key: 'divergencias', label: 'Divergências',  icon: '⚠️' },
  { key: 'auditoria',    label: 'Auditoria',     icon: '🕒' },
];

