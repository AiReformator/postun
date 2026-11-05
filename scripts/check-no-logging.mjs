#!/usr/bin/env node
// No-logs policy guard (docs/03): Postun never records message content, search queries, files or tool results.
// Fails CI if any Worker enables Cloudflare logs/observability/tail/logpush (in any environment), or if source code
// calls console.* with anything other than a single constant string (no data can be interpolated into logs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];
// Removes line and block comments outside strings, then trailing commas (enough for wrangler.jsonc).
function stripJsonc(src) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += src[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

for (const app of readdirSync('apps')) {
  const file = join('apps', app, 'wrangler.jsonc');
  let cfg;
  try {
    cfg = JSON.parse(stripJsonc(readFileSync(file, 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT') continue;
    problems.push(`${file}: cannot parse (${e.message})`);
    continue;
  }
  const scopes = [['top-level', cfg], ...Object.entries(cfg.env ?? {})];
  for (const [name, c] of scopes) {
    const o = c.observability;
    if (!o || o.enabled !== false) problems.push(`${file} [${name}]: observability.enabled must be false`);
    if (o?.logs && (o.logs.enabled !== false || o.logs.invocation_logs === true)) problems.push(`${file} [${name}]: observability.logs must be disabled`);
    if (c.logpush) problems.push(`${file} [${name}]: logpush must not be enabled`);
    if (c.tail_consumers?.length) problems.push(`${file} [${name}]: tail_consumers are not allowed`);
  }
}

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const sources = readdirSync('apps').flatMap((a) => {
  try {
    return walk(join('apps', a, 'src'));
  } catch {
    return [];
  }
}).concat(walk('packages/contracts/src')).filter((f) => /\.(ts|mjs|js)$/.test(f));
for (const f of sources) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/console\.(\w+)\(([^)]*)\)/g)) {
    if (!/^'[^'\\]*'$/.test(m[2].trim())) problems.push(`${f}: console.${m[1]} must log one constant string only, got (${m[2].trim().slice(0, 60)})`);
  }
}

if (problems.length) {
  console.error(`no-logging check failed:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`no-logging check: ${sources.length} source files and all Worker configs clean`);
