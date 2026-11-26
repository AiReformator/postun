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

function run({ output, meta = null, locale = 'ru', fetchImpl, openai = true, embedded = false, hostCapabilities, reply = () => ({}), upload, widgetState = null }) {
  const html = mediaWidgetHtml(ORIGIN);
  const code = /<script type="module">([\s\S]*)<\/script>/.exec(html)[1];
  const els = Object.fromEntries(['card', 'label', 'name', 'meta', 'row', 'attach', 'save', 'dl', 'status', 'diag'].map((i) => [i, el(i)]));
  els.row.hidden = true; // the page starts with the buttons hidden
  const calls = { fetch: [], upload: [], state: [], followUp: [] };
  const api = openai
    ? {
        locale,
        toolOutput: output,
        toolResponseMetadata: meta,
        widgetState,
        uploadFile: async (file, opts) => {
          calls.upload.push({ name: file.name, type: file.type, size: file.size, ...(opts ? { opts } : {}) });
          return upload ? upload(file, opts) : { fileId: 'file-synthetic-1' };
        },
        setWidgetState: (s) => calls.state.push(s),
        sendFollowUpMessage: async (m) => calls.followUp.push(m)
      }
    : undefined;
  const listeners = {};
  const sent = [];
  const window = { openai: api, addEventListener: (t, f) => (listeners[t] = f), parent: null };
  const fromHost = (data) => listeners.message?.({ source: window.parent, data });
  // A scripted host: answers ui/initialize with hostCapabilities (when given) and every later request with reply().
  window.parent = embedded
    ? {
        postMessage: (m) => {
          const msg = JSON.parse(JSON.stringify(m));
          sent.push(msg);
          if (hostCapabilities === undefined || msg.id === undefined || msg.result !== undefined) return;
          const result = msg.method === 'ui/initialize' ? { protocolVersion: '2026-01-26', hostCapabilities } : reply(msg);
          setTimeout(() => fromHost(result && result.error ? { jsonrpc: '2.0', id: msg.id, error: result.error } : { jsonrpc: '2.0', id: msg.id, result }), 0);
        }
      }
    : window;
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
    crypto: globalThis.crypto,
    btoa,
    URL,
    setTimeout,
    clearTimeout,
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

const methods = (sent) => sent.map((m) => m.method).filter(Boolean);

test('ChatGPT path: capability read from widget-only _meta; host with ui/message image support gets the image itself', async () => {
  const hidden = { ...photo(), download: { url: GOOD_URL, expiresAt: '2030-01-01T00:00:00.000Z', note: 'card only' } };
  const { els, calls, sent } = run({
    output: hidden,
    meta: { 'postun/download': { url: GOOD_URL, authorization: CAP, expiresAt: '2030-01-01T00:00:00.000Z' } },
    embedded: true,
    hostCapabilities: { message: { text: {}, image: {} } },
    fetchImpl: okFetch()
  });
  await flush();
  assert.notEqual(els.status.className, 'status err', 'the card must accept the _meta capability');
  els.attach.fire('click');
  await flush();
  assert.equal(calls.fetch[0].init.headers.authorization, CAP);
  const msg = sent.find((m) => m.method === 'ui/message');
  assert.ok(msg, 'ui/message sent');
  assert.equal(msg.params.role, 'user');
  assert.equal(msg.params.content[1].type, 'image');
  assert.equal(msg.params.content[1].mimeType, 'image/jpeg');
  assert.equal(msg.params.content[1].data, 'AQIDBA==');
  assert.match(msg.params.content[0].text, /telegram-photo\.jpg/);
  assert.equal(calls.upload.length, 0, 'no legacy upload');
  assert.equal(calls.followUp.length, 0, 'no second message');
  assert.match(els.diag.textContent, /^ui\/message/);
  // A second click sends nothing more.
  els.attach.fire('click');
  await flush();
  assert.equal(methods(sent).filter((m) => m === 'ui/message').length, 1);
});

test('host that takes images only as model context: update-model-context with the image, then one text message', async () => {
  const { els, calls, sent } = run({
    output: photo(),
    embedded: true,
    hostCapabilities: { message: { text: {} }, updateModelContext: { image: {}, text: {} } },
    fetchImpl: okFetch()
  });
  await flush();
  els.attach.fire('click');
  await flush();
  const ctx = sent.find((m) => m.method === 'ui/update-model-context');
  assert.equal(ctx.params.content[0].type, 'image');
  const msgs = sent.filter((m) => m.method === 'ui/message');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].params.content.length, 1);
  assert.equal(calls.upload.length, 0);
  assert.match(els.diag.textContent, /^ui\/update-model-context/);
});

test('a host error on ui/message falls back to the next way instead of failing', async () => {
  const { els, calls } = run({
    output: photo(),
    embedded: true,
    hostCapabilities: { message: { text: {}, image: {} } },
    reply: (m) => (m.method === 'ui/message' ? { error: { code: -32000, message: 'no' } } : {}),
    fetchImpl: okFetch()
  });
  await flush();
  els.attach.fire('click');
  await flush();
  assert.equal(calls.upload.length, 1, 'legacy upload used');
  assert.match(els.diag.textContent, /^uploadFile/);
});

test('a PDF goes as an embedded resource block', async () => {
  const pdf = { ...photo(), media: { kind: 'document', fileName: 'scan.pdf', mimeType: 'application/pdf', size: 4 } };
  const { els, sent } = run({ output: pdf, embedded: true, hostCapabilities: { message: { text: {}, resource: {} } }, fetchImpl: okFetch() });
  await flush();
  els.attach.fire('click');
  await flush();
  const msg = sent.find((m) => m.method === 'ui/message');
  assert.equal(msg.params.content[1].type, 'resource');
  assert.equal(msg.params.content[1].resource.mimeType, 'application/pdf');
  assert.equal(msg.params.content[1].resource.blob, 'AQIDBA==');
});

// sha256 of [1, 2, 3, 4]
const SHA_1234 = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';
const zip = () => ({ ...photo(), media: { kind: 'document', fileName: 'Полное досье.zip', mimeType: 'application/zip', size: 4 } });

test('Save to ChatGPT files: any type, uploadFile with library: true, file id + size + SHA-256 to the model, once', async () => {
  const { els, calls } = run({ output: zip(), fetchImpl: okFetch() });
  assert.equal(els.save.hidden, false);
  assert.equal(els.save.textContent, 'Сохранить в файлы ChatGPT');
  assert.equal(els.attach.hidden, true, 'a zip still cannot be attached');
  els.save.fire('click');
  await flush();
  assert.equal(JSON.stringify(calls.upload), JSON.stringify([{ name: 'Полное досье.zip', type: 'application/zip', size: 4, opts: { library: true } }]));
  const st = calls.state.at(-1);
  assert.match(st.modelContent, /file id file-synthetic-1, 4 bytes, SHA-256 [0-9a-f]{64}/);
  assert.ok(st.modelContent.includes(SHA_1234));
  assert.equal(st.imageIds, undefined, 'non-image types are not sent as imageIds');
  assert.equal(JSON.stringify(st.privateContent), JSON.stringify({ attached: false, saved: true }));
  assert.match(calls.followUp[0].prompt, /file id file-synthetic-1/);
  assert.ok(calls.followUp[0].prompt.includes(SHA_1234));
  assert.equal(els.status.textContent, 'Сохранено в ваши файлы ChatGPT.');
  assert.equal(els.save.disabled, true);
  els.save.fire('click');
  await flush();
  assert.equal(calls.upload.length, 1, 'no second upload');
});

test('a saved PDF also goes to the model as imageIds; attach after save keeps the saved flag', async () => {
  const pdf = { ...photo(), media: { kind: 'document', fileName: 'scan.pdf', mimeType: 'application/pdf', size: 4 } };
  const { els, calls, sent } = run({ output: pdf, embedded: true, hostCapabilities: { message: { text: {}, resource: {} } }, fetchImpl: okFetch() });
  await flush();
  els.save.fire('click');
  await flush();
  assert.equal(JSON.stringify(calls.state.at(-1).imageIds), JSON.stringify(['file-synthetic-1']));
  els.attach.fire('click');
  await flush();
  assert.ok(sent.find((m) => m.method === 'ui/message'));
  assert.equal(JSON.stringify(calls.state.at(-1).privateContent), JSON.stringify({ attached: true, saved: true }));
  assert.equal(calls.fetch.length, 1, 'the file is fetched from Telegram once');
});

test('Save is not offered without ChatGPT uploadFile, and a refused upload says so', async () => {
  const none = run({ output: photo(), openai: false, embedded: true, hostCapabilities: {}, fetchImpl: okFetch() });
  none.fromHost({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: photo() } });
  assert.equal(none.els.save.hidden, true);
  const { els, calls } = run({ output: zip(), locale: 'en', fetchImpl: okFetch(), upload: async () => { throw new Error('too large'); } });
  els.save.fire('click');
  await flush();
  assert.equal(calls.state.length, 0);
  assert.equal(calls.followUp.length, 0);
  assert.equal(els.status.textContent, 'ChatGPT did not accept the file; you can download it.');
  assert.equal(els.status.className, 'status err');
  assert.equal(els.save.disabled, false, 'the user can try again');
});

test('a card that was already saved shows it after a reload and does not upload again', async () => {
  const { els, calls } = run({ output: zip(), locale: 'en', fetchImpl: okFetch(), widgetState: { privateContent: { saved: true } } });
  assert.equal(els.status.textContent, 'Saved to your ChatGPT files.');
  assert.equal(els.save.disabled, true);
  els.save.fire('click');
  await flush();
  assert.equal(calls.upload.length, 0);
});
