# Postun Beta — runbook развёртывания

Последовательность для собственного аккаунта Cloudflare. Архитектурный контекст — [04_DEPLOYMENT.md](04_DEPLOYMENT.md). Реальные ID ресурсов, токены и ключи в репозиторий не попадают: ID хранятся в вашем приватном inventory (образец — `templates/deployment-inventory.example.json`) или в локальном `wrangler.private.jsonc` (в Git не попадает), секреты — в Cloudflare Secrets. Во всех командах `<your-domain>` — ваш домен.

## 0. Доступ

- Токен Cloudflare для bootstrap: Account — Workers Scripts, Workers KV Storage, D1: Edit; Account Settings: Read. Zone (только ваша зона) — Workers Routes, DNS: Edit; Zone: Read. Срок — короткий; без права выпуска токенов, без Global API Key.
- Токен передаётся через переменную окружения `CLOUDFLARE_API_TOKEN` из вашего защищённого хранилища (не аргументом команды, не в Git, не в логах CI).
- Для обычного deploy после bootstrap используйте отдельный токен без прав на DNS.
- Отзыв: Cloudflare Dashboard → My Profile → API Tokens → Delete.

## 1. DNS (до привязки домена к сайту)

1. Сохраните экспорт текущей зоны в приватную резервную копию вне Git.
2. Не меняйте MX, SPF, DKIM, DMARC, CAA и посторонние записи. Если почтовые поддомены были CNAME на apex, который вы собираетесь отдать Cloudflare, перенесите их на отдельное имя заранее и проверьте доставку (`dig MX`, SMTPS/IMAPS).
3. Удалите конфликтующие записи (старый A/AAAA/CNAME) на именах, которые привязываются как custom domain.

## 2. Ресурсы (создаются один раз)

```bash
npx wrangler d1 create postun-control
npx wrangler d1 create postun-admin-meta
npx wrangler kv namespace create OAUTH_KV
```

Для staging создайте отдельные ресурсы (`postun-control-staging`, `postun-admin-meta-staging`, отдельный KV). Полученные ID подставьте в локальную копию конфигов (`wrangler.private.jsonc`, `-c wrangler.private.jsonc`) вместо `REPLACE_WITH_…` и не коммитьте. Production и staging используют разные ресурсы и разные секреты.

Публичный сайт — Workers static assets (`apps/web/wrangler.jsonc`: без кода и привязок, логи выключены, без `workers.dev` и preview). Не используйте `wrangler pages project create`: он создаёт Worker со static assets и включает observability; используйте конфиг из репозитория.

## 3. Секреты

Выполняйте после первого deploy из раздела 5 (шаг bootstrap): `wrangler secret put` для ещё не созданного Worker предложит создать пустой Worker, поэтому проще сначала выпустить Workers, а затем задать секреты. Секреты задаются для каждого Worker и каждой среды (`--env staging` для staging), значение — скрытым вводом или через stdin:

```bash
cd apps/auth
npx wrangler secret put TELEGRAM_OIDC_CLIENT_ID
npx wrangler secret put TELEGRAM_OIDC_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put IDENTITY_INDEX_HMAC_KEY
openssl rand -base64 32 | npx wrangler secret put IDENTITY_ENCRYPTION_KEY
openssl rand -base64 32 | npx wrangler secret put WEB_SESSION_KEY
```

Аналогично для `apps/mcp`: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `SESSION_KEK`, `SESSION_KEK_VERSION` (метка вида `k1`), `CURSOR_HMAC_KEY`; для `apps/admin`: `ADMIN_OIDC_CLIENT_SECRET`, `ADMIN_SESSION_KEY` (раздел 6).

Ключи (32 байта, base64/base64url) генерируйте локально и сразу передавайте через stdin; не печатайте их в терминал и не сохраняйте в историю. Резервную копию KEK (`SESSION_KEK`) храните отдельно от Cloudflare: её потеря требует повторного подключения Telegram-аккаунтов.

## 4. Публичный сайт

```bash
cd apps/web
npm run build        # из чистого дерева: в /status.json попадёт commit и dirty=false
npx wrangler deploy --message "Postun Beta site <sha>"
```

Custom domains (в репозитории: `postun.org`, `www.postun.org`, `app.postun.org`) задаются в `routes` конфига; в своей установке замените их на `<your-domain>`. До прохождения приёмки держите в `status.json` `registration_open: false`: кнопка подключения неактивна.

## 5. Workers

Миграции D1 выполняются из каталога приложения, где объявлены привязка базы и `migrations_dir`:

```bash
(cd apps/auth  && npx wrangler d1 migrations apply postun-control --remote)
(cd apps/admin && npx wrangler d1 migrations apply postun-admin-meta --remote)
```

Service bindings образуют цикл: `postun-admin` → `postun-auth` (`CONTROL`), `postun-mcp` → `postun-auth` (`AUTH`) и `postun-admin` (`ADMIN_SINK`), `postun-auth` → `postun-mcp` (`VAULT`). Wrangler не выпустит Worker, если целевой Worker ещё не существует, поэтому первый выпуск выполняется в два прохода:

1. Bootstrap. В локальных копиях `wrangler.private.jsonc` каждого из трёх приложений временно уберите блок `services` и выпустите Workers: `(cd apps/auth && npx wrangler deploy -c wrangler.private.jsonc)`, затем так же `apps/mcp` и `apps/admin`. Пока не заданы секреты и привязки, Workers отвечают ошибкой (обычно 503); это ожидаемо.
2. Задайте секреты (раздел 3 и 6), верните блоки `services` и выпустите все три Worker повторно в любом порядке. Последующие релизы выполняются одним проходом.

```bash
(cd apps/auth  && npx wrangler deploy)
(cd apps/mcp   && npx wrangler deploy)
(cd apps/admin && npx wrangler deploy)
```

Для staging добавьте `--env staging` и используйте staging-имена баз (`postun-control-staging`, `postun-admin-meta-staging`). Миграции выполняются отдельным шагом релиза, не из сборки UI; схему меняйте по схеме expand → совместимый код → backfill → проверка → contract (см. [04_DEPLOYMENT.md](04_DEPLOYMENT.md) §7). Откат Worker не откатывает D1/DO.

Маршруты: в `wrangler.jsonc` каждого Worker закомментирован шаблон `routes` с `custom_domain: true`; раскомментируйте и подставьте свои имена `<your-domain>` перед deploy.

### Обязательные переменные (`vars`)

Плоские значения заданы в `wrangler.jsonc` каждого Worker (образец — файлы в репозитории); пропуск обязательной переменной даёт ответ 503 (fail-closed).

- `postun-auth`: `APP_ENV`, `AUTH_ISSUER`, `APP_ORIGIN`, `PUBLIC_SITE_URL`, `MCP_RESOURCE`, `REGISTRATION_OPEN`, `TELEGRAM_OIDC_REQUIRE_NONCE` и `BETA_TERMS_VERSION` (версия принимаемых условий беты; без неё конфигурация не загружается и Worker отвечает 503).
- `postun-mcp`: `APP_ENV`, `MCP_RESOURCE`, `AUTH_ISSUER`, `BETA_MONTHLY_SUCCESS_LIMIT`, `MAX_FILE_BYTES` (`0` отключает скачивание файлов), `FEATURE_CHANNELS` (`on`/`off`), `TELEGRAM_ADAPTER` (`mtcute` или `synthetic` для тестов); необязательные `BETA_DAILY_SUCCESS_LIMIT` и `BETA_MONTHLY_BYTE_LIMIT`.
- `postun-admin`: `APP_ENV`, `ADMIN_ORIGIN` и параметры `ADMIN_OIDC_*` из раздела 6.

## 5a. Допуск тестеров при закрытой регистрации

Пока `REGISTRATION_OPEN=false`, новые профили создаются только для числовых Telegram ID из необязательного секрета `BETA_TESTER_TELEGRAM_IDS` (через запятую; сверяется с claim `id`, не с `sub`). Некорректный список выключает вход целиком (503).

```bash
cd apps/auth
npx wrangler secret put BETA_TESTER_TELEGRAM_IDS   # например: 123456789,987654321
```

## 6. OIDC-провайдер администраторов

В вашем OIDC-провайдере создайте:

- проект или аудиторию с ролями `postun.viewer`, `postun.operator`, `postun.owner` (роль проверяется при входе);
- конфиденциальный веб-клиент: grant types `authorization_code` и `refresh_token`, аутентификация клиента `basic` (или `post`, тогда `ADMIN_OIDC_CLIENT_AUTH=post`), PKCE S256, redirect URI `https://<admin-host>/oidc/callback`, роли передаются в ID-токене или userinfo в claim, имя которого вы укажете в `ADMIN_OIDC_ROLES_CLAIM`;
- MFA для администраторов: ID-токен должен нести `amr` из `ADMIN_MFA_AMR_VALUES` (по умолчанию `mfa,otp,hwk,swk,pop`; `ADMIN_REQUIRE_MFA_AMR=true`).

Клиент должен иметь минимальные права: он не управляет самим провайдером. Затем задайте параметры `apps/admin` (образец — `apps/admin/.dev.vars.example`):

```bash
cd apps/admin
npx wrangler secret put ADMIN_OIDC_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put ADMIN_SESSION_KEY
# Остальные значения — secret или vars: ADMIN_OIDC_ISSUER, ADMIN_OIDC_CLIENT_ID,
# ADMIN_OIDC_SCOPES, ADMIN_OIDC_ROLES_CLAIM, ADMIN_ORIGIN,
# ADMIN_OIDC_ROLES_TENANT и ADMIN_OIDC_EXTRA_AUDIENCE (обязательны; значение none явно отключает проверку).
```

Пока любое обязательное значение не задано, admin отвечает 503. Подробности — [06_ADMIN_OIDC.md](06_ADMIN_OIDC.md).

## 7. Проверка после выпуска

- Внешний URL отвечает по HTTPS; запомните точный commit SHA и deployment ID у себя (в приватном inventory).
- Проверьте OAuth-вход, холодный старт и чтение из реального MCP-клиента (Claude Code, ChatGPT, Claude); критерии — [05_ACCEPTANCE.md](05_ACCEPTANCE.md).
- Убедитесь, что production и staging используют разные D1/KV/DO/секреты и что у `postun-admin` нет привязок к хранилищу сессий и OAuth.
- Статусы функций в `apps/web/status.json` (на сайте: `/#status`) меняются только по результатам приёмки.
- Помните: откат Worker не откатывает D1/DO.
