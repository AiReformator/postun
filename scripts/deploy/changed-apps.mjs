#!/usr/bin/env node
// Prints which Workers a release must deploy, in deploy order, space-separated (empty: nothing to deploy).
// Usage: node scripts/deploy/changed-apps.mjs <changed|all|admin|mcp|auth|web> [base-sha] [head-sha]
// "changed" diffs base..head, where base is the commit of the last SUCCESSFUL production deployment (the workflow
// reads it from GitHub Deployments), so changes from cancelled, rejected or failed runs are never skipped.
// A missing base, or a base that is not an ancestor of head, means all apps.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APPS } from './render-wrangler.mjs';

/** Files that change every Worker's build or runtime. */
const SHARED = [/^packages\//, /^package(-lock)?\.json$/, /^tsconfig\.base\.json$/, /^\.nvmrc$/];

/** Maps changed paths to the apps whose deploy they affect. Docs, CI and scripts deploy nothing. */
export function appsFor(files) {
  const hit = new Set();
  for (const f of files) {
    if (SHARED.some((re) => re.test(f))) APPS.forEach((a) => hit.add(a));
    const app = /^apps\/([^/]+)\//.exec(f)?.[1];
    if (app && APPS.includes(app)) hit.add(app);
    if (f.startsWith('migrations/control/')) hit.add('auth');
    if (f.startsWith('migrations/admin/')) hit.add('admin');
  }
  return APPS.filter((a) => hit.has(a));
}

const SHA_RE = /^[0-9a-f]{40}$/;

export function plan(mode, before, after, diff) {
  if (mode === 'all') return APPS;
  if (APPS.includes(mode)) return [mode];
  if (mode !== 'changed') throw new Error(`unknown mode: ${mode}`);
  if (!SHA_RE.test(before ?? '') || /^0+$/.test(before) || !SHA_RE.test(after ?? '')) return APPS;
  try {
    return appsFor(diff(before, after));
  } catch {
    return APPS;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode = 'changed', before, after] = process.argv.slice(2);
  const diff = (a, b) => {
    // Throws (-> all apps) when base is not an ancestor of head, e.g. after a history rewrite.
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
    return execFileSync('git', ['diff', '--name-only', a, b], { encoding: 'utf8' }).split('\n').filter(Boolean);
  };
  try {
    console.log(plan(mode, before, after, diff).join(' '));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
