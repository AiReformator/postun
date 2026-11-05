# 07. Postun Beta — реестр проверенных источников

**Дата сверки: 04.11.2026. Редакция 2.0-beta.** Источники ниже использованы для проверки технических ограничений и контрактов. Это не подтверждение работоспособности будущего приложения.

## 1. documentation index

Вызваны resolve-library-id и query-docs для трёх направлений:

| Library ID | Проверяемая тема | Вывод для проекта |
|---|---|---|
| /llmstxt/developers_cloudflare_workers_llms-full_txt | Pages, Workers, previews и изоляция bindings | Preview URL не доказывает изоляцию D1/KV/service bindings |
| /cloudflare/workers-oauth-provider | OAuth, KV, grants и revocation | Сохраняем поддерживаемый KV backend; отдельно проверяем прикладной отзыв |
| /websites/idp | OIDC PKCE, роли и introspection | Вход и роль — разные проверки; нужен правильный project/org |

documentation index возвращает индексированную документацию и фрагменты источников. Это не гарантированный архив всех продуктов ровно на указанную дату. Существенные пункты дополнительно сверены с официальными страницами и исходниками; конкретные package versions и runtime-совместимость исполнитель фиксирует перед реализацией.

## 2. Первоисточники

**[S01] Telegram Login / OpenID Connect**
https://core.telegram.org/bots/telegram-login
Проверены отдельный identity-вход, OIDC flow, scopes и подписанные данные. Не подменяет MTProto-авторизацию переписки.

**[S02] Telegram QR login**
https://core.telegram.org/api/qr-login
Проверены lifecycle login token, истечение и переход между DC. Конкретные вызовы выполняет библиотека.

**[S03] Cloudflare Workers OAuth Provider — официальный исходник**
https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md
https://github.com/cloudflare/workers-oauth-provider/blob/main/storage-schema.md
documentation index и GitHub read подтверждают разделённые authorization/resource server API и KV storage. Не объявляем combined API устаревшим без отдельного подтверждения. main — изменяемая ветка, не dependency pin.

**[S04] Workers KV: consistency**
https://developers.cloudflare.com/kv/concepts/how-kv-works/
Eventual consistency учитывается в отзыве доступа; KV не единственный источник deny state.

**[S05] Workers limits**
https://developers.cloudflare.com/workers/platform/limits/
Проверены 128 МБ на isolate, 10 мс CPU HTTP Worker на Free, различие CPU/wall time и модель subrequests. Объём одного HTTP-ответа не равен лимиту памяти.

**[S06] Workers pricing**
https://developers.cloudflare.com/workers/platform/pricing/
Free-first допускается; Paid и дополнительные расходы согласуются отдельно. Смета зависит от реальных измерений всех компонентов, а не числа регистраций.

**[S07] Durable Objects WebSockets**
https://developers.cloudflare.com/durable-objects/best-practices/websockets/
Экономия hibernation входящего WebSocket не переносится автоматически на исходящее MTProto-подключение.

**[S08] Durable Objects pricing**
https://developers.cloudflare.com/durable-objects/platform/pricing/
Проверены доступность SQLite-backed DO на Free и отдельные квоты запросов/активного времени.

**[S09] Workers secrets**
https://developers.cloudflare.com/workers/configuration/secrets/
Секреты не помещаются в Pages bundle, Git или обычные публичные vars.

**[S10] Workers Logs**
https://developers.cloudflare.com/workers/observability/logs/workers-logs/
Настройки observability проверяются для каждого environment; отсутствие console.log не гарантирует отсутствия остальных журналов.

**[S11] Securing remote MCP**
https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/
MCP authentication/authorization, consent, scope и безопасные границы сервера.

**[S12] IDP OIDC endpoints**
https://idp.com/docs/apis/openidoauth/endpoints
Discovery, точные redirect URI, S256 и token introspection. Introspection active не заменяет проверку свежего назначения роли.

**[S13] IDP user roles**
https://idp.com/docs/guides/integrate/retrieve-user-roles
Project roles, org context и предпочтительный project-specific role claim. Роли приложения отличаются от административных ролей самой IAM-системы.

**[S14] Pages custom domains**
https://developers.cloudflare.com/pages/configuration/custom-domains/
Домен добавляется к Pages project. Состояние DNS конкретного postun.org этим источником не проверено.

**[S15] Pages GitHub integration**
https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
Официальная связка репозитория и Pages; production и PR preview требуют отдельных политик.

**[S16] Workers Previews resources and isolation**
https://developers.cloudflare.com/workers/previews/resources/
Содержимое доступно через documentation index; прямое web-открытие страницы в этой проверке не дало содержимого. Поэтому конкретные новые Preview API/CLI не зафиксированы как обязательная реализация. Безопасный baseline — отдельные staging resources и фактическая проверка service-binding targets.

**[S17] Claude Code project memory**
https://code.claude.com/docs/en/memory
Короткие repo instructions; imports не заменяют экономию контекста. Целевой каталог Skills и версия Claude Code ещё не проверены.

**[S18] ChatGPT custom MCP**
https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
Наличие custom MCP зависит от клиентского режима и workspace policies; отдельно тестировать refresh и выбранные агентные сценарии.

**[S19] Claude Code MCP**
https://code.claude.com/docs/en/mcp
Remote HTTP MCP и авторизация клиента. Совместимость конкретного Postun endpoint подтверждается E2E, а не этой страницей.

## 3. Подтверждённый репозиторий

Через GitHub connector прочитаны metadata, contents и README репозитория https://github.com/AiReformator/postun . Подтверждены public visibility, default branch main и README с текстом # postun. Blob README: de779d8d642c4c505bc44a53d409e96cde1ec9fd. Это SHA файла, не commit SHA приложения.

Изменения этой редакции не опубликованы в репозитории автоматически. Текущее состояние перед записью нужно перечитать; наличие push permission в metadata не доказывает, что доступный инструмент поддерживает запись.

## 4. Что ещё не проверено

Cloudflare account/zone/DNS, реальные resource IDs, установленный IDP issuer и policy, выбранные версии mtcute и SDK, QR/2FA в Workers, CPU/память, публичное подключение MCP, файлы и автоматические задания. Их статус NOT_RUN / CONFIGURATION_UNKNOWN. Нельзя превращать SOURCE_VERIFIED в RUNTIME_ACCEPTED.
