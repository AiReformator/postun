import type { Role } from './config';

export const esc = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mu:#666;--bd:#d8d8d8;--ac:#0b5fff}
@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--mu:#9a9a9a;--bd:#333;--ac:#6ea0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
header,main{max-width:960px;margin:0 auto;padding:12px 16px}header{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--bd);flex-wrap:wrap}
.beta{border:1px solid var(--ac);color:var(--ac);border-radius:4px;padding:0 6px;font-size:12px}.sp{flex:1}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.card{border:1px solid var(--bd);border-radius:8px;padding:10px}
.card b{display:block;font-size:22px}.mu{color:var(--mu)}table{width:100%;border-collapse:collapse;display:block;overflow-x:auto}
td,th{border-bottom:1px solid var(--bd);padding:6px 8px;text-align:left;white-space:nowrap}button,a.btn{font:inherit;padding:4px 10px;border:1px solid var(--bd);border-radius:6px;background:transparent;color:var(--fg);cursor:pointer;text-decoration:none}
form{display:inline;margin:0}input[type=number]{font:inherit;padding:4px;width:12em}.note{border-left:3px solid var(--ac);padding:4px 10px;margin:12px 0}`;

export function page(nonce: string, body: string, user?: { subject: string; level: Role; csrf: string }): string {
  const hdr = user
    ? `<span class="mu">${esc(user.level)}</span><form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button>Выйти</button></form>`
    : '';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Postun Admin — Beta</title><style nonce="${esc(nonce)}">${CSS}</style></head><body><header><strong>Postun Admin</strong><span class="beta">Beta</span><span class="sp"></span>${hdr}</header><main>${body}</main></body></html>`;
}

export const loginPage = (nonce: string): string =>
  page(nonce, `<h1>Вход для администраторов</h1><p>Экспериментальная Beta-версия. Вход выполняется только через IDP; требуется проектная роль Postun и многофакторная аутентификация.</p><p><a class="btn" href="/login">Войти через IDP</a></p>`);

export const messagePage = (nonce: string, title: string, text: string): string => page(nonce, `<h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">На главную</a></p>`);

export interface DashData {
  principals: number;
  accounts: number;
  active: number;
  suspended: number;
  deleted: number;
  betaFree: number;
  month: string;
  monthSuccess: number;
  monthBytes: number;
  rows: { principal_ref: string; status: string; linked_accounts: number; plan: string; month: string; success_count: number; out_bytes: number }[];
  page: number;
  hasNext: boolean;
  quota: string | null;
}

const num = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export function bytes(n: number): string {
  const u = ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i ? v.toFixed(1) : v} ${u[i]}`;
}
const short = (ref: string): string => (ref.length > 12 ? `${ref.slice(0, 8)}…${ref.slice(-4)}` : ref);

const MESSAGES: Record<string, string> = {
  suspended: 'Принципал приостановлен.',
  resumed: 'Принципал возобновлён.',
  failed: 'Операция не выполнена. Подробности — в журнале аудита.',
  saved: 'Значение сохранено (только запись, в другие сервисы не передаётся).',
  invalid: 'Некорректные данные.'
};
export const flashText = (code: string | null): string | null => (code && Object.hasOwn(MESSAGES, code) ? (MESSAGES[code] as string) : null);

export function dashboard(nonce: string, d: DashData, u: { subject: string; level: Role; csrf: string }, flash: string | null): string {
  const canWrite = u.level !== 'postun.viewer';
  const csrf = `<input type="hidden" name="csrf" value="${esc(u.csrf)}">`;
  const card = (t: string, v: string): string => `<div class="card"><span class="mu">${esc(t)}</span><b>${esc(v)}</b></div>`;
  const rows = d.rows
    .map((r) => {
      const act = !canWrite
        ? ''
        : r.status === 'active'
          ? `<form method="post" action="/principals/suspend">${csrf}<input type="hidden" name="principalRef" value="${esc(r.principal_ref)}"><button>Приостановить</button></form>`
          : r.status === 'suspended'
            ? `<form method="post" action="/principals/resume">${csrf}<input type="hidden" name="principalRef" value="${esc(r.principal_ref)}"><button>Возобновить</button></form>`
            : '';
      return `<tr><td title="псевдонимный идентификатор">${esc(short(r.principal_ref))}</td><td>${esc(r.status)}</td><td>${num(r.linked_accounts)}</td><td>${esc(r.plan)}</td><td>${esc(r.month)}</td><td>${num(r.success_count)}</td><td>${esc(bytes(r.out_bytes))}</td><td>${act}</td></tr>`;
    })
    .join('');
  const pager = `${d.page > 0 ? `<a href="/?page=${d.page - 1}">← Назад</a> ` : ''}${d.hasNext ? `<a href="/?page=${d.page + 1}">Вперёд →</a>` : ''}`;
  const owner =
    u.level === 'postun.owner'
      ? `<h2>Бета-квота (справочно)</h2><p class="note">Желаемое значение лимита успешных вызовов в месяц. Сохраняется только здесь и не меняет конфигурацию других сервисов. Текущее: ${esc(d.quota ?? 'не задано')}.</p><form method="post" action="/settings/quota">${csrf}<input type="number" name="value" min="0" max="100000000" step="1" required> <button>Сохранить</button></form>`
      : '';
  return page(
    nonce,
    `${flash ? `<p class="note">${esc(flash)}</p>` : ''}<h1>Сводка <span class="beta">Beta</span></h1>
<div class="cards">${card('Принципалы', num(d.principals))}${card('Связанные аккаунты', num(d.accounts))}${card('Активные', num(d.active))}${card('Приостановлены', num(d.suspended))}${card('Удалены', num(d.deleted))}${card('План beta_free', num(d.betaFree))}${card(`Успешных за ${d.month}`, num(d.monthSuccess))}${card(`Исходящий трафик за ${d.month}`, bytes(d.monthBytes))}</div>
<h2>Принципалы</h2><p class="mu">Псевдонимные идентификаторы. Данные Telegram, переписка и файлы здесь недоступны.</p>
<table><thead><tr><th>ID</th><th>Статус</th><th>Аккаунты</th><th>План</th><th>Месяц</th><th>Успешных</th><th>Трафик</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="mu">Данных пока нет</td></tr>'}</tbody></table><p>${pager}</p>${owner}`,
    u
  );
}
