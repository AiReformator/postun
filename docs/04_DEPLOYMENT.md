# 04. Postun Beta — развёртывание и открытый репозиторий

**Редакция 2.0-beta · 04.11.2026.** Цель — публичный бета-сервис на postun.org, а не закрытый пилот как конечный результат. Прямо сейчас документация не подтверждает уже выполненный deployment.

## 1. Существующая основа

Репозиторий AiReformator/postun уже создан, public, default branch main. При проверке 04.11.2026 в корне был только README.md с заголовком postun. Перед записью повторно прочитать main, открытые ветки/PR и состояние рабочих файлов. Не создавать новый репозиторий, не менять видимость, не затирать работу другого исполнителя.

Рабочая ветка для комплекта: docs/postun-beta-v2; для реализации выбрать отдельную ветку с одним ответственным writer. Сохранить совместимость с последующими изменениями владельца. Установить открытую лицензию после проверки зависимостей; подготовить README, SECURITY, CONTRIBUTING, lockfile, CI и reviewer ownership.

## 2. Домены

| Адрес | Назначение |
|---|---|
| https://postun.org | Публичный Pages-лендинг Postun Beta и документация |
| https://app.postun.org | Пользовательский кабинет из того же Pages build |
| https://auth.postun.org | Telegram login и Postun OAuth |
| https://mcp.postun.org/mcp | Streamable HTTP MCP |
| https://admin.postun.org | IDP-protected административная часть |

postun.org — основной публичный адрес, не только заглушка для будущего проекта. Сначала публикуется честный beta-лендинг, затем на том же адресе включается проверенная регистрация и инструменты.

До изменения DNS сохранить текущие NS/MX/TXT/CAA и существующие A/AAAA/CNAME. Не менять почту и посторонние записи. Для apex Pages настроить зону и official custom domain association; DNS CNAME сам по себе не заменяет привязку проекта. Перенос nameservers и изменения существующих сервисов требуют отдельного согласования. [S14]

## 3. Доступ оператора и токены

Предпочтение — официальная GitHub integration Cloudflare, ограниченная AiReformator/postun, и защищённые release workflows. Это не означает отсутствия служебных deployment credentials: проверить фактически выданные платформой scopes и доступность секретов для builds. Не обещать, что native integration автоматически безопасна для любого PR. [S15]

Браузер (например, browser) используется только если действительно доступен исполнителю. Владелец лично выполняет login/passkey/2FA и подтверждает разрешения. Не просить пароли, OTP и API tokens в чате; не снимать скриншот страницы с раскрытым токеном.

Если нужен API token: до создания показать account, зоны, назначение, точные доступные permissions, TTL и способ отзыва. Владелец создаёт и сохраняет токен в защищённом хранилище. Агент не создаёт токены с правом выпускать новые токены, не использует Global API Key и не запрашивает доступ ко всем зонам ради удобства. Не утверждать гранулярность до конкретного Worker, если текущая модель Cloudflare её не поддерживает.

Bootstrap и routine deploy разделены. Права DNS не нужны обычной сборке. Runtime не содержит Cloudflare management token. Secrets не передаются в командных аргументах, артефактах, public issues, .env в Git или логах CI. Закрепление доступа IDP выполняется отдельным подтверждённым оператором; клиент приложения не получает полномочия управлять всем IdP.

## 4. Последовательность без лишней разработки

### B0 — baseline и конфигурация

Проверить актуальные версии SDK/lockfile, репозиторий, DNS, Cloudflare account/plan, доступный IDP issuer и роли. Записать только не секретные identifiers в приватный inventory. Планируемый список ресурсов см. templates/deployment-inventory.example.json. Наличие scopes у GitHub connection не доказывает наличие write-action в конкретном инструменте.

### B1 — минимальный Telegram runtime

До большой UI-разработки проверить готовый MTProto SDK в настоящем Workers runtime: QR, 2FA при наличии, сохранение ciphertext, cold restart, чтение своего тестового диалога и маленького файла. Измерить CPU, duration, memory. Мок нужен для contract tests, но не заменяет проверку Telegram.

### B2 — защищённая основа

Развернуть auth + mcp + DO + Control D1 + OAuth KV. Добавить лимиты и server-side grant checks. Отдельно Admin Worker + Admin D1 + IDP. Реальные credentials размещаются только в своих bindings, dev/staging/prod не делят данные и ключи.

### B3 — Pages и открытая бета

Публикуем postun.org с Beta badge, описанием эксперимента, GitHub, известными ограничениями и приглашением тестеров. Реальную регистрацию включаем после auth/tenant/privacy smoke. Допускается недоступность ещё неготовых функций с понятным состоянием; недопустим незапароленный MCP ради раннего запуска.

### B4 — E2E и release

Из реальных ChatGPT/Claude Code проверить OAuth, cold start и чтение. Отдельно проверить каналы и каждый заявленный файловый сценарий. После test PASS продвинуть точный артефакт, сохранить deploy ID/SHA и выполнить внешние smoke; таблица совместимости обновляется только результатами.

### B5 — независимая установка

Проверить fork во втором Cloudflare-аккаунте на собственных Telegram и IDP credentials. Отсутствие postun.org не должно ломать login, encryption, quota или MCP. Бесплатный код не зависит от закрытого security-сервиса оператора.

## 5. Git/CI и preview

Untrusted PR — только secretless lint/types/unit/security и synthetic fixtures. Никакого production-adjacent runner, deploy, remote D1 или Telegram login. Review обязателен для auth, crypto, migrations, infra и CI. Защиту веток проверять фактически, а не по наличию CODEOWNERS.

Pages previews не получают production API defaults и live bindings. Отдельный origin staging и отдельные D1/DO/KV/secrets. Worker preview Service Binding может указывать на production — это проверяется по каждому binding; имя Preview не является доказательством изоляции. [S16]

Deploy: PR -> CI -> isolated staging -> review -> exact SHA promotion -> controlled migrations -> external smoke. Сборка UI не выполняет SQL. Для публикации кода и запуска postun.org область уже задана владельцем; не переспрашивать её на каждом безопасном шаге. Новые расходы, доступы, удаление или влияние на чужие сервисы согласовываются отдельно.

## 6. Миграции, откат и ключи

Ресурсы создаются один раз. Обычный deploy не пересоздаёт production D1/DO, не выполняет reset/reseed и не подставляет synthetic users. Миграции: expand -> совместимый код -> возобновляемый backfill -> проверка -> feature flag; contract отдельным релизом.

Откат Worker не откатывает БД. Перед schema change испытывать N/N+1 на непустой synthetic DB. При recovery учитывать записи после backup и deny/tombstone state. Не восстанавливать старую разрешённую session поверх последующего отзыва. Потеря KEK может потребовать повторного входа в Telegram; не рекламировать безусловное восстановление.

## 7. Безопасный self-host

Fork/clone -> собственные Cloudflare ресурсы по шаблону -> свои Telegram app/bot credentials -> свои encryption keys -> свой IDP issuer/client для admin -> migrations -> OAuth/MTProto/security tests -> собственные домены. Шаблоны не содержат production resource IDs. Настройки безопасности по умолчанию одинаковы для hosted и self-host.

Для старта допускается Free. Если реальные измерения требуют Paid или другого платного компонента, показать причину и оценку, дождаться согласия. Не подключать Google/VPS/Containers/R2 скрытым запасным путём.
