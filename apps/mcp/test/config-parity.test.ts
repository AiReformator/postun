import { describe, expect, it } from 'vitest';
import authRaw from '../../auth/wrangler.jsonc?raw';
import mcpRaw from '../wrangler.jsonc?raw';

/** Minimal JSONC reader: strips // and /* *\/ comments outside strings and trailing commas. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
}

type Cfg = { vars: Record<string, string>; env?: { staging?: { vars: Record<string, string> } } };
const mcp = parseJsonc(mcpRaw) as unknown as Cfg;
const auth = parseJsonc(authRaw) as unknown as Cfg;

describe('finding 8: mcp and auth agree on issuer and resource hostnames', () => {
  it.each([
    ['production', mcp.vars, auth.vars],
    ['staging', mcp.env?.staging?.vars, auth.env?.staging?.vars]
  ])('%s: AUTH_ISSUER and MCP_RESOURCE are identical in both wrangler files', (_name, m, a) => {
    expect(m).toBeDefined();
    expect(a).toBeDefined();
    expect(m?.AUTH_ISSUER).toBeTruthy();
    expect(m?.MCP_RESOURCE).toBeTruthy();
    expect(m?.AUTH_ISSUER).toBe(a?.AUTH_ISSUER);
    expect(m?.MCP_RESOURCE).toBe(a?.MCP_RESOURCE);
  });

  it('staging uses the agreed hostnames', () => {
    expect(mcp.env?.staging?.vars.AUTH_ISSUER).toBe('https://auth.staging.postun.org');
    expect(mcp.env?.staging?.vars.MCP_RESOURCE).toBe('https://mcp.staging.postun.org/mcp');
  });
});

describe('pacing variables are present with the documented defaults', () => {
  const DEFAULTS: Record<string, string> = {
    PACING_BURST: '60',
    PACING_REFILL_MS: '500',
    PACING_HOURLY_CAP: '5000',
    PACING_LOOKUP_PER_MIN: '60',
    PACING_LOOKUP_BURST: '3',
    PACING_LOOKUP_PER_DAY: '2000',
    PACING_MESSAGES_PER_HOUR: '0',
    PACING_MAX_SMOOTH_MS: '3000',
    PACING_FLOOD_MARGIN_SECONDS: '5',
    FLOOD_AUTO_SLEEP_SECONDS: '3',
    FLOOD_AUTO_RETRIES: '1'
  };
  it.each([
    ['production', mcp.vars],
    ['staging', mcp.env?.staging?.vars]
  ])('%s: wrangler vars match the defaults in code', (_name, vars) => {
    for (const [k, v] of Object.entries(DEFAULTS)) expect(vars?.[k], k).toBe(v);
  });
});
