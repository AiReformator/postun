// Static Pages build: renders HTML from status.json, copies public assets, refuses to ship secrets.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landing, privacy, terms, cabinet } from './src/pages.mjs';
import { robotsTxt, sitemapXml, llmsTxt } from './src/seo.mjs';
import { validateStatus } from './src/render.mjs';
import { LOCALES, checkLocales } from './i18n/index.mjs';
import { build as esbuild } from 'esbuild';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
const status = validateStatus(JSON.parse(readFileSync(join(here, 'status.json'), 'utf8')));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(here, 'public'), out, { recursive: true });

// Every locale must be complete before anything is written (no half-translated site).
const problems = checkLocales();
if (problems.length) throw new Error(`incomplete translations:\n${problems.join('\n')}`);
const pages = {};
for (const l of LOCALES) {
  const dir = l.prefix ? `${l.prefix.slice(1)}/` : '';
  pages[`${dir}index.html`] = landing(status, l.code);
  pages[`${dir}privacy/index.html`] = privacy(l.code);
  pages[`${dir}terms/index.html`] = terms(l.code);
  pages[`${dir}app/index.html`] = cabinet(status, l.code);
}
for (const [file, html] of Object.entries(pages)) {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  writeFileSync(join(out, file), html);
}
writeFileSync(join(out, 'robots.txt'), robotsTxt());
writeFileSync(join(out, 'sitemap.xml'), sitemapXml(status.updated));
writeFileSync(join(out, 'llms.txt'), llmsTxt(status));
// Record exactly which source commit this site was built from (public, non-secret).
const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const dirty = git('status', '--porcelain');
const build = { commit: git('rev-parse', 'HEAD'), dirty: dirty === null ? null : dirty.length > 0 };
writeFileSync(join(out, 'status.json'), JSON.stringify({ ...status, build }, null, 2));

// Cabinet client bundle (single file, no inline scripts; CSP script-src 'self').
await esbuild({
  entryPoints: [join(here, 'src/app.mjs')],
  outfile: join(out, 'assets/app.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning'
});

// The Pages bundle must never contain secrets or private config.
const forbidden = [/SESSION_KEK/, /CLIENT_SECRET/, /HMAC_KEY/, /BEGIN [A-Z ]*PRIVATE KEY/, /github_pat_/, /sk-[A-Za-z0-9]{20,}/, /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(out)) {
  const text = readFileSync(f, 'utf8');
  for (const re of forbidden) if (re.test(text)) throw new Error(`forbidden pattern ${re} in ${f}`);
}
console.log(`built ${walk(out).length} files into dist/`);
