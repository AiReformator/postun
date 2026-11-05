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
  var path = location.pathname;
  // app.postun.org/ serves the cabinet.
  if (location.hostname.indexOf('app.') === 0 && (path === '/' || /^\/(ru|es|pt|de)\/$/.test(path))) {
    path = path + 'app/';
  }
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
  if (want !== current && current === 'en') path = '/' + want + path;
  if (path !== location.pathname) {
    // Same-origin only: collapse '//' (no protocol-relative URL) and verify the origin before navigating.
    var target = new URL(path.replace(/\/{2,}/g, '/') + location.search + location.hash, location.origin);
    if (target.origin === location.origin) location.replace(target.pathname + target.search + target.hash);
  }
})();
