// Language selection without cookies or a server: an explicit choice (language switcher) is remembered in
// localStorage; otherwise the browser language picks a locale. Only the default (English, unprefixed) pages
// redirect, so a direct link to /ru/, /es/, /pt/ or /de/ is always honoured.
(function () {
  var LOCALES = ['en', 'ru', 'es', 'pt', 'de'];
  var KEY = 'postun.lang';
  var get = function () {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  var set = function (v) {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* storage unavailable: choice simply is not remembered */
    }
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-lang]') : null;
    if (a && LOCALES.indexOf(a.getAttribute('data-lang')) >= 0) set(a.getAttribute('data-lang'));
  });

  var current = document.documentElement.getAttribute('data-locale') || 'en';
  // The target is built only from fixed values (known pages, known locale prefixes), never from URL text.
  var PAGES = ['/', '/privacy/', '/terms/', '/app/'];
  var m = /^\/(?:(ru|es|pt|de)\/)?(privacy\/|terms\/|app\/)?$/.exec(location.pathname);
  if (!m) return;
  var page = PAGES.indexOf('/' + (m[2] || ''));
  if (page < 0) return;
  // app.postun.org/ serves the cabinet.
  if (location.hostname.indexOf('app.') === 0 && page === 0) page = 3;
  var want = current;
  if (current === 'en') {
    var saved = get();
    if (LOCALES.indexOf(saved) >= 0) {
      want = saved;
    } else {
      var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
      for (var i = 0; i < langs.length; i++) {
        var base = String(langs[i] || '').toLowerCase().split('-')[0];
        if (LOCALES.indexOf(base) >= 0) {
          want = base;
          break;
        }
      }
    }
  }
  var prefix = { en: '', ru: '/ru', es: '/es', pt: '/pt', de: '/de' }[want === current ? current : want];
  var target = prefix + PAGES[page];
  if (target !== location.pathname) location.replace(target);
})();
