# Publication policy

English is canonical. [Русская версия ниже](#политика-публикации).

Postun follows Kerckhoffs's principle: the system must stay secure even when everything except the keys is public. What we publish, and where, follows from that.

| Category | Where it is published | Why |
|---|---|---|
| **Code and everything needed to verify it**: application source, tests, CI and security checks, build and deployment configuration templates, data-retention rules as implemented in code, threat model and security/privacy design docs, acceptance results | **GitHub** (this repository), always | Anyone must be able to check how encryption, access control, the no-logs rule and data retention actually work. If it affects behaviour, it is in the repository. |
| **Legal documents**: beta terms, privacy / data-handling policy | **postun.org** (the site) — the English version is authoritative; translations say the English version prevails | Users accept them on the site. Their source text lives in the site code here, but the binding published version is the one on postun.org. |
| **Secrets and private operations data**: keys, tokens, real resource IDs, private inventories, user data, closed security-incident material | **Nowhere public** — Cloudflare secrets and private storage outside the repository | Security depends on keys, not on hiding code. Secret scanning and push protection guard the repository. |
| **Marketing materials**: keyword research / semantic core, campaign plans, competitor notes, drafts of descriptions | **Not published** | Not needed to verify the system. Kept outside the repository; `docs/seo/` is git-ignored and CI rejects such files. |

Data retention: the rules are fixed in code and tests (see `docs/03_SECURITY_PRIVACY.md`, the Durable Object schema and retention alarms, and `scripts/check-no-logging.mjs`). The site's data-handling page describes the same rules for users. Postun keeps no logs of conversations, search queries, files or tool results.

Enforcement in CI: `scripts/check-no-secrets.mjs` (secrets and forbidden marketing paths), `scripts/check-no-logging.mjs` (no logs), GitHub secret scanning with push protection.

---

## Политика публикации

Основная версия — английская (выше).

Postun следует принципу Керкгоффса: система должна оставаться защищённой, даже если публично всё, кроме ключей. Из этого следует, что и где мы публикуем.

| Категория | Где публикуется | Зачем |
|---|---|---|
| **Код и всё, что нужно для его проверки**: исходный код, тесты, CI и проверки безопасности, шаблоны конфигурации сборки и развёртывания, правила хранения данных в том виде, как они реализованы в коде, модель угроз и документы по безопасности и приватности, результаты приёмки | **GitHub** (этот репозиторий), всегда | Любой должен иметь возможность проверить, как на самом деле работают шифрование, контроль доступа, отказ от журналов и сроки хранения. Всё, что влияет на поведение, — в репозитории. |
| **Юридические документы**: условия беты, политика обработки данных | **postun.org** (сайт); основной считается английская версия, в переводах указано, что при расхождении действует английская | Пользователи принимают их на сайте. Исходный текст хранится в коде сайта, но юридически действует версия, опубликованная на postun.org. |
| **Секреты и закрытые эксплуатационные данные**: ключи, токены, реальные ID ресурсов, приватные инвентари, данные пользователей, материалы закрытых инцидентов | **Нигде публично** — секреты Cloudflare и закрытое хранилище вне репозитория | Безопасность держится на ключах, а не на сокрытии кода. Репозиторий защищают сканирование секретов и блокировка push. |
| **Маркетинговые материалы**: семантическое ядро и исследования запросов, планы кампаний, заметки о конкурентах, черновики описаний | **Не публикуются** | Для проверки системы они не нужны. Хранятся вне репозитория; `docs/seo/` исключён из git, CI отклоняет такие файлы. |

Хранение данных: правила зафиксированы в коде и тестах (`docs/03_SECURITY_PRIVACY.md`, схема Durable Object и задачи очистки, `scripts/check-no-logging.mjs`). Страница обработки данных на сайте описывает те же правила для пользователей. Postun не ведёт журналов переписки, поисковых запросов, файлов и ответов инструментов.
