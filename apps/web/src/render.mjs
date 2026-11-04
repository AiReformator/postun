// Pure rendering helpers shared by build and tests. No secrets, no runtime config beyond public URLs.
export const STATUSES = ['PASS', 'FAIL', 'NOT_RUN', 'UNSUPPORTED', 'BLOCKED'];
const LABEL = { PASS: 'Проверено', FAIL: 'Не работает', NOT_RUN: 'Ещё не проверено', UNSUPPORTED: 'Не поддерживается', BLOCKED: 'Заблокировано' };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function validateStatus(status) {
  if (!Array.isArray(status.features)) throw new Error('features missing');
  for (const f of status.features) {
    if (!STATUSES.includes(f.status)) throw new Error(`bad status ${f.status} for ${f.id}`);
  }
  return status;
}

/** Connecting is offered only when registration is open AND login, linking and at least one MCP client passed. */
export function connectAvailable(status) {
  const s = Object.fromEntries(status.features.map((f) => [f.id, f.status]));
  return (
    status.registration_open === true &&
    s.telegram_login === 'PASS' &&
    s.mtproto_link === 'PASS' &&
    s.read_tools === 'PASS' &&
    (s.mcp_chatgpt === 'PASS' || s.mcp_claude_code === 'PASS')
  );
}

export function statusTable(status) {
  const rows = status.features
    .map((f) => `<tr><td>${esc(f.title)}</td><td><span class="st st-${esc(f.status.toLowerCase())}">${esc(LABEL[f.status])}</span></td></tr>`)
    .join('');
  return `<table class="status"><thead><tr><th>Функция</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>`;
}
