/**
 * The get_media card for clients that render MCP Apps / ChatGPT Apps UI.
 *
 * Why: a sandboxed AI client (ChatGPT's code tool has no network) cannot fetch the download link itself. The card runs
 * in the user's browser, which can: it fetches the file from this server with the short-lived capability (Authorization
 * header only, never a query string) and, on the user's click, hands it to ChatGPT with window.openai.uploadFile. The
 * file then reaches the model as an attachment on the next turn (setWidgetState imageIds). Postun still keeps no copy:
 * the bytes stream from Telegram through the Worker straight into the user's browser.
 *
 * The card only ever sends the capability to this server's own origin, which is pinned into the HTML when it is built
 * and is the only connect domain in its CSP. Everything it shows from the tool result (file name, type) is untrusted
 * Telegram data and is written with textContent only.
 */

export const MEDIA_WIDGET_URI = 'ui://postun/media-card-v3.html';
/** Result _meta key that carries the download capability for the card (widget-only in ChatGPT). */
export const DOWNLOAD_META_KEY = 'postun/download';
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

/** Types ChatGPT accepts as an attachment the model can read (images and PDF). Anything else is offered as a download. */
export const ATTACHABLE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;

/** Resource _meta: standard MCP Apps keys plus the ChatGPT compatibility aliases. */
export function mediaWidgetResourceMeta(origin: string): Record<string, unknown> {
  return {
    ui: { csp: { connectDomains: [origin], resourceDomains: [] }, prefersBorder: true },
    'openai/widgetCSP': { connect_domains: [origin], resource_domains: [] },
    'openai/widgetPrefersBorder': true,
    'openai/widgetDescription':
      'A Postun card for one Telegram attachment. The user can attach the file to this chat (images and PDF) or download it; after attaching you receive the file on the next turn. Do not repeat the file details the card already shows.'
  };
}

/** Tool _meta for get_media: which template renders its result. */
export const MEDIA_TOOL_UI_META = {
  ui: { resourceUri: MEDIA_WIDGET_URI },
  'openai/outputTemplate': MEDIA_WIDGET_URI,
  'openai/toolInvocation/invoking': 'Preparing the Telegram file…',
  'openai/toolInvocation/invoked': 'Telegram file ready'
} as const;

const STRINGS = {
  en: {
    attach: 'Attach to chat',
    download: 'Download',
    loading: 'Getting the file from Telegram…',
    uploading: 'Attaching to the chat…',
    attached: 'Attached to the chat.',
    downloaded: 'Download started.',
    notAttachable: 'This file type cannot be attached to the chat; you can download it.',
    expired: 'The link has expired. Ask to get the file again.',
    busy: 'Another download is running. Try again in a moment.',
    failed: 'Could not get the file. Ask to get it again.',
    noUpload: 'This app cannot attach files to the chat; you can download it.',
    followUp: 'I attached the file "{name}" from Telegram. Continue with it.',
    file: 'File'
  },
  ru: {
    attach: 'Передать в чат',
    download: 'Скачать',
    loading: 'Получаю файл из Telegram…',
    uploading: 'Передаю в чат…',
    attached: 'Файл передан в чат.',
    downloaded: 'Скачивание началось.',
    notAttachable: 'Файл такого типа нельзя передать в чат, его можно скачать.',
    expired: 'Ссылка устарела. Попросите получить файл заново.',
    busy: 'Идёт другая загрузка. Повторите через минуту.',
    failed: 'Не удалось получить файл. Попросите получить его заново.',
    noUpload: 'Это приложение не умеет прикреплять файлы к чату, файл можно скачать.',
    followUp: 'Файл «{name}» из Telegram передан в чат. Продолжай с ним.',
    file: 'Файл'
  },
  de: {
    attach: 'An den Chat anhängen',
    download: 'Herunterladen',
    loading: 'Datei wird aus Telegram geladen…',
    uploading: 'Wird an den Chat angehängt…',
    attached: 'An den Chat angehängt.',
    downloaded: 'Download gestartet.',
    notAttachable: 'Dieser Dateityp kann nicht angehängt werden; Sie können ihn herunterladen.',
    expired: 'Der Link ist abgelaufen. Bitten Sie darum, die Datei erneut abzurufen.',
    busy: 'Ein anderer Download läuft. Versuchen Sie es gleich noch einmal.',
    failed: 'Die Datei konnte nicht geladen werden. Bitten Sie darum, sie erneut abzurufen.',
    noUpload: 'Diese App kann keine Dateien anhängen; Sie können die Datei herunterladen.',
    followUp: 'Ich habe die Datei „{name}“ aus Telegram angehängt. Mach damit weiter.',
    file: 'Datei'
  },
  es: {
    attach: 'Adjuntar al chat',
    download: 'Descargar',
    loading: 'Obteniendo el archivo de Telegram…',
    uploading: 'Adjuntando al chat…',
    attached: 'Adjuntado al chat.',
    downloaded: 'Descarga iniciada.',
    notAttachable: 'Este tipo de archivo no se puede adjuntar; puedes descargarlo.',
    expired: 'El enlace ha caducado. Pide obtener el archivo de nuevo.',
    busy: 'Hay otra descarga en curso. Inténtalo en un momento.',
    failed: 'No se pudo obtener el archivo. Pide obtenerlo de nuevo.',
    noUpload: 'Esta app no puede adjuntar archivos al chat; puedes descargarlo.',
    followUp: 'He adjuntado el archivo «{name}» de Telegram. Continúa con él.',
    file: 'Archivo'
  },
  pt: {
    attach: 'Anexar ao chat',
    download: 'Baixar',
    loading: 'Obtendo o arquivo do Telegram…',
    uploading: 'Anexando ao chat…',
    attached: 'Anexado ao chat.',
    downloaded: 'Download iniciado.',
    notAttachable: 'Este tipo de arquivo não pode ser anexado; você pode baixá-lo.',
    expired: 'O link expirou. Peça para obter o arquivo novamente.',
    busy: 'Outro download está em andamento. Tente novamente em instantes.',
    failed: 'Não foi possível obter o arquivo. Peça para obtê-lo novamente.',
    noUpload: 'Este app não consegue anexar arquivos ao chat; você pode baixá-lo.',
    followUp: 'Anexei o arquivo "{name}" do Telegram. Continue com ele.',
    file: 'Arquivo'
  }
};


/** Browser code of the card. Plain ES2020, no framework, no external resources. */
function script(origin: string): string {
  return `
const ORIGIN = ${JSON.stringify(origin)};
const ATTACHABLE = ${JSON.stringify(ATTACHABLE_MIME)};
const ALL = ${JSON.stringify(STRINGS)};
const META_KEY = ${JSON.stringify(DOWNLOAD_META_KEY)};
const oa = () => window.openai;
const lang = String((oa() && oa().locale) || navigator.language || 'en').slice(0, 2).toLowerCase();
const T = ALL[lang] || ALL.en;
const $ = (id) => document.getElementById(id);
let data = null;
let meta = null;
let blob = null;
let busy = false;
let sent = false;

function fmtSize(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}
function status(text, isError) {
  const el = $('status');
  el.textContent = text || '';
  el.className = isError ? 'status err' : 'status';
  reportSize();
}
function diag(text) {
  $('diag').textContent = text || '';
  reportSize();
}
function fileName() {
  const m = data && data.media;
  if (m && typeof m.fileName === 'string' && m.fileName) return m.fileName.slice(0, 200);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }[mime()];
  return 'telegram-' + ((m && m.kind) || 'file') + (ext ? '.' + ext : '');
}
function mime() {
  const m = data && data.media;
  return m && typeof m.mimeType === 'string' ? m.mimeType.toLowerCase() : 'application/octet-stream';
}
/**
 * The capability comes from the widget-only result _meta (ChatGPT: hidden from the model) or, for other hosts, from the
 * result itself. The target must be this server's own /files endpoint; anything else is refused.
 */
function download() {
  const fromMeta = meta && typeof meta === 'object' ? meta[META_KEY] : null;
  const d = fromMeta && typeof fromMeta === 'object' ? fromMeta : data && data.download;
  if (!d || typeof d.url !== 'string' || typeof d.authorization !== 'string') return null;
  let u;
  try { u = new URL(d.url); } catch { return null; }
  if (u.origin !== ORIGIN || !/^\\/files\\/[A-Za-z0-9_-]{16,64}$/.test(u.pathname) || u.search) return null;
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(d.authorization)) return null;
  return { url: u.href, authorization: d.authorization, expiresAt: d.expiresAt };
}
function setBusy(b) {
  busy = b;
  $('attach').disabled = b || sent;
  $('dl').disabled = b;
}

async function fetchBlob() {
  if (blob) return blob;
  const d = download();
  if (!d) throw new Error('failed');
  status(T.loading);
  const res = await fetch(d.url, { headers: { authorization: d.authorization }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error('expired');
  if (res.status === 409 || res.status === 429) throw new Error('busy');
  if (!res.ok || !res.body) throw new Error('failed');
  const total = Number(res.headers.get('content-length')) || (data.media && data.media.size) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (total) status(T.loading + ' ' + Math.min(100, Math.floor((got * 100) / total)) + '%');
  }
  if (total && got !== total) throw new Error('failed');
  blob = new Blob(chunks, { type: mime() });
  return blob;
}

async function toBase64(b) {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fail(e) {
  const k = e && e.message;
  status(k === 'expired' ? T.expired : k === 'busy' ? T.busy : T.failed, true);
}

// ---------------------------------------------------------------- MCP Apps bridge
// JSON-RPC 2.0 over postMessage with the parent window. The host waits for ui/initialize from the card and drops it on
// a timeout otherwise, so the handshake always runs, also when ChatGPT's window.openai compatibility object is present.
const embedded = window.parent && window.parent !== window;
const INIT_ID = 1;
let nextId = 2;
let initialized = false;
let hostCaps = null;
const pending = new Map();
function post(msg) {
  if (embedded) window.parent.postMessage(msg, '*');
}
function request(method, params) {
  if (!embedded || !initialized) return Promise.reject(new Error('no-bridge'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, 30000);
    pending.set(id, { resolve, reject, timer });
    post({ jsonrpc: '2.0', id, method, params });
  });
}
let lastSize = '';
function reportSize() {
  const el = document.documentElement;
  const height = Math.ceil(el.scrollHeight || 0);
  const width = Math.ceil(el.scrollWidth || 0);
  const key = width + 'x' + height;
  if (key === lastSize) return;
  lastSize = key;
  const api = oa();
  if (api && typeof api.notifyIntrinsicHeight === 'function') { try { api.notifyIntrinsicHeight(height); } catch { /* optional */ } }
  if (initialized) post({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width, height } });
}
/** Which content block types the host says it accepts for a method ('message' or 'updateModelContext'). */
function accepts(cap, kind) {
  const c = hostCaps && hostCaps[cap];
  return !!(c && typeof c === 'object' && c[kind]);
}
function capsSummary() {
  if (!hostCaps) return 'host caps: none';
  const list = (cap) => { const c = hostCaps[cap]; return c && typeof c === 'object' ? Object.keys(c).join('+') || 'yes' : '-'; };
  return 'message[' + list('message') + '] context[' + list('updateModelContext') + ']';
}

// ---------------------------------------------------------------- attach
/**
 * Hands the file to the model, in order of preference:
 *  1. ui/message with the file as an image/resource block: a user message that carries the file itself;
 *  2. ui/update-model-context with the block, then a short ui/message (or ChatGPT follow-up) to start the turn;
 *  3. ChatGPT's uploadFile + setWidgetState imageIds (legacy; observed not to reach the model).
 * Each step is used only when the host advertises it (or, for 1, when it advertises nothing), and a JSON-RPC error
 * falls through to the next. The status line says which way was used, so a check can tell them apart.
 */
async function onAttach() {
  if (busy || sent) return;
  setBusy(true);
  try {
    const b = await fetchBlob();
    status(T.uploading);
    const name = fileName();
    const mt = mime();
    const text = T.followUp.split('{name}').join(name);
    const kind = mt.indexOf('image/') === 0 ? 'image' : 'resource';
    const b64 = await toBase64(b);
    const block = kind === 'image'
      ? { type: 'image', data: b64, mimeType: mt }
      : { type: 'resource', resource: { uri: 'postun:file/' + encodeURIComponent(name), mimeType: mt, blob: b64 } };
    const api = oa();
    let way = '';
    if (initialized && (hostCaps === null || accepts('message', kind))) {
      try {
        await request('ui/message', { role: 'user', content: [{ type: 'text', text }, block] });
        way = 'ui/message';
      } catch { /* fall through */ }
    }
    if (!way && initialized && accepts('updateModelContext', kind)) {
      try {
        await request('ui/update-model-context', { content: [block, { type: 'text', text: 'Telegram file "' + name + '" (' + mt + ') attached by the user via Postun.' }] });
        if (accepts('message', 'text')) await request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
        else if (api && typeof api.sendFollowUpMessage === 'function') await api.sendFollowUpMessage({ prompt: text });
        way = 'ui/update-model-context';
      } catch { /* fall through */ }
    }
    if (!way && api && typeof api.uploadFile === 'function') {
      const up = await api.uploadFile(new File([b], name, { type: mt }));
      const fileId = up && (up.fileId || up.id);
      if (!fileId) throw new Error('failed');
      if (typeof api.setWidgetState === 'function') {
        api.setWidgetState({ modelContent: 'The user attached the Telegram file "' + name + '" (' + mt + ').', privateContent: { attached: true }, imageIds: [fileId] });
      }
      if (typeof api.sendFollowUpMessage === 'function') await api.sendFollowUpMessage({ prompt: text });
      way = 'uploadFile';
    }
    if (!way) { status(T.noUpload, true); diag(capsSummary()); return; }
    sent = true;
    if (api && typeof api.setWidgetState === 'function' && way !== 'uploadFile') {
      try { api.setWidgetState({ privateContent: { attached: true } }); } catch { /* optional */ }
    }
    status(T.attached);
    diag(way + ' · ' + capsSummary());
  } catch (e) {
    fail(e);
  } finally {
    setBusy(false);
  }
}

async function onDownload() {
  if (busy) return;
  setBusy(true);
  try {
    const b = await fetchBlob();
    const a = document.createElement('a');
    const href = URL.createObjectURL(b);
    a.href = href;
    a.download = fileName();
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
    status(T.downloaded);
  } catch (e) {
    fail(e);
  } finally {
    setBusy(false);
  }
}

function render(sc, m) {
  if (!sc || typeof sc !== 'object' || !sc.media) return;
  data = sc;
  if (m && typeof m === 'object') meta = m;
  $('row').hidden = false;
  $('name').textContent = fileName();
  $('meta').textContent = [mime(), fmtSize(sc.media.size)].filter(Boolean).join(' · ');
  $('attach').textContent = T.attach;
  $('dl').textContent = T.download;
  const attachable = ATTACHABLE.indexOf(mime()) !== -1;
  const st = oa() && oa().widgetState;
  if (st && st.privateContent && st.privateContent.attached) sent = true;
  $('attach').hidden = !attachable;
  setBusy(false);
  if (!download()) status(T.failed, true);
  else if (sent) status(T.attached);
  else if (!attachable) status(T.notAttachable);
  reportSize();
}

window.addEventListener('message', (ev) => {
  if (!embedded || ev.source !== window.parent) return;
  const m = ev.data;
  if (!m || m.jsonrpc !== '2.0') return;
  if (!m.method && m.id === INIT_ID) {
    if (m.result && !initialized) {
      initialized = true;
      hostCaps = m.result.hostCapabilities && typeof m.result.hostCapabilities === 'object' ? m.result.hostCapabilities : null;
      post({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
      lastSize = '';
      reportSize();
    }
    return;
  }
  if (!m.method && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(new Error('rpc')); else p.resolve(m.result);
    return;
  }
  if (m.method === 'ui/notifications/tool-result' && m.params) {
    render(m.params.structuredContent, m.params._meta);
    return;
  }
  // Any request from the host (ping, teardown, ...) gets an empty result so the host never waits on the card.
  if (m.method && m.id !== undefined && m.id !== null) post({ jsonrpc: '2.0', id: m.id, result: {} });
});

// ChatGPT compatibility: window.openai carries the tool result and announces late values with openai:set_globals.
function fromOpenAi() {
  const api = oa();
  if (api && api.toolOutput) render(api.toolOutput, api.toolResponseMetadata);
}
window.addEventListener('openai:set_globals', fromOpenAi, { passive: true });

$('attach').addEventListener('click', onAttach);
$('dl').addEventListener('click', onDownload);
$('label').textContent = T.file;
fromOpenAi();
post({ jsonrpc: '2.0', id: INIT_ID, method: 'ui/initialize', params: { appInfo: { name: 'postun-media-card', version: '1.2.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' } });
if (typeof ResizeObserver === 'function') new ResizeObserver(reportSize).observe(document.documentElement);
`;
}

const STYLE = `
:root{color-scheme:light dark;--fg:#1d1d1f;--muted:#6e6e73;--bg:transparent;--line:rgba(0,0,0,.12);--btn:#2481cc;--btnfg:#fff;--err:#c62828}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.16);--btn:#3a9ae0;--err:#ff6b6b}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}
.card{padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.name{font-weight:600;word-break:break-word}
.meta{color:var(--muted);font-size:13px}
.row{display:flex;gap:8px;flex-wrap:wrap}
button{font:inherit;border-radius:8px;padding:7px 14px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--fg)}
button.primary{background:var(--btn);border-color:var(--btn);color:var(--btnfg)}
button:disabled{opacity:.55;cursor:default}
.status{font-size:13px;color:var(--muted);min-height:1em}
.status.err{color:var(--err)}
.diag{font-size:11px;color:var(--muted);opacity:.7;min-height:0}
html,body{height:auto}
`;

function escapeScript(s: string): string {
  return s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

const htmlCache = new Map<string, string>();

/** The card's HTML, built once per server origin. */
export function mediaWidgetHtml(origin: string): string {
  let html = htmlCache.get(origin);
  if (!html) {
    html =
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<style>${STYLE}</style></head><body>` +
      `<div class="card" id="card"><div class="label" id="label"></div><div class="name" id="name"></div><div class="meta" id="meta"></div>` +
      `<div class="row" id="row" hidden><button class="primary" id="attach" type="button"></button><button id="dl" type="button"></button></div>` +
      `<div class="status" id="status" role="status" aria-live="polite"></div><div class="diag" id="diag"></div></div>` +
      `<script type="module">${escapeScript(script(origin))}</script></body></html>`;
    htmlCache.set(origin, html);
  }
  return html;
}
