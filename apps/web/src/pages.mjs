import { connectAvailable, esc, statusTable } from './render.mjs';

const REPO = 'https://github.com/AiReformator/postun';

function layout({ title, body, script }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Postun Beta — экспериментальный открытый MCP-коннектор для собственного Telegram-аккаунта. Приглашаем бета-тестеров.">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<header class="top"><div class="wrap row">
<a class="brand" href="/">Postun <span class="badge">Beta</span></a>
<nav><a href="/#how">Как это работает</a><a href="/#status">Статус</a><a href="/privacy/">Данные</a><a href="${REPO}">GitHub</a></nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="wrap foot">
<p>Postun — экспериментальный проект в открытом бета-тестировании. Без SLA и гарантий доступности. Исходный код открыт под лицензией Apache-2.0.</p>
<p><a href="${REPO}">Исходный код</a> · <a href="${REPO}/blob/main/SECURITY.md">Сообщить об уязвимости</a> · <a href="/terms/">Условия беты</a> · <a href="/privacy/">Обработка данных</a></p>
</footer>
${script ? `<script src="${script}" defer></script>` : ''}
</body>
</html>
`;
}

export function landing(status) {
  const open = connectAvailable(status);
  const cta = open
    ? `<a class="btn" href="https://app.postun.org/">Присоединиться к бета-тестированию</a>`
    : `<button class="btn" disabled aria-describedby="cta-note">Присоединиться к бета-тестированию</button>
<p id="cta-note" class="note">Регистрация откроется после проверки входа, подключения аккаунта и MCP-клиентов. Сейчас подключение недоступно — мы не предлагаем авторизацию в непроверенный сервис.</p>`;
  return layout({
    title: 'Postun Beta — Telegram для ваших ИИ-клиентов',
    script: '/assets/host.js',
    body: `
<section class="hero">
<p class="eyebrow">Открытая бета · экспериментальный проект</p>
<h1>Connected, not collected.</h1>
<p class="lead">Postun подключает ваш собственный Telegram-аккаунт к ChatGPT, Claude Code и другим MCP-клиентам — только на чтение и только к тем аккаунтам и функциям, которые вы явно разрешили.</p>
${cta}
</section>

<section id="how" class="grid">
<article><h2>1. Вход</h2><p>Вход через официальный Telegram Login. Номер телефона не запрашивается.</p></article>
<article><h2>2. Подключение аккаунта</h2><p>Отдельное подтверждение переписки: QR-вход Telegram и, если включена, двухэтапная проверка.</p></article>
<article><h2>3. ИИ-клиент</h2><p>Добавьте адрес <code>mcp.postun.org/mcp</code> в MCP-клиент. OAuth Postun выдаёт доступ только к выбранным аккаунтам и функциям.</p></article>
<article><h2>4. Контроль</h2><p>В кабинете видны подключения, клиенты и квота. Любое разрешение можно отозвать, аккаунт — отключить, профиль — удалить.</p></article>
</section>

<section>
<h2>Что умеет бета</h2>
<p>Только чтение: список диалогов, история, поиск, публичные каналы и файлы. Отправки, редактирования и удаления сообщений нет. Анализ, расписания и задачи остаются у вашего ИИ-клиента.</p>
<p>Бесплатный лимит беты — ${esc(String(status.quota_success ?? 100))} успешных операций в календарный месяц UTC на владельца. Служебные запросы и ошибки не считаются.</p>
</section>

<section id="status">
<h2>Статус функций</h2>
<p class="note">Отметка «Проверено» ставится только по результатам приёмочного теста. Обновлено: ${esc(status.updated)}.</p>
${statusTable(status)}
</section>

<section>
<h2>Данные и ограничения</h2>
<ul>
<li>Postun не создаёт архив переписки и не сохраняет файлы: содержимое обрабатывается в памяти и передаётся выбранному вами ИИ-клиенту.</li>
<li>Хранятся зашифрованные Telegram-сессии, разрешения и месячные счётчики. Это не zero-knowledge: сервис в момент запроса видит запрошенное содержимое.</li>
<li>Выбранные данные передаются вашему ИИ-провайдеру по его правилам.</li>
<li>Для тестирования используйте специально подготовленный аккаунт и тестовые данные.</li>
</ul>
<p><a href="/privacy/">Подробно об обработке данных</a></p>
</section>

<section>
<h2>Обратная связь</h2>
<p>Ошибки и предложения — в <a href="${REPO}/issues">GitHub Issues</a> без переписки, документов, кодов входа и токенов. Уязвимости — только через закрытый канал из <a href="${REPO}/blob/main/SECURITY.md">SECURITY.md</a>.</p>
</section>`
  });
}

export function privacy() {
  return layout({
    title: 'Обработка данных — Postun Beta',
    body: `<h1>Обработка данных в Postun Beta</h1>
<p class="note">Редакция 2.0-beta, 04.11.2026. Описывает проектные правила беты; фактические сроки удаления подтверждаются тестами.</p>
<table class="status"><thead><tr><th>Категория</th><th>Политика</th></tr></thead><tbody>
<tr><td>Идентичность и подтверждённые связи</td><td>Пока профиль активен; удаление по запросу с учётом срока резервных копий</td></tr>
<tr><td>Зашифрованная Telegram-сессия</td><td>Пока аккаунт подключён; без экспорта через интерфейс</td></tr>
<tr><td>OAuth-разрешения и хеши токенов</td><td>По сроку действия и до отзыва</td></tr>
<tr><td>Месячные счётчики операций и байтов</td><td>Текущий месяц и два предыдущих</td></tr>
<tr><td>Идентификаторы повторов операций</td><td>До 24 часов, без аргументов и результатов</td></tr>
<tr><td>Состояние входа, QR, ссылки на файл</td><td>Минуты</td></tr>
<tr><td>Административные security-события</td><td>30 дней: кто, действие, псевдонимная цель, результат, время</td></tr>
<tr><td>Сообщения, поисковые фразы, документы</td><td>Не сохраняются</td></tr>
<tr><td>Номер телефона, username, имена файлов</td><td>Не сохраняются по умолчанию</td></tr>
</tbody></table>
<p>Telegram ID хранится только в виде HMAC-индекса и зашифрованного значения. Сессии зашифрованы AES-256-GCM с отдельным ключом на аккаунт. Ключи хранятся в секретах Cloudflare, не в репозитории.</p>
<p>Cloudflare и IDP могут вести собственные инфраструктурные метаданные; Postun не обещает их отсутствия. Администратор продукта не имеет доступа к переписке и сессиям; администратор инфраструктуры технически остаётся частью доверительной модели.</p>`
  });
}

export function terms() {
  return layout({
    title: 'Условия бета-тестирования — Postun Beta',
    body: `<h1>Условия бета-тестирования</h1>
<ul>
<li>Postun — экспериментальный сервис. Возможны ошибки, перерывы и изменения без предупреждения. SLA нет.</li>
<li>Подключая аккаунт, вы подтверждаете участие в эксперименте и передачу выбранных данных своему ИИ-провайдеру.</li>
<li>Мы не обещаем абсолютной конфиденциальности и восстановления удалённых данных.</li>
<li>Бета бесплатна; лимит операций задаётся настройкой и может измениться. Платежей в бете нет.</li>
<li>Не загружайте чужие данные без права на их обработку. Для тестов используйте отдельный аккаунт.</li>
</ul>`
  });
}

export function cabinet(status) {
  return layout({
    title: 'Кабинет — Postun Beta',
    script: '/assets/app.js',
    body: `<h1>Кабинет <span class="badge">Beta</span></h1>
<div id="app" data-auth="https://auth.postun.org" data-registration="${status.registration_open ? 'open' : 'closed'}">
<p class="note">Загрузка…</p>
<noscript><p>Для кабинета нужен JavaScript.</p></noscript>
</div>`
  });
}
