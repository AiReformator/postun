// Postun Beta cabinet. Talks only to the auth origin with credentialed fetch; holds no tokens in storage.
// All server text is inserted with textContent (no innerHTML with dynamic data).
import { encodeQR } from 'qr';

const root = document.getElementById('app');
const AUTH = root.dataset.auth;
let csrf = '';

const SCOPE_TITLES = {
  'accounts:read': 'список аккаунтов',
  'dialogs:read': 'список диалогов',
  'messages:read': 'история и поиск',
  'channels:read': 'публичные каналы',
  'media:read': 'файлы'
};
const LINK_ERRORS = {
  EXPIRED: 'QR-код истёк. Начните подключение заново.',
  PASSWORD_INVALID: 'Неверный пароль двухэтапной проверки.',
  RATE_LIMITED: 'Telegram попросил подождать. Повторите позже.',
  NOT_ALLOWED: 'Этот аккаунт нельзя подключить к профилю.',
  CANCELLED: 'Подключение отменено.',
  UPSTREAM: 'Telegram временно недоступен. Повторите позже.'
};

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = csrf;
  }
  const res = await fetch(AUTH + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || 'Ошибка запроса');
    err.code = data.error && data.error.code;
    err.reason = data.error && data.error.reason;
    throw err;
  }
  return data;
}

function show(...nodes) {
  root.replaceChildren(...nodes);
}

function errorBox(e) {
  return el('p', { class: 'err' }, e.message || 'Ошибка');
}

function qrNode(text) {
  const svg = encodeQR(text, 'svg', { ecc: 'medium', border: 1 });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const node = document.importNode(doc.documentElement, true);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', 'QR-код для входа в Telegram');
  return el('div', { class: 'qr' }, node);
}

async function main() {
  let s;
  try {
    s = await api('/api/session');
  } catch {
    show(el('p', { class: 'err' }, 'Сервис входа сейчас недоступен. Это бета — попробуйте позже.'));
    return;
  }
  if (!s.authenticated) {
    const intro = el('p', {}, 'Войдите через Telegram, чтобы управлять подключениями. Номер телефона не запрашивается.');
    const btn = s.registrationOpen
      ? el('a', { class: 'btn', href: s.loginUrl }, 'Войти через Telegram')
      : el('button', { class: 'btn', disabled: '' }, 'Войти через Telegram');
    const note = s.registrationOpen ? '' : el('p', { class: 'note' }, 'Регистрация бета-тестеров ещё не открыта: идёт проверка безопасности и подключений.');
    show(intro, btn, note);
    return;
  }
  csrf = s.csrfToken;
  if (s.termsRequired) {
    show(
      el('p', {}, 'Перед подключением подтвердите участие в экспериментальной бете и передачу выбранных данных вашему ИИ-провайдеру.'),
      el('a', { class: 'btn', href: s.termsUrl }, 'Открыть условия беты')
    );
    return;
  }
  await renderDashboard();
}

async function renderDashboard() {
  const [acc, grants, usage] = await Promise.all([
    api('/api/accounts').catch((e) => ({ error: e })),
    api('/api/grants').catch((e) => ({ error: e })),
    api('/api/usage').catch((e) => ({ error: e }))
  ]);

  const sections = [];
  sections.push(el('p', { class: 'note' }, 'Postun — экспериментальный сервис. Доступны только функции, отмеченные «Проверено» на главной странице.'));

  // Quota
  const u = usage.usage;
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, 'Квота беты'),
      u ? el('p', {}, `Месяц ${u.month}: ${u.successCount} из ${u.monthlySuccessLimit} успешных операций. Передано байтов: ${u.outBytes}.`) : errorBox(usage.error)
    )
  );

  // Accounts
  const accList = el('ul', { class: 'plain' });
  for (const a of acc.accounts || []) {
    accList.append(
      el('li', {},
        `${a.label} — ${a.status === 'active' ? 'подключён' : a.status === 'pending' ? 'подключается' : a.status} `,
        el('button', { class: 'btn secondary', onclick: () => disconnect(a) }, 'Отключить')
      )
    );
  }
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, 'Telegram-аккаунты'),
      acc.error ? errorBox(acc.error) : (acc.accounts || []).length ? accList : el('p', { class: 'note' }, 'Аккаунты не подключены.'),
      el('button', { class: 'btn', onclick: () => startLink() }, 'Подключить аккаунт по QR'),
      el('p', { class: 'note' }, 'Для бета-теста используйте отдельный тестовый аккаунт.')
    )
  );

  // Grants
  const gl = el('ul', { class: 'plain' });
  for (const g of grants.grants || []) {
    const scopes = (g.scopes || []).map((x) => SCOPE_TITLES[x] || x).join(', ');
    gl.append(
      el('li', {},
        `${g.clientName}: ${scopes}; аккаунтов: ${(g.accounts || []).length} `,
        el('button', { class: 'btn secondary', onclick: () => revoke(g) }, 'Отозвать')
      )
    );
  }
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, 'Разрешённые ИИ-клиенты'),
      grants.error ? errorBox(grants.error) : (grants.grants || []).length ? gl : el('p', { class: 'note' }, 'Нет выданных разрешений.'),
      el('p', { class: 'note' }, 'Адрес MCP-сервера: https://mcp.postun.org/mcp. Новые аккаунты не добавляются в старые разрешения автоматически.')
    )
  );

  // Profile
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, 'Профиль'),
      el('button', { class: 'btn secondary', onclick: logout }, 'Выйти'),
      ' ',
      el('button', { class: 'btn secondary', onclick: deleteProfile }, 'Удалить профиль')
    )
  );
  show(...sections);
}

async function startLink() {
  try {
    const r = await api('/api/accounts/link', { method: 'POST', body: {} });
    await pollLink(r.accountId, r.link);
  } catch (e) {
    show(errorBox(e), el('button', { class: 'btn', onclick: main }, 'Назад'));
  }
}

async function pollLink(accountId, state) {
  let lastQr = '';
  for (;;) {
    if (state.state === 'active') {
      show(el('p', {}, 'Аккаунт подключён.'), el('button', { class: 'btn', onclick: main }, 'В кабинет'));
      return;
    }
    if (state.state === 'failed') {
      show(el('p', { class: 'err' }, LINK_ERRORS[state.code] || 'Подключение не удалось.'), el('button', { class: 'btn', onclick: main }, 'В кабинет'));
      return;
    }
    if (state.state === 'need_password') {
      await askPassword(accountId, state.hint);
      return;
    }
    if (state.state === 'waiting_scan' && state.qrUrl !== lastQr) {
      lastQr = state.qrUrl;
      show(
        el('h2', {}, 'Отсканируйте QR в Telegram'),
        el('p', {}, 'Telegram → Настройки → Устройства → Подключить устройство.'),
        qrNode(state.qrUrl),
        el('p', { class: 'note' }, 'Код обновляется автоматически. Никому не пересылайте его.')
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
    state = await api(`/api/accounts/${accountId}/link-status`).catch((e) => ({ state: 'failed', code: e.code }));
  }
}

function askPassword(accountId, hint) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Пароль двухэтапной проверки' });
    const form = el('form', {
      onsubmit: async (ev) => {
        ev.preventDefault();
        const password = input.value;
        input.value = '';
        const st = await api(`/api/accounts/${accountId}/password`, { method: 'POST', body: { password } }).catch((e) => ({ state: 'failed', code: e.code }));
        resolve(pollLink(accountId, st));
      }
    }, input, ' ', el('button', { class: 'btn', type: 'submit' }, 'Продолжить'));
    show(
      el('h2', {}, 'Двухэтапная проверка'),
      el('p', {}, 'Введите облачный пароль Telegram. Он используется один раз и не сохраняется.'),
      hint ? el('p', { class: 'note' }, `Подсказка: ${hint}`) : '',
      form
    );
    input.focus();
  });
}

async function disconnect(a) {
  if (!confirm(`Отключить «${a.label}»? Сессия Telegram будет завершена, разрешения на этот аккаунт перестанут работать.`)) return;
  await api(`/api/accounts/${a.accountId}/disconnect`, { method: 'POST', body: {} }).catch((e) => alert(e.message));
  main();
}

async function revoke(g) {
  if (!confirm(`Отозвать доступ клиента «${g.clientName}»? Клиенту придётся подключиться заново.`)) return;
  await api(`/api/grants/${g.grantId}/revoke`, { method: 'POST', body: {} }).catch((e) => alert(e.message));
  main();
}

async function logout() {
  await api('/logout', { method: 'POST', body: {} }).catch(() => undefined);
  main();
}

async function deleteProfile() {
  const phrase = prompt('Удаление профиля отключит все аккаунты и клиенты. Удалённые данные не восстанавливаются. Введите: УДАЛИТЬ ПРОФИЛЬ');
  if (phrase === null) return;
  await api('/api/profile/delete', { method: 'POST', body: { confirm: phrase } })
    .then(() => main())
    .catch((e) => alert(e.reason === 'CONFIRM_PHRASE' ? 'Фраза не совпала — профиль не удалён.' : e.message));
}

main();
