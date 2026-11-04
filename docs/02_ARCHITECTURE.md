# 02. Postun Beta — архитектура Cloudflare

**Редакция 2.0-beta · 04.11.2026.** Модульный TypeScript-проект с разделением по границам доверия. Не создаём микросервис для каждого инструмента.

## 1. Компоненты и адреса

| Компонент | Адрес / ресурс | Назначение |
|---|---|---|
| Pages postun-web | postun.org; app.postun.org | Статический лендинг и кабинет; без секретов и D1 bindings |
| Auth Worker postun-auth | auth.postun.org | Telegram OIDC, web session, MCP OAuth, служебный API кабинета |
| MCP Worker postun-mcp | mcp.postun.org/mcp | OAuth resource, read-only tools, Telegram transport и SessionAndQuotaDO |
| Admin Worker postun-admin | admin.postun.org | Серверный IDP OIDC, административный UI/API |
| D1 postun-control | Приватный binding | Пользователи, владельцы аккаунтов, права, entitlement |
| D1 postun-admin-meta | Отдельная БД | Только псевдонимные административные проекции и admin sessions |
| KV OAUTH_KV | Только auth | Поддерживаемое хранилище Workers OAuth Provider |
| SQLite Durable Objects | Только mcp | Зашифрованные сессии, актуальные ограничения, атомарные счётчики |
| IDP | Точный issuer задаёт оператор | Идентификация и роли администраторов; без Telegram-сессий |

```text
Pages / user -> Auth Worker -> Telegram OIDC
AI client -> MCP Worker -> SessionAndQuotaDO -> Telegram MTProto
                 |                |
                 +-- auth service binding   +-- aggregate projection
                                            -> Admin metadata D1
Admin browser -> Admin Worker -> IDP
                       +-----> Admin metadata D1
```

Google Cloud, внешняя БД, VPS, R2 и Containers не входят в эту редакцию. IDP — единственное специально согласованное исключение для административной идентификации, а не место хранения содержимого Postun.

## 2. Владельцы данных и реальные границы

Auth Worker владеет postun-control и OAUTH_KV. Он знает, кто вошёл и какие grants разрешены, но не содержит ключа Telegram-сессий. MCP Worker владеет SessionAndQuotaDO и ключами их расшифрования. Между ними используется приватный Service Binding с узкими методами; пользователь не выбирает произвольный backend URL.

Один SessionAndQuotaDO на principal_id хранит отдельные ciphertext для его связанных аккаунтов, применимые grants/deny state и месячную квоту. Адрес DO вычисляется сервером из проверенной идентичности, а не из входящего account_id. Операции конкретного Telegram-аккаунта сериализуются; асинхронное ожидание не считать автоматической защитой от параллельных вызовов.

Admin Worker не получает postun-control, OAUTH_KV, SessionAndQuotaDO или SESSION_KEK. Доступ только к отдельной postun-admin-meta. SQL views и запрет в UI не являются заменой этой границе: D1 binding не даёт самостоятельной защиты таблиц от скомпрометированного кода.

Проекции статистики содержат opaque principal_id, маску/HMAC идентификатора, число связей, статус, тариф, месяц, success_count и out_bytes. Обновлять абсолютные значения с revision, а не незащищённым increment. Отправка идемпотентна; при сбое повторяет только служебную проекцию. Это не журнал сообщений. Проекция передаётся в фиксированный непубличный Service Binding entrypoint Admin Worker; отдельный DB binding к Admin D1 у Auth/MCP не требуется.

Если понадобится блокировка пользователя из админки, отдельный Service Binding предоставляет только suspend/resume и принимает подтверждённый actor и target. Никакого read_messages, arbitrary SQL, доступа к vault или выдачи MCP-токена от имени пользователя.

## 3. Минимальная структура кода

```text
apps/web/       # Pages: landing, app UI
apps/auth/      # Telegram login + OAuth + account control API
apps/mcp/       # MCP + DO + Telegram adapter
apps/admin/     # IDP BFF + UI + metadata API
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

## 7. Потоки файлов и минимизация кода

MCP возвращает метаданные и поддерживаемый клиентом способ получения. Бинарный поток идёт через отдельный защищённый endpoint. Ограниченный буфер 1–4 МиБ — стартовая инженерная настройка, которую надо измерить; максимум две передачи на principal и одна на Telegram-аккаунт в первой бете.

Непрозрачный capability хранится хешированным, имеет owner/grant/account binding, срок жизни и один download intent. Строго одноразовый GET несовместим с Range-возобновлением: intent допускает несколько проверенных range-запросов до завершения/истечения. Предпочтительнее token в заголовке или fragment-to-POST обмен, не в индексируемой ссылке с bearer query.

Backpressure, abort, no-store, nosniff, безопасный Content-Disposition, проверка диапазонов. Не кэшировать содержимое через Cache API/Pages/CDN. Если клиент не умеет получать приватный файл без раскрытия токенов модели, остаётся авторизованное скачивание человеком; это честно отдельный статус.

## 8. Стоимость и переносимость

Free-first — цель, не гарантия. Workers, DO, D1 и KV имеют разные квоты; расходы на несколько OAuth-записей и refresh не исключать из расчёта. Paid и любые дополнительные платные сервисы включаются только с разрешения владельца. Для 1000 пользователей важнее измеренные CPU, duration, bytes и ошибки, а не само число регистраций. [S05–S08]

Self-host получает тот же открытый код и безопасные defaults; производственные keys, issuer, resource IDs и IDP client задаются владельцем установки. Никакой обязательной регистрации на postun.org, центрального licence-check или скрытого закрытого security-пакета.
