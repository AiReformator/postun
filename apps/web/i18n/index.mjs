// Site locales. English is the default (unprefixed) site; other locales live under /<code>/.
import en from './en.mjs';
import ru from './ru.mjs';
import es from './es.mjs';
import pt from './pt.mjs';
import de from './de.mjs';

export const SITE = 'https://postun.org';
export const DEFAULT_LOCALE = 'en';

export const LOCALES = [
  { code: 'en', htmlLang: 'en', short: 'EN', prefix: '', dict: en },
  { code: 'ru', htmlLang: 'ru', short: 'RU', prefix: '/ru', dict: ru },
  { code: 'es', htmlLang: 'es', short: 'ES', prefix: '/es', dict: es },
  { code: 'pt', htmlLang: 'pt-BR', short: 'PT', prefix: '/pt', dict: pt },
  { code: 'de', htmlLang: 'de', short: 'DE', prefix: '/de', dict: de }
];

export const locale = (code) => LOCALES.find((l) => l.code === code) ?? LOCALES[0];

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Looks up a dotted key; dictionary values are trusted markup, {vars} are HTML-escaped. Missing keys throw. */
export function translator(dict) {
  return (key, vars = {}) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
    if (typeof v !== 'string') throw new Error(`missing translation: ${key}`);
    return v.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? escHtml(vars[name]) : m));
  };
}

/** Flattens a dictionary into "a.b.c" -> value pairs (used by tests and the build to check completeness). */
export function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
}

/** Every locale must have exactly the source (ru) keys, string values, and the same {placeholders}. */
export function checkLocales() {
  const src = new Map(flatten(ru));
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const problems = [];
  for (const l of LOCALES) {
    const got = new Map(flatten(l.dict));
    for (const [k, v] of src) {
      if (!got.has(k)) problems.push(`${l.code}: missing ${k}`);
      else if (typeof got.get(k) !== 'string') problems.push(`${l.code}: ${k} is not a string`);
      else if (ph(got.get(k)) !== ph(v)) problems.push(`${l.code}: placeholders differ in ${k}`);
    }
    for (const k of got.keys()) if (!src.has(k)) problems.push(`${l.code}: unexpected ${k}`);
  }
  return problems;
}
