# Postun Beta — runbook развёртывания

Операторская последовательность для своего Cloudflare-аккаунта. Реальные ID ресурсов, токены и ключи в репозиторий не попадают: они хранятся в приватном inventory оператора (см. `templates/deployment-inventory.example.json`) и в Cloudflare Secrets.

## 0. Доступ оператора

- Bootstrap-токен (создаёт владелец, срок ≤ 7 дней): Account — Workers Scripts, Workers KV Storage, D1, Cloudflare Pages: Edit; Account Settings: Read. Zone (только postun.org) — Workers Routes, DNS: Edit; Zone: Read. Без права выпуска токенов, без Global API Key.
- На macOS токен хранится в Keychain (`security add-generic-password -a "$USER" -s <keychain-item> -U -w` — ввод скрытый) и подставляется только через `scripts/ops/wrangler-keychain.sh`.
- Обычный deploy после bootstrap — отдельный токен без DNS-прав.
- Отзыв: Cloudflare → My Profile → API Tokens → Delete; `security delete-generic-password -s <keychain-item>`.

## 1. DNS с сохранением почты (до привязки Pages к apex)

1. Экспортировать текущую зону в приватную резервную копию (вне Git).
2. Добавить `mail.<домен>` A → IP почтового сервера (DNS only), перевести MX на `mail.<домен>`.
3. Поддомены почтового хостинга (autoconfig, autodiscover, webmail, cpanel и т. п.), если они CNAME на apex, перевести на `mail.<домен>`.
4. SPF/DKIM/DMARC не менять (IP почтового сервера в SPF остаётся).
5. Проверить `dig MX`, SMTPS/IMAPS до шага 2 раздела 3.

## 2. Ресурсы (создаются один раз)

```bash
scripts/ops/wrangler-keychain.sh d1 create postun-control
scripts/ops/wrangler-keychain.sh d1 create postun-admin-meta
scripts/ops/wrangler-keychain.sh kv namespace create OAUTH_KV
scripts/ops/wrangler-keychain.sh pages project create postun-web --production-branch main
```

ID записываются в приватный inventory и подставляются в `wrangler.jsonc` при deploy (не коммитятся). Production и staging используют разные ресурсы и разные секреты.

## 3. Pages (B3 — публичный beta-лендинг)

```bash
npm run build -w @postun/web
scripts/ops/wrangler-keychain.sh pages deploy apps/web/dist --project-name postun-web --branch main
```

Затем custom domains проекта: `postun.org`, `www.postun.org`, `app.postun.org` (официальная привязка Pages, не просто CNAME). До прохождения B2/B4 `status.json` держит `registration_open: false`, и кнопка подключения неактивна.

## 4. Workers (B2)

Порядок: миграции D1 → `postun-admin` → `postun-mcp` → `postun-auth` (service bindings должны указывать на существующие Workers). Секреты вводятся через `wrangler secret put <NAME>` (скрытый ввод или stdin), никогда не аргументом команды.

Ключи шифрования (32 байта, base64url) генерируются локально и сразу передаются в `wrangler secret put` через stdin; резервная копия KEK — в хранилище владельца. Потеря KEK требует повторного подключения Telegram-аккаунтов.

## 5. Проверка после выпуска

- Внешний URL, точный commit SHA и deployment ID записываются в `docs/RELEASE_STATUS.md`.
- `apps/web/status.json` меняется только по результатам приёмки.
- Откат Worker не откатывает D1/DO.
