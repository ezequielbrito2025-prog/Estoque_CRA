'use strict';
/* =========================================================================
   Contagem de Inventário — servidor central (Node.js, sem dependências)

   - Serve os arquivos do app (index.html + js/)
   - Guarda itens, contagens e auditoria em dados/contagem.json
   - Recebe as contagens enviadas pelos celulares/tablets
   - Transmite cada alteração em tempo real (Server-Sent Events) para
     todos os aparelhos conectados — inclusive o painel do gestor

   Uso:  node server.js            (porta 8080)
         PORTA=3000 node server.js

   Senhas (opcional, recomendado quando publicado na internet):
         SENHA_EQUIPE  — senha que os operadores digitam para entrar
         SENHA_GESTOR  — senha do perfil gestor (importar planilha, apagar dados)
   Sem nenhuma das duas definida, o app funciona sem senha (uso em rede interna).

   Pasta dos dados: DADOS_DIR, ou o volume do Railway (RAILWAY_VOLUME_MOUNT_PATH),
   ou ./dados
   ========================================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORTA = parseInt(process.env.PORTA || process.env.PORT || '8080', 10);
const RAIZ = __dirname;
const PASTA_DADOS = path.resolve(process.env.DADOS_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(RAIZ, 'dados'));
const SENHA_EQUIPE = String(process.env.SENHA_EQUIPE || '').trim();
const SENHA_GESTOR = String(process.env.SENHA_GESTOR || '').trim();
const AUTH_ATIVA = !!(SENHA_EQUIPE || SENHA_GESTOR);
const SESSAO_DIAS = 30;
// muda quando as senhas mudam — sessões antigas deixam de valer automaticamente
const CHAVE_SENHAS = require('crypto').createHash('sha256').update('v1|' + SENHA_EQUIPE + '|' + SENHA_GESTOR).digest('hex').slice(0, 16);
const ARQ_DADOS = path.join(PASTA_DADOS, 'contagem.json');
const PASTA_CICLOS = path.join(PASTA_DADOS, 'contagens-anteriores');
const MAX_AUDIT = 20000;
const MAX_CIDS = 50000;
const MAX_BODY = 60 * 1024 * 1024;

/* ------------------------------ Estado ------------------------------ */
let db = {
  version: 0, items: [], countsIndex: {}, auditLog: [], importInfo: null, cids: [], sessoes: {},
  ciclo: null,      // contagem em andamento: {id, nome, iniciadoEm, fileName}
  ciclos: [],       // contagens já encerradas (resumo); o detalhe fica em dados/contagens-anteriores/
};
let cidSet = new Set();

function carregar() {
  try {
    if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true });
    if (fs.existsSync(ARQ_DADOS)) {
      const d = JSON.parse(fs.readFileSync(ARQ_DADOS, 'utf8'));
      db = Object.assign(db, d);
      if (!db.sessoes) db.sessoes = {};
      if (!db.ciclos) db.ciclos = [];
      // base criada antes dos ciclos: adota os itens já importados como a contagem em andamento
      if (!db.ciclo && db.items.length) {
        const desde = (db.importInfo && db.importInfo.importedAt) || Date.now();
        db.ciclo = { id: novoId('ciclo'), nome: nomeAutomaticoCiclo(desde), iniciadoEm: desde, fileName: (db.importInfo && db.importInfo.fileName) || '' };
      }
      cidSet = new Set(db.cids || []);
      console.log(`Dados carregados: ${db.items.length} itens, ${Object.keys(db.countsIndex).length} itens com contagem.`);
    }
  } catch (e) {
    console.error('Não foi possível ler ' + ARQ_DADOS + ':', e.message);
  }
}
let saveTimer = null;
function salvar() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(salvarAgora, 400);
}
function salvarAgora() {
  try {
    if (db.auditLog.length > MAX_AUDIT) db.auditLog.length = MAX_AUDIT;
    if (db.cids.length > MAX_CIDS) { db.cids = db.cids.slice(-MAX_CIDS); cidSet = new Set(db.cids); }
    const tmp = ARQ_DADOS + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, ARQ_DADOS);
  } catch (e) { console.error('Erro ao salvar dados:', e.message); }
}

function novoId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'); }
function audit(usuario, tipo, texto) {
  const e = { id: novoId('log'), timestamp: Date.now(), usuario: usuario || 'Sistema', tipo, texto };
  db.auditLog.unshift(e);
  return e;
}
function normalize(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}
function fmtNum(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function proximaContagem(itemId) {
  const idx = db.countsIndex[itemId];
  if (!idx || !idx[1]) return 1;
  if (!idx[2]) return 2;
  if (idx[1].qtd !== idx[2].qtd && !idx[3]) return 3;
  return null;
}

/* ------------------- Contagens (ciclos) e seus resultados ------------------- */
function nomeAutomaticoCiclo(d) {
  const dt = d ? new Date(d) : new Date();
  return 'Contagem de ' + dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
// mesma regra da tela: 1ª contagem vale se bater com a 2ª; a 3ª arbitra o conflito
function statusItem(item, idx) {
  if (!idx || !idx[1]) return { status: 'pendente', confirmed: null, diff: null };
  const resultado = (q) => {
    const diff = q - item.saldo;
    return { status: diff === 0 ? 'ok' : (diff > 0 ? 'sobra' : 'falta'), confirmed: q, diff };
  };
  if (!idx[2]) return resultado(idx[1].qtd);
  if (idx[1].qtd === idx[2].qtd) return resultado(idx[1].qtd);
  if (idx[3]) return Object.assign(resultado(idx[3].qtd), { arbitrada: true });
  return { status: 'conflito', confirmed: null, diff: null };
}
function valorUnitario(item) { return item.saldo > 0 && item.valor != null ? item.valor / item.saldo : 0; }
function resumoContagem(items, counts) {
  let contados = 0, divergencias = 0, ok = 0, valorDivergente = 0;
  items.forEach(i => {
    const idx = counts[i.id];
    if (!idx || !idx[1]) return;
    contados++;
    const st = statusItem(i, idx);
    if (st.status === 'ok') ok++;
    else { divergencias++; if (st.diff) valorDivergente += Math.abs(st.diff) * valorUnitario(i); }
  });
  return {
    total: items.length, contados, divergencias, valorDivergente: Math.round(valorDivergente * 100) / 100,
    acuracia: contados ? Math.round((ok / contados) * 1000) / 10 : 0,
  };
}
// Encerra a contagem atual: guarda itens, contagens e histórico em arquivo e devolve o resumo.
function arquivarContagemAtual(usuario, nome) {
  if (!db.ciclo || !db.items.length) return null;
  const resumo = Object.assign({
    id: db.ciclo.id, nome: nome || db.ciclo.nome, iniciadoEm: db.ciclo.iniciadoEm,
    encerradoEm: Date.now(), fileName: db.ciclo.fileName, encerradoPor: usuario || 'Sistema',
  }, resumoContagem(db.items, db.countsIndex));
  try {
    if (!fs.existsSync(PASTA_CICLOS)) fs.mkdirSync(PASTA_CICLOS, { recursive: true });
    const detalhe = { resumo, items: db.items, countsIndex: db.countsIndex, auditLog: db.auditLog.slice(0, 20000), importInfo: db.importInfo };
    fs.writeFileSync(path.join(PASTA_CICLOS, resumo.id + '.json'), JSON.stringify(detalhe));
  } catch (e) { console.error('Não foi possível arquivar a contagem:', e.message); }
  db.ciclos.unshift(resumo);
  if (db.ciclos.length > 200) db.ciclos.length = 200;
  return resumo;
}
function linhasCSV(items, counts) {
  const cab = ['CODIGO', 'DESCRICAO', 'UM', 'DEPOSITO', 'ENDERECO', 'SALDO ERP', '1a CONTAGEM', '2a CONTAGEM', '3a CONTAGEM', 'QTD CONFIRMADA', 'DIFERENCA', 'VALOR DIVERGENTE', 'STATUS', 'CONTADO POR'];
  const linhas = [cab];
  const rotulo = { pendente: 'Nao contado', ok: 'OK (bateu)', sobra: 'Sobra', falta: 'Falta', conflito: 'Conflito (1a <> 2a)' };
  items.forEach(i => {
    const idx = counts[i.id] || {};
    const st = statusItem(i, idx);
    const vd = st.diff ? Math.abs(st.diff) * valorUnitario(i) : 0;
    linhas.push([
      i.codigo, i.descricao, i.um || '', i.armazem, i.endereco || '', i.saldo,
      idx[1] ? idx[1].qtd : '', idx[2] ? idx[2].qtd : '', idx[3] ? idx[3].qtd : '',
      st.confirmed == null ? '' : st.confirmed, st.diff == null ? '' : st.diff,
      vd ? vd.toFixed(2).replace('.', ',') : '', rotulo[st.status] || st.status,
      idx[1] ? idx[1].usuario : '',
    ]);
  });
  return '\ufeff' + linhas.map(l => l.map(c => {
    const t = String(c == null ? '' : c);
    return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(';')).join('\r\n');
}
function lerCicloArquivado(id) {
  if (!/^[A-Za-z0-9_]+$/.test(String(id || ''))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(PASTA_CICLOS, id + '.json'), 'utf8')); } catch (e) { return null; }
}
function nomeArquivo(base, resumo, ext) {
  const d = new Date(resumo.encerradoEm || Date.now()).toISOString().slice(0, 10);
  return (base + '-' + d + '-' + (resumo.nome || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) + ext;
}

/* ------------------------------ Autenticação ------------------------------ */
function senhaConfere(digitada, correta) {
  if (!correta) return false;
  const a = crypto.createHash('sha256').update(String(digitada || '')).digest();
  const b = crypto.createHash('sha256').update(correta).digest();
  return crypto.timingSafeEqual(a, b);
}
// operador: senha da equipe (ou a do gestor). gestor: senha do gestor (ou a da equipe, se só ela existir)
function perfilPermitido(perfil, senha) {
  if (!AUTH_ATIVA) return true;
  if (perfil === 'gestor') return SENHA_GESTOR ? senhaConfere(senha, SENHA_GESTOR) : senhaConfere(senha, SENHA_EQUIPE);
  return (SENHA_EQUIPE && senhaConfere(senha, SENHA_EQUIPE)) || (SENHA_GESTOR && senhaConfere(senha, SENHA_GESTOR)) || (!SENHA_EQUIPE && !SENHA_GESTOR);
}
function sessaoDe(req, url) {
  let token = '';
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) token = h.slice(7).trim();
  if (!token && url) token = url.searchParams.get('token') || '';
  const s = token && db.sessoes[token];
  if (!s) return null;
  if (s.chave !== CHAVE_SENHAS || Date.now() - s.criado > SESSAO_DIAS * 864e5) { delete db.sessoes[token]; salvar(); return null; }
  return s;
}
function limparSessoesVelhas() {
  const lim = Date.now() - SESSAO_DIAS * 864e5;
  Object.keys(db.sessoes).forEach(t => { const s = db.sessoes[t]; if (s.criado < lim || s.chave !== CHAVE_SENHAS) delete db.sessoes[t]; });
}
// limite simples contra tentativas de adivinhar a senha: 10 erros por IP a cada 15 min
const tentativas = new Map();
function ipDe(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t) return false;
  if (Date.now() - t.inicio > 15 * 60e3) { tentativas.delete(ip); return false; }
  return t.erros >= 10;
}
function registrarErro(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.inicio > 15 * 60e3) tentativas.set(ip, { inicio: Date.now(), erros: 1 });
  else t.erros++;
}

/* --------------------------- Tempo real (SSE) --------------------------- */
const clientes = new Map(); // id -> {res, nome, perfil, desde}
function presenca() {
  return Array.from(clientes.values()).map(c => ({ id: c.id, nome: c.nome, perfil: c.perfil, desde: c.desde }));
}
function enviar(res, evento, dados) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
}
function transmitir(evento, dados) {
  for (const c of clientes.values()) { try { enviar(c.res, evento, dados); } catch (e) { /* ignore */ } }
}
function transmitirPatch(patch) {
  db.version++;
  patch.version = db.version;
  transmitir('patch', patch);
  salvar();
  return patch;
}
setInterval(() => { for (const c of clientes.values()) { try { c.res.write(': ping\n\n'); } catch (e) { /* ignore */ } } }, 20000);

/* ------------------------------ HTTP util ------------------------------ */
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', ch => {
      tam += ch.length;
      if (tam > MAX_BODY) { reject(new Error('Requisição muito grande')); req.destroy(); return; }
      partes.push(ch);
    });
    req.on('end', () => {
      try { resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); }
      catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};
function servirArquivo(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(RAIZ, rel));
  const base = path.basename(full);
  if (!full.startsWith(RAIZ) || full.startsWith(PASTA_DADOS) || full.startsWith(path.join(RAIZ, 'dados'))
      || ['server.js', 'package.json', 'iniciar-servidor.bat', 'iniciar-servidor.sh'].includes(base) || base.startsWith('.')) {
    res.writeHead(403); res.end('Proibido'); return;
  }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    });
    res.end(data);
  });
}

/* ------------------------------ Rotas API ------------------------------ */
// rotas públicas (sem login)
const publicas = new Set(['GET /api/config', 'POST /api/login']);
// rotas só para o gestor
const soGestor = new Set(['POST /api/importar', 'POST /api/limpar', 'GET /api/backup',
  'POST /api/nova-contagem', 'GET /api/contagem-anterior', 'POST /api/renomear-contagem', 'GET /api/resultado']);

const rotas = {
  'GET /api/config': (req, res) => {
    json(res, 200, { ok: true, auth: AUTH_ATIVA, senhaGestorSeparada: !!SENHA_GESTOR });
  },

  'POST /api/login': async (req, res) => {
    const ip = ipDe(req);
    if (bloqueado(ip)) return json(res, 429, { ok: false, erro: 'Muitas tentativas com senha errada. Aguarde 15 minutos.' });
    const body = await lerCorpo(req);
    const nome = String(body.nome || '').trim().slice(0, 60);
    const perfil = body.perfil === 'gestor' ? 'gestor' : 'operador';
    if (!nome) return json(res, 400, { ok: false, erro: 'Digite seu nome.' });
    if (!perfilPermitido(perfil, body.senha)) {
      registrarErro(ip);
      return json(res, 401, { ok: false, erro: perfil === 'gestor' ? 'Senha do gestor incorreta.' : 'Senha incorreta.' });
    }
    limparSessoesVelhas();
    const token = crypto.randomBytes(24).toString('hex');
    db.sessoes[token] = { nome, perfil, criado: Date.now(), chave: CHAVE_SENHAS };
    audit(nome, 'login', 'entrou no sistema como ' + (perfil === 'gestor' ? 'Gestor do portal' : 'Operador de coletor'));
    transmitirPatch({ audit: [db.auditLog[0]] });
    json(res, 200, { ok: true, token, nome, perfil });
  },

  'POST /api/logout': (req, res, url, ses) => {
    const h = req.headers['authorization'] || '';
    if (h.startsWith('Bearer ')) delete db.sessoes[h.slice(7).trim()];
    salvar();
    json(res, 200, { ok: true });
  },

  'GET /api/state': (req, res, url, ses) => {
    json(res, 200, {
      version: db.version, items: db.items, countsIndex: db.countsIndex,
      auditLog: db.auditLog.slice(0, 3000), importInfo: db.importInfo, presenca: presenca(),
      sessao: { nome: ses.nome, perfil: ses.perfil },
      ciclo: db.ciclo, ciclos: ses.perfil === 'gestor' ? db.ciclos : [],
    });
  },

  'GET /api/events': (req, res, url, ses) => {
    const id = novoId('cli');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const c = {
      id, res, desde: Date.now(),
      nome: ses.nome, perfil: ses.perfil,
    };
    clientes.set(id, c);
    enviar(res, 'hello', { version: db.version, clienteId: id });
    transmitir('presenca', presenca());
    req.on('close', () => { clientes.delete(id); transmitir('presenca', presenca()); });
  },

  // lote de contagens enviado pelo botão "Enviar contagem"
  'POST /api/contagens': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    const usuario = ses.nome;
    const entries = Array.isArray(body.entries) ? body.entries.slice(0, 5000) : [];
    const resultados = [];
    const counts = {}; const auditNovos = [];
    const agora = Date.now();
    for (const e of entries) {
      const cid = String(e.cid || '');
      if (cid && cidSet.has(cid)) { resultados.push({ cid, itemId: e.itemId, status: 'duplicado' }); continue; }
      const item = db.items.find(i => i.id === e.itemId);
      const qtd = Number(e.qtd);
      if (!item) { resultados.push({ cid, itemId: e.itemId, status: 'item-inexistente' }); continue; }
      if (!isFinite(qtd) || qtd < 0) { resultados.push({ cid, itemId: e.itemId, status: 'invalido' }); continue; }
      const numero = proximaContagem(item.id);
      if (numero === null) { resultados.push({ cid, itemId: item.id, status: 'finalizado' }); continue; }
      if (!db.countsIndex[item.id]) db.countsIndex[item.id] = {};
      db.countsIndex[item.id][numero] = { qtd, usuario, timestamp: agora };
      counts[item.id] = db.countsIndex[item.id];
      if (cid) { cidSet.add(cid); db.cids.push(cid); }
      const local = item.armazem + (item.endereco ? ' / ' + item.endereco : '');
      auditNovos.push(audit(usuario, 'contagem', `registrou a ${numero}ª contagem de "${item.codigo} — ${item.descricao}" (${local}): ${fmtNum(qtd)} ${item.um || ''}`.trim()));
      resultados.push({ cid, itemId: item.id, status: Number(e.numero) === numero || !e.numero ? 'ok' : 'renumerado', numero });
    }
    let version = db.version;
    if (auditNovos.length) version = transmitirPatch({ counts, audit: auditNovos.reverse() }).version;
    json(res, 200, { ok: true, version, resultados, counts });
  },

  'POST /api/recontar': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    const item = db.items.find(i => i.id === body.itemId);
    if (!item) return json(res, 404, { ok: false, erro: 'Item não encontrado.' });
    delete db.countsIndex[item.id];
    const a = audit(ses.nome, 'recontagem', `reiniciou a contagem de "${item.codigo} — ${item.descricao}" (nova rodada)`);
    const p = transmitirPatch({ counts: { [item.id]: null }, audit: [a] });
    json(res, 200, { ok: true, version: p.version });
  },

  'POST /api/avulso': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    const it = body.item || {};
    const codigo = String(it.codigo || '').trim();
    const armazem = String(it.armazem || '').trim();
    const endereco = String(it.endereco || '').trim();
    const qtd = Number(body.qtd);
    if (!codigo || !armazem) return json(res, 400, { ok: false, erro: 'Código e depósito são obrigatórios.' });
    if (!isFinite(qtd) || qtd < 0) return json(res, 400, { ok: false, erro: 'Quantidade inválida.' });
    const dupe = db.items.find(i => normalize(i.codigo) === normalize(codigo) && i.armazem === armazem && (i.endereco || '') === endereco);
    if (dupe) return json(res, 409, { ok: false, erro: 'Já existe um item com esse código neste corredor. Use o campo de quantidade dele na lista.' });
    const item = {
      id: novoId('avulso'), codigo, descricao: String(it.descricao || '').trim() || '(sem descrição)',
      um: String(it.um || '').trim(), grupo: '', armazem, endereco, saldo: 0, valor: 0, avulso: true,
    };
    db.items.push(item);
    db.countsIndex[item.id] = { 1: { qtd, usuario: ses.nome, timestamp: Date.now() } };
    const a1 = audit(ses.nome, 'contagem', `registrou a 1ª contagem de "${item.codigo} — ${item.descricao}" (${armazem}${endereco ? ' / ' + endereco : ''}): ${fmtNum(qtd)} ${item.um}`.trim());
    const a2 = audit(ses.nome, 'item-avulso', `adicionou item não cadastrado no ERP: "${item.codigo} — ${item.descricao}" (${armazem}${endereco ? ' / ' + endereco : ''})`);
    const p = transmitirPatch({ items: [item], counts: { [item.id]: db.countsIndex[item.id] }, audit: [a1, a2] });
    json(res, 200, { ok: true, version: p.version, item });
  },

  // Importação da planilha do ERP (só o gestor), em dois modos:
  //   modo "novo"      — começa uma contagem nova: arquiva a contagem atual e zera as contagens
  //   modo "atualizar" — corrige a planilha da contagem em andamento, preservando o que já foi contado
  'POST /api/importar': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    const newItems = Array.isArray(body.items) ? body.items : [];
    if (!newItems.length) return json(res, 400, { ok: false, erro: 'Nenhum item recebido.' });
    const fileName = String(body.fileName || 'planilha');
    const novaContagem = body.modo !== 'atualizar';

    if (novaContagem) {
      const anterior = arquivarContagemAtual(ses.nome);
      db.items = newItems;
      db.countsIndex = {};
      db.cids = []; cidSet = new Set();
      db.ciclo = { id: novoId('ciclo'), nome: String(body.nome || '').trim() || nomeAutomaticoCiclo(), iniciadoEm: Date.now(), fileName };
      db.importInfo = { fileName, importedAt: Date.now(), total: newItems.length, novos: newItems.length, atualizados: 0, removidos: 0 };
      audit(ses.nome, 'nova-contagem', `iniciou a contagem "${db.ciclo.nome}" com a planilha "${fileName}": ${newItems.length} itens, tudo zerado para contar${anterior ? ` · a contagem anterior ("${anterior.nome}") foi arquivada com ${fmtNum(anterior.contados)} de ${fmtNum(anterior.total)} itens contados` : ''}`);
      db.version++;
      transmitir('reload', { version: db.version, ciclo: db.ciclo.id });
      salvar();
      return json(res, 200, { ok: true, version: db.version, importInfo: db.importInfo, ciclo: db.ciclo, anterior });
    }

    const oldIds = new Set(db.items.map(i => i.id));
    const newIds = new Set(newItems.map(i => i.id));
    let novos = 0, atualizados = 0;
    newItems.forEach(i => oldIds.has(i.id) ? atualizados++ : novos++);
    const removidos = db.items.filter(i => !newIds.has(i.id)).length;
    const avulsos = db.items.filter(i => i.avulso && !newIds.has(i.id));
    const finalItems = newItems.concat(avulsos);
    const counts = {};
    finalItems.forEach(i => { if (db.countsIndex[i.id]) counts[i.id] = db.countsIndex[i.id]; });
    db.items = finalItems;
    db.countsIndex = counts;
    if (!db.ciclo) db.ciclo = { id: novoId('ciclo'), nome: nomeAutomaticoCiclo(), iniciadoEm: Date.now(), fileName };
    db.importInfo = { fileName, importedAt: Date.now(), total: finalItems.length, novos, atualizados, removidos };
    audit(ses.nome, 'importacao', `atualizou a planilha da contagem em andamento com "${fileName}": ${newItems.length} itens do ERP (${novos} novos, ${atualizados} atualizados, ${removidos} removidos)${avulsos.length ? ` · ${avulsos.length} itens avulsos mantidos` : ''} · contagens já feitas foram preservadas`);
    db.version++;
    transmitir('reload', { version: db.version, ciclo: db.ciclo.id });
    salvar();
    json(res, 200, { ok: true, version: db.version, importInfo: db.importInfo, ciclo: db.ciclo });
  },

  // Começa uma contagem nova com os MESMOS itens já importados (sem planilha nova).
  'POST /api/nova-contagem': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    if (!db.items.length) return json(res, 400, { ok: false, erro: 'Não há itens importados. Importe a planilha do ERP primeiro.' });
    const anterior = arquivarContagemAtual(ses.nome);
    const manterAvulsos = body.manterAvulsos === true;
    if (!manterAvulsos) db.items = db.items.filter(i => !i.avulso);
    db.countsIndex = {};
    db.cids = []; cidSet = new Set();
    db.ciclo = { id: novoId('ciclo'), nome: String(body.nome || '').trim() || nomeAutomaticoCiclo(), iniciadoEm: Date.now(), fileName: (db.importInfo && db.importInfo.fileName) || '' };
    audit(ses.nome, 'nova-contagem', `iniciou a contagem "${db.ciclo.nome}" com os mesmos ${fmtNum(db.items.length)} itens, tudo zerado para contar${anterior ? ` · a contagem anterior ("${anterior.nome}") foi arquivada com ${fmtNum(anterior.contados)} de ${fmtNum(anterior.total)} itens contados` : ''}`);
    db.version++;
    transmitir('reload', { version: db.version, ciclo: db.ciclo.id });
    salvar();
    json(res, 200, { ok: true, version: db.version, ciclo: db.ciclo, anterior });
  },

  'POST /api/renomear-contagem': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    const nome = String(body.nome || '').trim().slice(0, 80);
    if (!nome) return json(res, 400, { ok: false, erro: 'Informe um nome para a contagem.' });
    if (body.id) {
      const c = db.ciclos.find(x => x.id === body.id);
      if (!c) return json(res, 404, { ok: false, erro: 'Contagem não encontrada.' });
      c.nome = nome;
      const det = lerCicloArquivado(c.id);
      if (det) { det.resumo.nome = nome; try { fs.writeFileSync(path.join(PASTA_CICLOS, c.id + '.json'), JSON.stringify(det)); } catch (e) { /* ignore */ } }
    } else {
      if (!db.ciclo) return json(res, 400, { ok: false, erro: 'Nenhuma contagem em andamento.' });
      db.ciclo.nome = nome;
    }
    db.version++;
    transmitir('reload', { version: db.version });
    salvar();
    json(res, 200, { ok: true, version: db.version });
  },

  // Baixa o resultado de uma contagem já encerrada (planilha CSV ou cópia completa em JSON).
  'GET /api/contagem-anterior': (req, res, url, ses) => {
    const det = lerCicloArquivado(url.searchParams.get('id'));
    if (!det) return json(res, 404, { ok: false, erro: 'Contagem não encontrada.' });
    if (url.searchParams.get('formato') === 'json') {
      const nome = nomeArquivo('contagem', det.resumo, '.json');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + nome + '"', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(det));
    }
    const nome = nomeArquivo('contagem', det.resumo, '.csv');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + nome + '"', 'Cache-Control': 'no-store' });
    res.end(linhasCSV(det.items, det.countsIndex));
  },

  // Planilha com o resultado da contagem em andamento
  'GET /api/resultado': (req, res, url, ses) => {
    const resumo = { nome: (db.ciclo && db.ciclo.nome) || 'contagem', encerradoEm: Date.now() };
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="' + nomeArquivo('contagem-parcial', resumo, '.csv') + '"',
    });
    res.end(linhasCSV(db.items, db.countsIndex));
  },

  'POST /api/auditoria': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    if (body.entry && body.entry.id && !db.auditLog.some(l => l.id === body.entry.id)) {
      const e = {
        id: String(body.entry.id), timestamp: Number(body.entry.timestamp) || Date.now(),
        usuario: ses.nome,
        tipo: String(body.entry.tipo || 'info').slice(0, 30), texto: String(body.entry.texto || '').slice(0, 2000),
      };
      db.auditLog.unshift(e);
      transmitirPatch({ audit: [e] });
    }
    json(res, 200, { ok: true });
  },

  // cópia de segurança completa (itens, contagens, histórico) — só o gestor
  'GET /api/backup': (req, res, url, ses) => {
    const copia = { geradoEm: new Date().toISOString(), version: db.version, items: db.items, countsIndex: db.countsIndex, auditLog: db.auditLog, importInfo: db.importInfo };
    const nome = 'backup-contagem-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + nome + '"', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(copia));
  },

  'POST /api/limpar': async (req, res, url, ses) => {
    const body = await lerCorpo(req);
    // as contagens já encerradas continuam arquivadas; só a contagem em andamento é apagada
    db.items = []; db.countsIndex = {}; db.auditLog = []; db.importInfo = null; db.cids = []; cidSet = new Set();
    db.ciclo = null;  // sessões continuam válidas
    audit(ses.nome, 'limpeza', 'apagou todos os itens, contagens e histórico do servidor');
    db.version++;
    transmitir('reload', { version: db.version });
    salvar();
    json(res, 200, { ok: true });
  },
};

/* ------------------------------ Servidor ------------------------------ */
carregar();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const chave = req.method + ' ' + url.pathname;
  try {
    if (rotas[chave]) {
      let ses = null;
      if (!publicas.has(chave)) {
        ses = sessaoDe(req, url);
        if (!ses) return json(res, 401, { ok: false, erro: 'Sessão expirada — entre novamente.', sessao: true });
        if (soGestor.has(chave) && ses.perfil !== 'gestor') return json(res, 403, { ok: false, erro: 'Apenas o gestor pode fazer isso.' });
      }
      return await rotas[chave](req, res, url, ses);
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, erro: 'Rota não encontrada' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    servirArquivo(req, res, url.pathname);
  } catch (e) {
    console.error(chave, e.message);
    if (!res.headersSent) json(res, 400, { ok: false, erro: e.message });
  }
});
server.requestTimeout = 0;
server.listen(PORTA, '0.0.0.0', () => {
  console.log('\n==============================================================');
  console.log('  Contagem de Inventário — servidor rodando');
  console.log('==============================================================');
  console.log(`  Neste computador:   http://localhost:${PORTA}`);
  const ips = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(n => {
    if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  }));
  ips.forEach(ip => console.log(`  Celulares/tablets:  http://${ip}:${PORTA}`));
  console.log('\n  (os aparelhos precisam estar na mesma rede Wi-Fi deste computador)');
  console.log('  Dados salvos em: ' + ARQ_DADOS);
  if (AUTH_ATIVA) console.log('  Proteção por senha: ATIVA' + (SENHA_GESTOR ? ' (senha separada para o gestor)' : ''));
  else console.log('  ⚠ Proteção por senha: DESATIVADA — qualquer pessoa com o endereço pode entrar.\n    Defina SENHA_EQUIPE e SENHA_GESTOR para ativar (veja o LEIAME).');
  console.log('  Para parar: Ctrl+C\n');
});
function encerrar() { clearTimeout(saveTimer); salvarAgora(); process.exit(0); }
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
