#!/usr/bin/env node
// Docs guard: relative markdown links resolve to tracked files, required public docs exist,
// code fences are closed, and every tracked *.json parses. Exits 1 with file:line messages.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, posix } from 'node:path';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter((f) => existsSync(f)); // skip files staged for deletion but still in the index
const set = new Set(tracked);
const dirs = new Set();
for (const f of tracked) for (let d = dirname(f); d !== '.' && !dirs.has(d); d = dirname(d)) dirs.add(d);
const problems = [];
const fail = (file, line, msg) => problems.push(`${file}:${line}: ${msg}`);

const required = [
  'SECURITY.md', 'CONTRIBUTING.md', 'LICENSE',
  'docs/02_ARCHITECTURE.md', 'docs/03_SECURITY_PRIVACY.md', 'docs/04_DEPLOYMENT.md',
  'docs/05_ACCEPTANCE.md', 'docs/06_ADMIN_OIDC.md', 'docs/07_SOURCES.md', 'docs/PUBLICATION_POLICY.md',
];
for (const f of required) if (!set.has(f)) fail(f, 0, 'required public document is missing or untracked');
if (!tracked.some((f) => /^README(\.[\w-]+)?\.md$/.test(f))) fail('README.md', 0, 'README*.md is missing');

for (const f of tracked) {
  if (f.endsWith('.json')) {
    try { JSON.parse(readFileSync(f, 'utf8')); } catch (e) { fail(f, 1, `invalid JSON: ${e.message}`); }
  }
  if (!f.endsWith('.md')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  let fence = null;
  lines.forEach((text, i) => {
    const n = i + 1;
    const m = /^\s*(`{3,}|~{3,})/.exec(text);
    if (m) {
      if (!fence) fence = { ch: m[1][0], len: m[1].length, line: n };
      else if (m[1][0] === fence.ch && m[1].length >= fence.len && /^\s*(`{3,}|~{3,})\s*$/.test(text)) fence = null;
      return;
    }
    if (fence) return;
    const noCode = text.replace(/`[^`]*`/g, '');
    for (const l of noCode.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      let target = l[1];
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
      target = target.split('#')[0].split('?')[0];
      if (!target) continue;
      try { target = decodeURIComponent(target); } catch { /* keep raw */ }
      const resolved = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(dirname(f), target));
      const clean = resolved.replace(/\/$/, '');
      if (!set.has(clean) && !dirs.has(clean)) fail(f, n, `broken link: ${l[1]}`);
    }
  });
  if (fence) fail(f, fence.line, 'unclosed code fence');
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`check-docs: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check-docs: ok (${tracked.filter((f) => f.endsWith('.md')).length} markdown files)`);
