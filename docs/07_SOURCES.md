# 07. Postun Beta — реестр проверенных источников

Реестр публичной документации поставщиков и спецификаций, на которые опираются технические ограничения и контракты Postun. Идентификаторы [Sxx] стабильны: на них ссылаются остальные документы. Источники подтверждают документированное поведение платформ, а не работоспособность конкретного развёртывания.

## 1. Первоисточники

**[S01] Telegram Login / OpenID Connect**
https://core.telegram.org/bots/telegram-login
Проверены отдельный identity-вход, OIDC flow, scopes и подписанные данные. Не подменяет MTProto-авторизацию переписки.

**[S02] Telegram QR login**
https://core.telegram.org/api/qr-login
Проверены lifecycle login token, истечение и переход между DC. Конкретные вызовы выполняет библиотека.

**[S03] Cloudflare Workers OAuth Provider — официальный исходник**
https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md
https://github.com/cloudflare/workers-oauth-provider/blob/main/storage-schema.md
Документация и исходный код подтверждают разделённые authorization/resource server API и KV storage. Не объявляем combined API устаревшим без отдельного подтверждения. main — изменяемая ветка, не dependency pin.

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
Секреты не помещаются в бандл статических ассетов, Git или обычные публичные vars.

**[S10] Workers Logs**
https://developers.cloudflare.com/workers/observability/logs/workers-logs/
Настройки observability проверяются для каждого environment; отсутствие console.log не гарантирует отсутствия остальных журналов.

**[S11] Securing remote MCP**
https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/
MCP authentication/authorization, consent, scope и безопасные границы сервера.

**[S12] OpenID Connect Core 1.0 и RFC 7636 (PKCE)**
https://openid.net/specs/openid-connect-core-1_0.html
https://datatracker.ietf.org/doc/html/rfc7636
Authorization Code flow, точное совпадение redirect URI, S256 code challenge, проверка ID token (issuer, audience, nonce, срок). Introspection или ID token сами по себе не заменяют проверку свежего назначения роли.

**[S13] RFC 6749 (OAuth 2.0) и роли в claims**
https://datatracker.ietf.org/doc/html/rfc6749
Роли приходят из подписанного claim, имя которого задаёт конфигурация (ADMIN_OIDC_ROLES_CLAIM); у разных OIDC-провайдеров формат claim различается, поэтому формат проверяется на реальных токенах выбранного провайдера. Роли приложения отличаются от административных ролей самого провайдера.

**[S14] Workers custom domains**
https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
Домен добавляется к Worker (в том числе со static assets) через `routes` с `custom_domain: true`. Состояние DNS конкретного домена этим источником не проверяется.

**[S15] Workers Builds: GitHub integration**
https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
Официальная связка репозитория и Workers; production и PR preview требуют отдельных политик.

**[S16] Workers Previews resources and isolation**
https://developers.cloudflare.com/workers/previews/resources/
Конкретные новые Preview API/CLI не зафиксированы как обязательная реализация. Безопасный baseline — отдельные staging resources и фактическая проверка service-binding targets.

**[S18] ChatGPT custom MCP (совместимость клиента)**
https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
Наличие custom MCP зависит от клиентского режима и workspace policies; отдельно тестировать refresh и выбранные агентные сценарии.

**[S19] Claude Code MCP (совместимость клиента)**
https://code.claude.com/docs/en/mcp
Remote HTTP MCP и авторизация клиента. Совместимость конкретного Postun endpoint подтверждается E2E, а не этой страницей.
