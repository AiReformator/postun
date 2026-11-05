// Fails if tracked files or build outputs contain secret-looking values (PR-01, B3 "no secrets in bundle").
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const patterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/, 'Telegram bot token'],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}/, 'API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key'],
  [/^(SESSION_KEK|CURSOR_HMAC_KEY|IDENTITY_INDEX_HMAC_KEY|IDENTITY_ENCRYPTION_KEY|WEB_SESSION_KEY|ADMIN_SESSION_KEY|TELEGRAM_API_HASH|[A-Z0-9_]*CLIENT_SECRET)[ \t]*=[ \t]*[^\s#]+/m, 'non-empty secret assignment']
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : []);
const outputs = ['apps/web/dist', 'apps/auth/dist', 'apps/mcp/dist', 'apps/admin/dist'].flatMap(walk);

let bad = 0;
// Publication policy (docs/PUBLICATION_POLICY.md): marketing materials are never published.
for (const file of tracked) {
  if (/^docs\/seo\//.test(file) || /semantic[-_ ]?core|keyword[-_]research/i.test(file)) {
    console.error(`publication policy: marketing material must not be committed: ${file}`);
    bad++;
  }
  // Deploy configs with real resource IDs are rendered in CI only (scripts/deploy/render-wrangler.mjs).
  if (/(^|\/)wrangler\.(deploy\.json|private\.jsonc)$/.test(file)) {
    console.error(`real deploy config must not be committed: ${file}`);
    bad++;
  }
}
for (const file of [...tracked, ...outputs]) {
  if (/\.(docx|png|jpg|wasm|ico)$/.test(file) || file.endsWith('package-lock.json')) continue;
  // Open once and stat/read through the same descriptor (no check-then-read race on the path).
  let fd;
  try {
    fd = openSync(file, 'r');
  } catch {
    continue;
  }
  let text;
  try {
    if (fstatSync(fd).size > 5_000_000) continue;
    text = readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
  for (const [re, what] of patterns) {
    if (re.test(text)) {
      console.error(`secret check: ${what} pattern in ${file}`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log(`secret check: ${tracked.length + outputs.length} files clean`);
