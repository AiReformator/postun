# 02. Postun Beta — архитектура Cloudflare

**Редакция 2.0-beta.** Модульный TypeScript-проект с разделением по границам доверия. Не создаём микросервис для каждого инструмента.

## 1. Компоненты и адреса

| Компонент | Адрес / ресурс | Назначение |
|---|---|---|
| Workers static assets postun-web | postun.org; app.postun.org | Статический лендинг и кабинет; без секретов и D1 bindings |
| Auth Worker postun-auth | auth.postun.org | Telegram OIDC, web session, MCP OAuth, служебный API кабинета |
| MCP Worker postun-mcp | mcp.postun.org/mcp | OAuth resource, read-only tools, Telegram transport и SessionAndQuotaDO |
| Admin Worker postun-admin | admin.postun.org | Серверный OIDC-вход администраторов, административный UI/API |
| D1 postun-control | Приватный binding | Пользователи, владельцы аккаунтов, права, entitlement |
| D1 postun-admin-meta | Отдельная БД | Только псевдонимные административные проекции и admin sessions |
| KV OAUTH_KV | Только auth | Поддерживаемое хранилище Workers OAuth Provider |
| SQLite Durable Objects | Только mcp | Зашифрованные сессии, актуальные ограничения, атомарные счётчики |
| Analytics Engine postun_metrics | auth и mcp, только запись | Агрегированные служебные метрики без идентификаторов ([03](03_SECURITY_PRIVACY.md), «Служебные метрики») |
| OIDC-провайдер администраторов | Точный issuer задаёт оператор (ADMIN_OIDC_ISSUER) | Идентификация и роли администраторов; без Telegram-сессий |

```text
Web (static assets) / user -> Auth Worker -> Telegram OIDC
AI client -> MCP Worker -> SessionAndQuotaDO -> Telegram MTProto
                 |                |
                 +-- auth service binding   +-- aggregate projection
                                            -> Admin metadata D1
Admin browser -> Admin Worker -> OIDC-провайдер администраторов
                       +-----> Admin metadata D1
```

Google Cloud, внешняя БД, VPS, R2 и Containers не входят в эту редакцию. OIDC-провайдер администраторов — единственное допустимое внешнее звено, и только для административной идентификации; это не место хранения содержимого Postun.

## 2. Владельцы данных и реальные границы

Auth Worker владеет postun-control и OAUTH_KV. Он знает, кто вошёл и какие grants разрешены, но не содержит ключа Telegram-сессий. MCP Worker владеет SessionAndQuotaDO и ключами их расшифрования. Между ними используется приватный Service Binding с узкими методами; пользователь не выбирает произвольный backend URL.

Один SessionAndQuotaDO на principal_id хранит отдельные ciphertext для его связанных аккаунтов, применимые grants/deny state и месячную квоту. Адрес DO вычисляется сервером из проверенной идентичности, а не из входящего account_id. Операции конкретного Telegram-аккаунта сериализуются; асинхронное ожидание не считать автоматической защитой от параллельных вызовов.

Admin Worker не получает postun-control, OAUTH_KV, SessionAndQuotaDO или SESSION_KEK. Доступ только к отдельной postun-admin-meta. SQL views и запрет в UI не являются заменой этой границе: D1 binding не даёт самостоятельной защиты таблиц от скомпрометированного кода.

Проекции статистики содержат opaque principal_id, маску/HMAC идентификатора, число связей, статус, тариф, месяц, success_count и out_bytes. Обновлять абсолютные значения с revision, а не незащищённым increment. Отправка идемпотентна; при сбое повторяет только служебную проекцию. Это не журнал сообщений. Проекция передаётся в фиксированный непубличный Service Binding entrypoint Admin Worker; отдельный DB binding к Admin D1 у Auth/MCP не требуется.

Если понадобится блокировка пользователя из админки, отдельный Service Binding предоставляет только suspend/resume и принимает подтверждённый actor и target. Никакого read_messages, arbitrary SQL, доступа к vault или выдачи MCP-токена от имени пользователя.

## 3. Минимальная структура кода

```text
apps/web/       # Workers static assets: landing, app UI
apps/auth/      # Telegram login + OAuth + account control API
apps/mcp/       # MCP + DO + Telegram adapter
apps/admin/     # admin OIDC BFF + UI + metadata API
packages/contracts/  # shared schemas and DTO
migrations/control/
migrations/admin/
docs/
tests/
```

В каждом серверном приложении достаточно папок auth, handlers, services, data по фактической необходимости. Не создавать универсальную ORM, event bus, DI-фреймворк, plugin engine или отдельный package на один файл. Параметризованный SQL, строгий TypeScript, один lockfile, общий набор контрактов.

## 4. Канонические сущности

| Сущность | Хранилище | Ключевой инвариант |
|---|---|---|
| principal | Control D1 | UUID, issuer + OIDC subject; Telegram ID проверен отдельно |
| linked_account | Control D1 | unique telegram_id_hmac; owner_id обязателен |
| grant_reference | Control D1 / DO | scopes и account allowlist; deny/version проверяется перед Telegram |
| oauth token/code/client | OAuth KV | Только формат и lifecycle поддерживаемой библиотеки |
| session_envelope | Principal DO | Отдельный ciphertext на аккаунт; версия ключа и AAD |
| usage_period | Principal DO | Атомарный счётчик; D1-проекция не решает доступ |
| entitlement | Control D1 + DO policy | beta_free сейчас; смена тарифа не меняет сессию |
| admin_projection | Admin D1 | Только минимальная статистика; без настоящих Telegram credentials |

Telegram ID хранить как decimal string; не полагаться на точность произвольного JavaScript Number. Индекс по ID — HMAC с отдельным ключом индекса, не простой SHA256. Значение, необходимое для уведомлений или будущей привязки оплаты, хранить зашифрованным и не выводить в публичный URL.

Привязка: Control D1 атомарно резервирует уникальность account identity -> DO создаёт зашифрованную pending-сессию -> состояние active выставляется только после согласования обеих сторон. При сбое операция возобновляется по operation_id. D1 + DO не образуют общей транзакции; pending не разрешает MCP-доступ. Перенос аккаунта между владельцами не реализовывать в бете.

## 5. OAuth и отзыв

Используем актуальный Workers OAuth Provider с разделёнными authorization/resource server API. Библиотека требует KV: не переносить её token schema самостоятельно в D1. В props хранить opaque ссылки и разрешения, но не копию MTProto-сессии. userId/metadata в KV считать видимыми метаданными. [S03]

Клиент: discovery -> Authorization Code + PKCE S256 -> Telegram identity -> явный выбор accounts/scopes -> access/refresh tokens Postun. Issuer, audience/resource, redirect URI, nonce/state, срок и подпись проверяются. Telegram token не передаётся клиенту вместо Postun token.

KV eventual consistency не даёт гарантии мгновенного глобального отзыва. После отключения grant сначала записываем deny/version в authoritative DO, затем отзываем библиотечные token records. MCP проверяет DO до выдачи данных; stale KV не восстанавливает доступ. При недоступности проверки — отказ. In-flight поток при отзыве останавливается на ближайшей проверке между чанками; уже выданные байты нельзя отозвать. [S04]

## 6. MTProto: сначала короткий проверяемый опыт

Первый кандидат — лицензированная TypeScript-библиотека mtcute с подтверждённым Worker-совместимым транспортом. Название библиотеки не доказывает совместимость. Нужно проверить QR/2FA, session persistence, cold start, DC migration, историю, поиск и поток медиа.

Не писать MTProto, SRP или AES-IGE с нуля. Если готовая библиотека не проходит тест, менять ограниченный адаптер, а не OAuth, домены и модель пользователей. Для беты не оставлять постоянный исходящий WebSocket: он не получает преимуществ входящей WebSocket hibernation. Авторизованное состояние сохраняется; соединение живёт на время ограниченной операции. [S07]

Лимит Free 10 мс относится к HTTP Worker; его нельзя автоматически приписывать DO. Измерять CPU и duration каждого звена отдельно. Чанки MTProto внутри одного сокета не равны отдельным HTTP subrequests: считать реальные fetch/socket/binding operations.

## 6a. Темп чтения и защита Telegram-аккаунта

Принцип (решение владельца, 06.11.2026): лимиты щедрые, обычная тяжёлая работа (десятки каналов, тысячи сообщений) не замедляется. Главная защита — подчиняться самому Telegram (сохранённый FLOOD_WAIT), собственные ограничения — только от спама. Ограничения Cloudflare сервис не урезают: под лимиты Free подстраивается архитектура, а не поведение для пользователя. Telegram не публикует числовых лимитов: `core.telegram.org/api/errors` определяет только `FLOOD_WAIT_X`. Поэтому все числа ниже — **начальные, подбираемые оценки**, каждое вынесено в переменную окружения с безопасным значением по умолчанию (`apps/mcp/wrangler.jsonc`, production и staging). Неверное или пустое значение заменяется значением по умолчанию, а не отключает защиту. Всё состояние живёт в SQLite того же SessionAndQuotaDO (таблица `pacing`, только счётчики), новой инфраструктуры нет; инструменты остаются read-only.

| Механизм | Переменная (по умолчанию) | Отказ |
|---|---|---|
| Сохранённый cooldown после `FLOOD_WAIT` от Telegram: `now + retryAfter + запас`, до открытия клиента; короткий остаток (до `PACING_MAX_SMOOTH_MS` и в пределах бюджета вызова) пережидается внутри вызова | `PACING_FLOOD_MARGIN_SECONDS` (5) | `RATE_LIMITED`, reason `FLOOD_WAIT`, retryAfter = остаток |
| Авто-ожидание mtcute только коротких flood wait, не более одного повтора | `FLOOD_AUTO_SLEEP_SECONDS` (8), `FLOOD_AUTO_RETRIES` (1) | длиннее — `RATE_LIMITED` и cooldown |
| Token bucket на аккаунт (только защита от спама) | `PACING_BURST` (60), `PACING_REFILL_MS` (500, около 120 в минуту) | `LOCAL_PACING`; ожидание до `PACING_MAX_SMOOTH_MS` (15000) ставится в очередь сном |
| Скользящий часовой лимит вызовов | `PACING_HOURLY_CAP` (5000) | `HOURLY_CAP` |
| Разнесение `search_channels` и `search_messages` без `peer` (Telegram тормозил contacts.search после ~20 вызовов за 10 с) | `PACING_LOOKUP_PER_MIN` (60, около 1 в секунду), `PACING_LOOKUP_BURST` (5), `PACING_LOOKUP_PER_DAY` (2000) | очередь до 15 с, затем `LOOKUP_CAP` |
| Бюджет возвращённых сообщений в час (по умолчанию выключен) | `PACING_MESSAGES_PER_HOUR` (0 = выкл.) | `MESSAGE_BUDGET` |

Порядок в `callToolInner`: авторизация, резерв квоты, проверка cooldown, бюджет сообщений, локальный темп, замок аккаунта, повторная проверка cooldown, MTProto. Все ожидания внутри одного вызова (очередь темпа, короткий cooldown, очередь к замку аккаунта) укладываются в бюджет `CALL_WAIT_BUDGET_MS` (25 с), и задержка очереди темпа берётся только из остатка этого бюджета: ChatGPT обрывает `tools/call` примерно через 60 с, и уведомления о прогрессе этот срок не продлевают. Фаза Telegram начинается не позже 25 с и занимает подключение, запрос, не более одного сна mtcute (`FLOOD_AUTO_SLEEP_SECONDS`) и один повтор. Не дождавшийся своей очереди вызов получает `CONFLICT` с reason `ACCOUNT_BUSY` (пауза, совет повторить); `CONFLICT` из-за `operation_id`, уже использованного с другими аргументами, — обычная ошибка с подсказкой взять новый `operation_id`. Любой отказ до MTProto освобождает резерв квоты и не считается успешным вызовом. Суточная квота (10000 вызовов) не менялась; её отказ теперь различает `DAILY_QUOTA` и `MONTHLY_QUOTA`. Ошибка получила необязательные поля `reason` и `hint` (фиксированные тексты, без содержимого Telegram).

Контракт для ИИ: сервер MCP отдаёт `instructions` (читать порциями по `nextCursor`, вызовы для одного аккаунта делать последовательно, большие чтения занимают минуты), `RATE_LIMITED` и `CONFLICT` показываются как временная пауза, а не отказ: текст начинается с фразы «PAUSED, not refused», в JSON есть `status: "paused"`, `temporary: true`, `source` (`postun` — собственный темп Postun, `telegram` — FLOOD_WAIT) и `retryAfterSeconds`, а ИИ просят повторить тот же вызов и не сообщать пользователю об «ограничении поиска», в описании каждого инструмента есть строка о темпе, а успешный результат содержит объект `limits` (`callsRemainingNow`, `messagesRemainingThisHour`, `nextCallNotBeforeSeconds`, `paceSeconds`).

## 6b. Соответствие лимитам Cloudflare Free

Принцип (решение владельца, 06.11.2026): Postun не урезает себя из-за Cloudflare. Страницы остаются до 100 элементов, файлы до `MAX_FILE_BYTES`, новых пользовательских лимитов «ради Cloudflare» нет. Под лимиты Free (10 мс CPU на запрос Worker, 100 000 записанных строк DO в сутки, 30 с CPU на запрос DO по документации Cloudflare, сверено 06.11.2026) подстраивается архитектура. Время ожидания ввода-вывода в CPU не входит. Ожидание внутри вызова (очередь темпа, короткий cooldown, очередь к замку аккаунта, до 25 с) — это время работы DO, а не CPU; в метриках Pilot стоит следить за DO GB-s в сутки (`postun_do_gb_seconds_today`).

Измерено на production (05.11.2026): Worker `postun-mcp` CPU p50 1,8 мс, p90 13 мс, p99 35 мс, максимум 70 мс; Durable Object `SessionAndQuotaDO` CPU p50 1,3 мс, p90 44 мс, p99 105 мс. Ошибок `exceeded*` пока нет, но Worker должен надёжно укладываться в 10 мс.

Что сделано:

- **Worker.** Определения инструментов и их JSON Schema строятся один раз на isolate (область модуля, вне CPU запроса), а не при каждом `tools/list`. Worker не валидирует аргументы второй раз: Durable Object остаётся единственным авторитетом и разбирает их по той же Zod-схеме (`parseToolArgs`) до авторизации, резерва квоты и обращения к Telegram, поэтому неверный вызов не тратит квоту. Grant из токена проверяется простой структурной проверкой (`readGrantProps`, тест эквивалентности с `GrantPropsSchema`), DO сверяет grant со своими записями на каждом вызове. Экземпляр MCP-сервера по-прежнему создаётся на запрос: SDK привязывает сервер к одному транспорту и сам задумывает «один экземпляр на запрос», поэтому делиться им между параллельными запросами небезопасно. Бандл Worker минифицирован (`minify` в `wrangler.jsonc`): 5,1 МБ до 2,7 МБ, быстрее разбор и компиляция в новом isolate.
- **Скачивание файлов.** Права (grant, scope, аккаунт, статус, квота байт) проверяются при открытии, затем раз в 8 МиБ (`TRANSFER_STEP_BYTES`) и при закрытии. Байты учитываются шагами по 8 МиБ и один раз при закрытии, ошибке или отмене, так что файл 512 МБ стоит около 64 записей вместо тысяч, а итог по квоте точный. Отзыв или отключение аккаунта останавливает передачу не позднее чем через 8 МиБ.
- **Пагинация.** `list_dialogs` и глобальный поиск используют родные смещения Telegram (диалоги: дата, id и peer последнего диалога; поиск: rate, id и чат последнего сообщения). Страница стоит один RPC независимо от глубины; взгляд вперёд на +1 убран, `nextCursor` выдаётся, если вернулось ровно `limit` элементов. Курсоры по-прежнему подписаны HMAC и привязаны к principal, аккаунту, инструменту и запросу, TTL 1 ч. Старые курсоры со счётчиком `skip` отклоняются с `INVALID_INPUT` (reason `CURSOR_EXPIRED`, «Cursor expired, start again»). Предел `PACING_MAX_SKIP` и reason `DEEP_PAGING` удалены вместе со `skip`.

Измерение CPU Worker (`npm run bench:cpu -w @postun/mcp`, Node, в процессе, DO подменён заглушкой; это ориентир, а не замер в workerd, абсолютные числа в workerd выше). Среднее CPU на запрос до и после:

| Запрос | До | После |
|---|---|---|
| `tools/list`, прогретый процесс | 0,32 мс | 0,10 мс |
| `tools/list`, запросы 2-21 (молодой isolate) | 1,09 мс | 0,37 мс |
| `tools/call list_dialogs`, прогретый процесс | 0,084 мс | 0,087 мс (без изменений) |

Вывод: JS самого `handleMcp` в прогретом состоянии занимает около 0,1 мс, поэтому хвосты p90/p99 Worker определяются не им, а холодным стартом isolate (загрузка бандла), проверкой токена через service binding и работой библиотеки OAuth. Чтобы сузить причину, нужно измерение в workerd (production-метрики по холодным и тёплым запросам); минификация бандла направлена на холодный старт.

Не сделано, следующие шаги: повторное использование клиента mtcute между вызовами одного аккаунта (сейчас клиент создаётся, подключается и уничтожается на каждый вызов; основной источник CPU DO p90/p99) и сохранение ключей чужих DC (foreign-DC auth keys), чтобы не повторять обмен ключами. Оба меняют жизненный цикл соединений и вынесены в отдельные изменения.

## 7. Потоки файлов и минимизация кода

MCP возвращает метаданные и поддерживаемый клиентом способ получения. Бинарный поток идёт через отдельный защищённый endpoint. Ограниченный буфер 1–4 МиБ — стартовая инженерная настройка, которую надо измерить; максимум две передачи на principal и одна на Telegram-аккаунт в первой бете.

Непрозрачный capability хранится хешированным, имеет owner/grant/account binding, срок жизни и один download intent. Строго одноразовый GET несовместим с Range-возобновлением: intent допускает несколько проверенных range-запросов до завершения/истечения. Предпочтительнее token в заголовке или fragment-to-POST обмен, не в индексируемой ссылке с bearer query.

Backpressure, abort, no-store, nosniff, безопасный Content-Disposition, проверка диапазонов. Не кэшировать содержимое через Cache API/статические ассеты/CDN. Если клиент не умеет получать приватный файл без раскрытия токенов модели, остаётся авторизованное скачивание человеком; это честно отдельный статус.

Карточка файла (`apps/mcp/src/widget.ts`). Песочница ChatGPT не выходит в сеть и не может сама скачать ссылку из `get_media`. Поэтому `get_media` указывает шаблон MCP Apps `ui://postun/media-card-v2.html` (`_meta.ui.resourceUri` и совместимый `openai/outputTemplate`), а сервер отдаёт его как ресурс `text/html;profile=mcp-app`. Карточка работает в браузере пользователя: по нажатию «Передать в чат» скачивает файл с `/files/:intentId` с capability в заголовке `Authorization` и передаёт его ChatGPT через `window.openai.uploadFile`, затем `setWidgetState({ imageIds })`, чтобы модель получила файл на следующем ходе; «Скачать» сохраняет файл у пользователя. Передать в чат можно изображения и PDF, остальное только скачать. Карточка отправляет capability только на origin этого сервера: он вшит в HTML и это единственный `connectDomains` в её CSP; имя и тип файла выводятся только как текст. Чтобы карточка из чужого origin могла прочитать ответ, `/files` отвечает с CORS `Access-Control-Allow-Origin: *` и обрабатывает preflight для `authorization, range`, без credentials: доступ по-прежнему решает только capability, cookies у endpoint нет. Postun копию не хранит: байты идут из Telegram через Worker прямо в браузер. Статус FILE_ATTACHMENT для ChatGPT подтверждается только реальной проверкой в ChatGPT; до неё в таблице совместимости он не отмечается как проверенный.

## 8. Стоимость и переносимость

Free-first — цель, не гарантия. Workers, DO, D1 и KV имеют разные квоты; расходы на несколько OAuth-записей и refresh не исключать из расчёта. Paid и любые дополнительные платные сервисы включаются только по явному решению оператора установки. Для 1000 пользователей важнее измеренные CPU, duration, bytes и ошибки, а не само число регистраций. [S05–S08]

Self-host получает тот же открытый код и безопасные defaults; производственные keys, issuer, resource IDs и клиент OIDC-провайдера администраторов (ADMIN_OIDC_*) задаются оператором установки. Никакой обязательной регистрации на postun.org, центрального licence-check или скрытого закрытого security-пакета.
