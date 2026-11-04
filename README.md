# Postun Beta

**Connected, not collected.**

Postun — экспериментальный открытый MCP-коннектор для подключения собственного Telegram-аккаунта к ChatGPT, Claude Code и другим совместимым ИИ-клиентам. Приглашаем бета-тестеров проверять подключение, чтение переписки, поиск и передачу документов.

**Сайт публичной беты:** https://postun.org  
**Репозиторий:** https://github.com/AiReformator/postun  
**Редакция документации:** 2.0-beta, 04.11.2026.

## Что это за комплект

Репозиторий содержит спецификацию и реализацию Postun Beta. Наличие кода не означает завершённого развёртывания. Работоспособность каждой функции подтверждается отдельно в таблице совместимости. Публичный сайт должен прямо показывать статус Beta, известные ограничения и проверенные версии клиентов.

## Принципы

- Лендинг и пользовательский интерфейс — Cloudflare Pages. Серверная логика — Workers; метаданные — D1; состояние сессий — SQLite-backed Durable Objects; OAuth использует поддерживаемый библиотекой Workers KV.
- Пользователи входят через Telegram. Подключение переписки через MTProto — отдельное подтверждение. Администраторы входят только через IDP.
- Postun не создаёт архив переписки и не сохраняет файлы. В облачном режиме обрабатывает запрошенное содержимое в оперативной памяти и передаёт его выбранному ИИ-клиенту.
- Зашифрованные Telegram-сессии, разрешения, месячные счётчики и ограниченные служебные данные сохраняются. Это не zero-knowledge и не обещание полного отсутствия инфраструктурных метаданных.
- Код защиты и шифрования открыт. Закрыты реальные ключи, токены, пользовательские данные, конфигурация доступа к нашему развёртыванию и материалы закрытых security-инцидентов.
- Первый этап бесплатный. Платежи и подарочные подписки добавляются позднее без повторной привязки Telegram.
- Самостоятельная установка — в своём аккаунте Cloudflare, со своими ключами и своим IDP для административной панели; без зависимости от работающего postun.org.

## Навигация

| Документ | Назначение |
|---|---|
| [01_PRODUCT_SPEC](docs/01_PRODUCT_SPEC.md) | Функции, бета-сценарии, границы и квоты |
| [02_ARCHITECTURE](docs/02_ARCHITECTURE.md) | Компоненты, данные и разделение полномочий |
| [03_SECURITY_PRIVACY](docs/03_SECURITY_PRIVACY.md) | Шифрование, открытая и закрытая части |
| [04_DEPLOYMENT](docs/04_DEPLOYMENT.md) | GitHub, Cloudflare, секреты и обновления |
| [05_ACCEPTANCE](docs/05_ACCEPTANCE.md) | Проверяемые условия запуска беты |
| [06_IDP_ADMIN](docs/06_IDP_ADMIN.md) | Вход администраторов и матрица ролей |
| [07_SOURCES](docs/07_SOURCES.md) | Проверка documentation index и официальных источников |
| [08_AUDIT](docs/08_AUDIT.md) | Изменения документации и остаточные проверки |
| [EXECUTION_PROMPT](EXECUTION_PROMPT.md) | Задание инженерному агенту |

## Статус реализации

Фактические результаты приёмки по каждому пункту (PASS / FAIL / NOT_RUN / BLOCKED) ведутся в [docs/RELEASE_STATUS.md](docs/RELEASE_STATUS.md). Публичный сайт показывает только проверенные функции из [apps/web/status.json](apps/web/status.json).

## Структура

```text
apps/web/            Cloudflare Pages: beta-лендинг, документы, кабинет (статический)
apps/auth/           postun-auth: Telegram OIDC, web-сессия, MCP OAuth (authorization server), API кабинета
apps/mcp/            postun-mcp: MCP resource server, SessionAndQuotaDO, Telegram (mtcute) adapter
apps/admin/          postun-admin: IDP OIDC BFF, агрегаты, suspend/resume
packages/contracts/  общие схемы, scopes, шифрование envelope, курсоры, RPC-контракты
migrations/control/  D1 postun-control (только auth)
migrations/admin/    D1 postun-admin-meta (только admin)
```

## Разработка

Node.js 22 (`.nvmrc`), npm workspaces, один lockfile.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:secrets
```

Тесты используют синтетические данные и локальный Workers runtime (Miniflare/workerd); реальные Telegram, IDP и Cloudflare-ресурсы в CI не используются. Настоящие ключи задаются только через `wrangler secret put` в своём аккаунте Cloudflare; примеры переменных — в `apps/*/.dev.vars.example` и `templates/.env.example`.

Развёртывание и self-host: [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) и [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md). Лицензия: [Apache-2.0](LICENSE).

**Для тестеров:** используйте сначала специально подготовленные данные. О проблемах сообщайте без переписки, документов, кодов входа и токенов; чувствительные уязвимости — только через закрытый security-канал, описанный в [SECURITY.md](SECURITY.md).
