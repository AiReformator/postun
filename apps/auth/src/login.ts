import { clearHostCookie, hostCookie, newId, PostunError, randomToken, readCookie, sha256, telegramIdIndex, timingSafeEqual, toBase64Url, utf8 } from '@postun/contracts';
import type { Config, Env } from './env';
import { now } from './env';
import { errorPage, esc, html, page, redirect } from './http';
import { encryptTelegramId, loadKeys } from './keys';
import { assertCsrf, createSession, getSession } from './sessions';
import { authorizeUrl, exchangeCode, verifyIdToken } from './telegram';

const LOGIN_COOKIE = '__Host-postun_login';
const LOGIN_TTL = 600;

const sha = async (v: string): Promise<string> => toBase64Url(await sha256(utf8(v)));

/** Only in-app return targets are accepted: the OAuth authorize endpoint (with its query) or nothing. */
export function safeReturn(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 4096 || !raw.startsWith('/authorize') || raw.includes('\\') || raw.startsWith('//')) return null;
  if (raw !== '/authorize' && !raw.startsWith('/authorize?')) return null;
  return /^[\x21-\x7e]+$/.test(raw) ? raw : null;
}

export async function handleLogin(env: Env, cfg: Config, url: URL): Promise<Response> {
  await loadKeys(cfg); // fail closed on bad key material before sending anyone to Telegram
  const state = randomToken(32);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const binder = randomToken(32);
  const t = now();
  await env.CONTROL_DB.prepare(
    'INSERT INTO login_states (state_hash, binder_hash, nonce, code_verifier, return_to, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
  )
    .bind(await sha(state), await sha(binder), nonce, verifier, safeReturn(url.searchParams.get('return')), t, t + LOGIN_TTL)
    .run();
  return redirect(await authorizeUrl(cfg, { state, nonce, verifier }), [hostCookie(LOGIN_COOKIE, binder, { maxAge: LOGIN_TTL })]);
}

function loginFailed(message: string, status = 400): Response {
  return html(page('Вход', `<p class="warn">${esc(message)}</p><p><a href="/login">Войти заново</a></p>`), status, {}, []);
}

export async function handleCallback(env: Env, cfg: Config, req: Request, url: URL): Promise<Response> {
  const clear = clearHostCookie(LOGIN_COOKIE);
  const withClear = (r: Response): Response => {
    r.headers.append('set-cookie', clear);
    return r;
  };
  const state = url.searchParams.get('state');
  const binder = readCookie(req, LOGIN_COOKIE);
  if (!state || !binder || state.length > 256) return withClear(loginFailed('Сессия входа не найдена, истекла или уже использована. Начните вход заново.'));

  // Single use: the row is consumed (deleted) whether or not the rest succeeds.
  const row = await env.CONTROL_DB.prepare(
    'DELETE FROM login_states WHERE state_hash = ?1 RETURNING binder_hash, nonce, code_verifier, return_to, expires_at'
  )
    .bind(await sha(state))
    .first<{ binder_hash: string; nonce: string; code_verifier: string; return_to: string | null; expires_at: number }>();
  if (!row || row.expires_at <= now() || !timingSafeEqual(utf8(row.binder_hash), utf8(await sha(binder)))) {
    return withClear(loginFailed('Сессия входа не найдена, истекла или уже использована. Начните вход заново.'));
  }
  if (url.searchParams.has('error')) return withClear(loginFailed('Вход через Telegram отменён или не подтверждён.'));
  const code = url.searchParams.get('code');
  if (!code || code.length > 2048) return withClear(loginFailed('Некорректный ответ Telegram.'));

  let identity;
  try {
    const idToken = await exchangeCode(cfg, code, row.code_verifier);
    identity = await verifyIdToken(cfg, idToken, row.nonce);
  } catch (err) {
    if (err instanceof PostunError && err.code === 'UPSTREAM_UNAVAILABLE') return withClear(loginFailed('Telegram временно недоступен. Попробуйте ещё раз.', 502));
    return withClear(loginFailed('Не удалось подтвердить вход через Telegram.', 401));
  }

  const keys = await loadKeys(cfg);
  const db = env.CONTROL_DB;
  const find = (): Promise<{ principal_id: string; status: string } | null> =>
    db.prepare('SELECT principal_id, status FROM principals WHERE oidc_issuer = ?1 AND oidc_subject = ?2').bind(identity.issuer, identity.subject).first();
  let principal = await find();
  if (!principal) {
    if (!cfg.registrationOpen && !cfg.betaTesterIds.has(identity.telegramId)) {
      return withClear(
        html(page('Бета пока закрыта', '<p>Регистрация в бета-тестировании Postun пока не открыта. Загляните позже.</p>'), 403)
      );
    }
    const principalId = newId();
    await db
      .prepare(
        `INSERT INTO principals (principal_id, oidc_issuer, oidc_subject, primary_telegram_id_hmac, telegram_id_enc, status, plan, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', 'beta_free', ?6) ON CONFLICT (oidc_issuer, oidc_subject) DO NOTHING`
      )
      .bind(
        principalId,
        identity.issuer,
        identity.subject,
        await telegramIdIndex(keys.identityHmac, identity.telegramId),
        await encryptTelegramId(keys.identityEnc, principalId, identity.telegramId),
        now()
      )
      .run();
    principal = await find();
  }
  if (!principal || principal.status === 'deleted') return withClear(loginFailed('Не удалось завершить вход.', 403));

  const cookie = await createSession(env, cfg, principal.principal_id);
  const accepted = await db
    .prepare('SELECT accepted_terms_version FROM principals WHERE principal_id = ?1')
    .bind(principal.principal_id)
    .first<{ accepted_terms_version: string | null }>();
  const ret = safeReturn(row.return_to);
  const dest = accepted?.accepted_terms_version === cfg.termsVersion ? (ret ? `${cfg.authIssuer}${ret}` : cfg.appOrigin) : `${cfg.authIssuer}/terms${ret ? `?return=${encodeURIComponent(ret)}` : ''}`;
  return redirect(dest, [cookie, clear]);
}

export async function handleTermsGet(env: Env, cfg: Config, req: Request, url: URL): Promise<Response> {
  const session = await getSession(env, cfg, req);
  if (!session) return redirect(`${cfg.authIssuer}/login`);
  const ret = safeReturn(url.searchParams.get('return')) ?? '';
  return html(
    page(
      'Условия беты',
      `<p>Postun — экспериментальный проект в открытом бета-тестировании. Доступность не гарантируется, функции могут меняться.</p>
<div class="box"><ul>
<li>Postun читает ваши сообщения Telegram только по вашим запросам через выбранного ИИ-клиента и не ведёт архив переписки.</li>
<li>Сессия Telegram хранится в зашифрованном виде; шифрование не делает сервис «нулевого знания».</li>
<li>Вы можете отключить аккаунт, отозвать доступ клиента или удалить профиль в любой момент.</li>
</ul>
<p><a href="${esc(cfg.publicSiteUrl)}/terms/">Полные условия беты</a> · <a href="${esc(cfg.publicSiteUrl)}/privacy/">Обработка данных</a></p></div>
<form method="post" action="/terms">
<input type="hidden" name="_csrf" value="${esc(session.csrf)}"><input type="hidden" name="return" value="${esc(ret)}">
<label><input type="checkbox" name="accept" value="yes" required> Я прочитал(а) и принимаю условия бета-тестирования (версия ${esc(cfg.termsVersion)})</label>
<p><button type="submit">Продолжить</button></p></form>`
    ),
    200,
    {},
    [cfg.appOrigin]
  );
}

export async function handleTermsPost(env: Env, cfg: Config, req: Request): Promise<Response> {
  const session = await getSession(env, cfg, req);
  if (!session) return redirect(`${cfg.authIssuer}/login`);
  const form = await req.formData();
  assertCsrf(req, cfg, session, String(form.get('_csrf') ?? ''));
  if (form.get('accept') !== 'yes') return html(errorPage('INVALID_INPUT', 'Нужно принять условия, чтобы продолжить.'), 400);
  await env.CONTROL_DB.prepare("UPDATE principals SET accepted_terms_version = ?2, accepted_terms_at = ?3 WHERE principal_id = ?1 AND status IN ('active', 'suspended')")
    .bind(session.principalId, cfg.termsVersion, now())
    .run();
  const ret = safeReturn(String(form.get('return') ?? ''));
  return redirect(ret ? `${cfg.authIssuer}${ret}` : cfg.appOrigin);
}
