// Behaviour of the get_media card's browser code, run in a node:vm sandbox with a minimal DOM and a fake ChatGPT
// bridge (window.openai). Synthetic data only. Run with `node --test test-node/` (Node 26 strips the TS types).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { mediaWidgetHtml } from '../src/widget.ts';

const ORIGIN = 'https://mcp.test';
const CAP = 'Bearer 00000000-0000-4000-8000-000000000000.synthsecretsynthsecretsynthsecret00.synthmacsynthmacsynthmacsynthmacsynthmac123';
const GOOD_URL = `${ORIGIN}/files/AAAAAAAAAAAAAAAAAAAAAA`;

function el(id) {
  const listeners = {};
  return {
    id,
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    dataset: {},
    addEventListener: (t, f) => (listeners[t] = f),
    fire: (t) => listeners[t]?.(),
    click() {},
    remove() {}
  };
}

function run({ output, locale = 'ru', fetchImpl, openai = true, embedded = false }) {
  const html = mediaWidgetHtml(ORIGIN);
  const code = /<script type="module">([\s\S]*)<\/script>/.exec(html)[1];
  const els = Object.fromEntries(['card', 'label', 'name', 'meta', 'row', 'attach', 'dl', 'status'].map((i) => [i, el(i)]));
  els.row.hidden = true; // the page starts with the buttons hidden
  const calls = { fetch: [], upload: [], state: [], followUp: [] };
  const api = openai
    ? {
        locale,
        toolOutput: output,
        widgetState: null,
        uploadFile: async (file) => {
          calls.upload.push({ name: file.name, type: file.type, size: file.size });
          return { fileId: 'file-synthetic-1' };
        },
        setWidgetState: (s) => calls.state.push(s),
        sendFollowUpMessage: async (m) => calls.followUp.push(m)
      }
    : undefined;
  const listeners = {};
  const sent = [];
  const window = { openai: api, addEventListener: (t, f) => (listeners[t] = f), parent: null };
  window.parent = embedded ? { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } : window;
  const fromHost = (data) => listeners.message?.({ source: window.parent, data });
  const sandbox = {
    window,
    document: { getElementById: (id) => els[id], createElement: () => el('a'), body: { appendChild() {} }, documentElement: { scrollWidth: 320, scrollHeight: 140 } },
    navigator: { language: locale },
    fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      return fetchImpl(url, init);
    },
    Blob,
    File,
    URL,
    setTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { els, calls, sent, fromHost };
}

const okFetch = (body = new Uint8Array([1, 2, 3, 4])) => async () =>
  new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });

const flush = () => new Promise((r) => setTimeout(r, 20));

const photo = (url = GOOD_URL) => ({
  media: { kind: 'photo', fileName: null, mimeType: 'image/jpeg', size: 4 },
  download: { url, authorization: CAP, expiresAt: '2030-01-01T00:00:00.000Z', supportsRange: true }
});

test('renders the file and attaches it: fetch only to the pinned origin, upload, imageIds, follow-up', async () => {
  const { els, calls } = run({ output: photo(), fetchImpl: okFetch() });
  assert.equal(els.row.hidden, false);
  assert.equal(els.name.textContent, 'telegram-photo.jpg');
  assert.equal(els.attach.textContent, 'Передать в чат');
  assert.equal(els.attach.hidden, false);
  els.attach.fire('click');
  await flush();
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].url, GOOD_URL);
  assert.equal(calls.fetch[0].init.headers.authorization, CAP);
  assert.equal(calls.fetch[0].init.credentials, 'omit');
  assert.equal(JSON.stringify(calls.upload), JSON.stringify([{ name: 'telegram-photo.jpg', type: 'image/jpeg', size: 4 }]));
  assert.equal(JSON.stringify(calls.state[0].imageIds), JSON.stringify(['file-synthetic-1']));
  assert.match(calls.followUp[0].prompt, /telegram-photo\.jpg/);
  assert.equal(els.status.textContent, 'Файл передан в чат.');
  assert.equal(els.attach.disabled, true);
});

test('never sends the capability to another origin or a non-/files path', async () => {
  for (const url of ['https://evil.test/files/AAAAAAAAAAAAAAAAAAAAAA', `${ORIGIN}/mcp`, `${GOOD_URL}?x=1`, 'javascript:alert(1)']) {
    const { els, calls } = run({ output: photo(url), fetchImpl: okFetch() });
    els.attach.fire('click');
    await flush();
    assert.equal(calls.fetch.length, 0, url);
    assert.equal(calls.upload.length, 0, url);
    assert.equal(els.status.className, 'status err', url);
  }
});

test('an expired link tells the user to ask again; nothing is uploaded', async () => {
  const { els, calls } = run({ output: photo(), locale: 'en', fetchImpl: async () => new Response('{}', { status: 404 }) });
  els.attach.fire('click');
  await flush();
  assert.equal(calls.upload.length, 0);
  assert.equal(els.status.textContent, 'The link has expired. Ask to get the file again.');
});

test('a truncated stream is not uploaded', async () => {
  const { els, calls } = run({
    output: photo(),
    fetchImpl: async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-length': '4' } })
  });
  els.attach.fire('click');
  await flush();
  assert.equal(calls.upload.length, 0);
  assert.equal(els.status.className, 'status err');
});

test('a type ChatGPT cannot read is offered only as a download', () => {
  const out = { ...photo(), media: { kind: 'document', fileName: 'archive.zip', mimeType: 'application/zip', size: 4 } };
  const { els } = run({ output: out, locale: 'en', fetchImpl: okFetch() });
  assert.equal(els.attach.hidden, true);
  assert.equal(els.name.textContent, 'archive.zip');
  assert.match(els.status.textContent, /cannot be attached/);
});

test('file names from Telegram are shown as text only', () => {
  const out = { ...photo(), media: { kind: 'document', fileName: '<img src=x onerror=alert(1)>.pdf', mimeType: 'application/pdf', size: 4 } };
  const { els } = run({ output: out, fetchImpl: okFetch() });
  assert.equal(els.name.textContent, '<img src=x onerror=alert(1)>.pdf');
  assert.equal(els.attach.hidden, false);
});

test('without the ChatGPT bridge the card waits for the tool result from the host', async () => {
  const { els, calls } = run({ output: photo(), openai: false, fetchImpl: okFetch() });
  // No window.openai and no result yet: no buttons, nothing fetched.
  assert.equal(els.row.hidden, true);
  assert.equal(calls.fetch.length, 0);
});

test('MCP Apps handshake: ui/initialize always, then initialized and size; result via the bridge; host requests answered', () => {
  // window.openai is present (ChatGPT) and the card is embedded: the handshake must still run.
  const { els, sent, fromHost } = run({ output: null, embedded: true, fetchImpl: okFetch() });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'ui/initialize');
  assert.equal(sent[0].params.protocolVersion, '2026-01-26');
  assert.equal(sent[0].params.appInfo.name, 'postun-media-card');
  fromHost({ jsonrpc: '2.0', id: sent[0].id, result: { protocolVersion: '2026-01-26', hostContext: {} } });
  assert.equal(sent[1].method, 'ui/notifications/initialized');
  assert.equal(sent[2].method, 'ui/notifications/size-changed');
  assert.equal(JSON.stringify(sent[2].params), JSON.stringify({ width: 320, height: 140 }));
  fromHost({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: photo() } });
  assert.equal(els.row.hidden, false);
  assert.equal(els.name.textContent, 'telegram-photo.jpg');
  fromHost({ jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} }));
});
