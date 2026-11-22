import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { HELP_TOPIC_IDS, REPORTS_PER_DAY, scrubReportText } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import { HELP, getHelp, helpTopicFor } from '../src/help';
import { syntheticControl } from '../src/telegram/synthetic';
import { callTool, errCode, principalStub, setupWorld } from './helpers';

type Sink = { allReports(): Promise<Record<string, unknown>[]>; failReports(on: boolean): Promise<void> };
const sink = () => env.ADMIN_SINK as unknown as Sink;
const GOOD = { category: 'session_problem', summary: 'Reconnect shows no QR code after pressing the button; error ACCOUNT_NOT_ACTIVE.', user_confirmed: true };

describe('get_help', () => {
  it('lists every topic, and each topic has a cause, situations and ordered steps', async () => {
    const w = await setupWorld();
    const list = await callTool(w.token, 'get_help', {});
    expect(list.isError).toBe(false);
    expect((list.data.topics as { id: string }[]).map((t) => t.id)).toEqual([...HELP_TOPIC_IDS]);
    expect(list.data.support).toMatchObject({ report_tool: 'report_problem' });
    for (const id of HELP_TOPIC_IDS) {
      const t = HELP[id];
      expect(t.title.length, id).toBeGreaterThan(10);
      expect(t.when.length, id).toBeGreaterThan(0);
      expect(t.cause.length, id).toBeGreaterThan(20);
      expect(t.steps.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns one topic with its steps and the public page, and refuses an unknown topic', async () => {
    const w = await setupWorld();
    const r = await callTool(w.token, 'get_help', { topic: 'session-ended' });
    expect(r.data).toMatchObject({ topic: 'session-ended', more: 'https://postun.org/help/#session-ended' });
    expect((r.data.steps as string[]).join(' ')).toContain('Reconnect');
    expect(errCode(await callTool(w.token, 'get_help', { topic: 'no-such-topic' }))).toBe('INVALID_INPUT');
  });

  it('does not touch Telegram, pacing or quota, and works with only the accounts:read scope', async () => {
    const w = await setupWorld({ scopes: ['accounts:read'] });
    const opens = syntheticControl.opens;
    for (let i = 0; i < 3; i++) expect((await callTool(w.token, 'get_help', { topic: 'paused' })).isError).toBe(false);
    expect(syntheticControl.opens).toBe(opens);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);
  });

  it('is refused without a live grant like every other tool', async () => {
    const w = await setupWorld();
    await principalStub(w.principalId).denyGrant(w.principalId, w.grantId);
    expect(errCode(await callTool(w.token, 'get_help', {}))).toBe('GRANT_REVOKED');
  });

  it('every guide step is plain text written by Postun: no placeholder or untrusted-content marker', () => {
    for (const id of HELP_TOPIC_IDS) expect(JSON.stringify(getHelp(id)), id).not.toMatch(/TODO|undefined|\{\{/);
  });

  it('maps the errors an AI client meets to a guide topic', () => {
    expect(helpTopicFor('ACCOUNT_NOT_ACTIVE', 'SESSION_ENDED')).toBe('session-ended');
    expect(helpTopicFor('ACCOUNT_NOT_ACTIVE', undefined)).toBe('no-reconnect-button');
    expect(helpTopicFor('RATE_LIMITED', 'FLOOD_WAIT')).toBe('paused');
    expect(helpTopicFor('QUOTA_EXCEEDED', 'DAILY_QUOTA')).toBe('quota');
    expect(helpTopicFor('INTERNAL', undefined)).toBe('still-stuck');
    expect(helpTopicFor('FORBIDDEN', undefined)).toBeUndefined();
  });
});

describe('report_problem', () => {
  it('stores a confirmed report with a ticket and tells the AI exactly what was kept', async () => {
    const w = await setupWorld();
    const before = (await sink().allReports()).length;
    const r = await callTool(w.token, 'report_problem', { ...GOOD, tool: 'list_dialogs', error_code: 'ACCOUNT_NOT_ACTIVE', error_reason: 'SESSION_ENDED', account_id: w.accountIds[0], client: 'ChatGPT' });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.status).toBe('received');
    expect(String(r.data.ticket)).toMatch(/^PR-/);
    expect(r.data.stored).toMatchObject({ category: 'session_problem', tool: 'list_dialogs', error_code: 'ACCOUNT_NOT_ACTIVE', client: 'ChatGPT', kept_days: 90 });
    expect(String(r.data.review)).toContain('48 hours');
    const all = await sink().allReports();
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)).toMatchObject({ principalRef: w.principalId, category: 'session_problem', tool: 'list_dialogs', errorCode: 'ACCOUNT_NOT_ACTIVE', errorReason: 'SESSION_ENDED', accountRef: w.accountIds[0], client: 'ChatGPT' });
  });

  it('is refused unless the user confirmed, and nothing is stored', async () => {
    const w = await setupWorld();
    const before = (await sink().allReports()).length;
    expect(errCode(await callTool(w.token, 'report_problem', { ...GOOD, user_confirmed: false }))).toBe('INVALID_INPUT');
    const { user_confirmed: _u, ...noFlag } = GOOD;
    expect(errCode(await callTool(w.token, 'report_problem', noFlag))).toBe('INVALID_INPUT');
    expect(errCode(await callTool(w.token, 'report_problem', { ...GOOD, summary: 'too short' }))).toBe('INVALID_INPUT');
    expect(errCode(await callTool(w.token, 'report_problem', { ...GOOD, summary: 'x'.repeat(501) }))).toBe('INVALID_INPUT');
    expect(errCode(await callTool(w.token, 'report_problem', { ...GOOD, category: 'something-else' }))).toBe('INVALID_INPUT');
    expect((await sink().allReports()).length).toBe(before);
  });

  it('scrubs links, @names, phone-like numbers and invisible characters before anything is stored', async () => {
    const w = await setupWorld();
    const raw = 'Bot @inna_demo_bot at https://t.me/inna_demo_bot did not answer; my phone +7 999 123-45-67 and code 123456 on 2026-11-22‮​ ok';
    const r = await callTool(w.token, 'report_problem', { ...GOOD, summary: raw });
    expect(r.isError, r.raw).toBe(false);
    const stored = String((r.data.stored as { summary: string }).summary);
    expect(stored).toBe('Bot @[name] at [link] did not answer; my phone [number] and code [number] on 2026-11-22 ok');
    const last = (await sink().allReports()).at(-1) as { summary: string };
    expect(last.summary).toBe(stored);
    expect(JSON.stringify(last)).not.toMatch(/inna_demo|999|123456|t\.me/);
  });

  it('allows five reports a day, then says so with a hint; a refused report does not use a slot', async () => {
    const w = await setupWorld();
    for (let i = 0; i < REPORTS_PER_DAY; i++) expect((await callTool(w.token, 'report_problem', GOOD)).isError, `report ${i + 1}`).toBe(false);
    const over = await callTool(w.token, 'report_problem', GOOD);
    expect(errCode(over)).toBe('QUOTA_EXCEEDED');
    expect(over.data.error).toMatchObject({ reason: 'DAILY_QUOTA' });
    expect(String((over.data.error as { hint: string }).hint)).toContain('@postun_org');
    // A new UTC day starts again.
    await runInDurableObject(principalStub(w.principalId), (_i, st) => st.storage.sql.exec("UPDATE meta SET v = '2000-01-01:5' WHERE k = 'reports'"));
    expect((await callTool(w.token, 'report_problem', GOOD)).isError).toBe(false);
  });

  it('when the admin store is down the report fails cleanly and the slot is given back', async () => {
    const w = await setupWorld();
    await sink().failReports(true);
    try {
      for (let i = 0; i < REPORTS_PER_DAY + 2; i++) {
        const r = await callTool(w.token, 'report_problem', GOOD);
        expect(errCode(r)).toBe('UPSTREAM_UNAVAILABLE');
        expect(String((r.data.error as { hint: string }).hint)).toContain('@postun_org');
      }
    } finally {
      await sink().failReports(false);
    }
    expect((await callTool(w.token, 'report_problem', GOOD)).isError).toBe(false); // still has all its slots
  });

  it('only accounts of the grant may be named; an ended account may be (that is what the report is about)', async () => {
    const w = await setupWorld();
    expect(errCode(await callTool(w.token, 'report_problem', { ...GOOD, account_id: crypto.randomUUID() }))).toBe('ACCOUNT_NOT_IN_GRANT');
    syntheticControl.sessionsEnded = true;
    await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    const r = await callTool(w.token, 'report_problem', { ...GOOD, account_id: w.accountIds[0], error_reason: 'SESSION_ENDED' });
    expect(r.isError, r.raw).toBe(false);
  });

  it('never touches Telegram or the quota, and works with only the accounts:read scope', async () => {
    const w = await setupWorld({ scopes: ['accounts:read'] });
    const opens = syntheticControl.opens;
    expect((await callTool(w.token, 'report_problem', GOOD)).isError).toBe(false);
    expect(syntheticControl.opens).toBe(opens);
    expect((await principalStub(w.principalId).getUsage(w.principalId)).successCount).toBe(0);
  });

  it('is refused without a live grant', async () => {
    const w = await setupWorld();
    await principalStub(w.principalId).denyGrant(w.principalId, w.grantId);
    expect(errCode(await callTool(w.token, 'report_problem', GOOD))).toBe('GRANT_REVOKED');
  });

  it('the daily report counter is wiped with the profile', async () => {
    const w = await setupWorld();
    await callTool(w.token, 'report_problem', GOOD);
    const stub = principalStub(w.principalId);
    await stub.deletePrincipal(w.principalId);
    const left = await runInDurableObject(stub, (_i, st) => st.storage.sql.exec("SELECT COUNT(*) AS n FROM meta WHERE k = 'reports'").one().n);
    expect(left).toBe(0);
  });
});

describe('scrubReportText', () => {
  it('keeps ordinary words, ISO dates and short numbers, and cuts to 500 characters', () => {
    expect(scrubReportText('Listed 20 dialogs on 2026-11-22, expected more.')).toBe('Listed 20 dialogs on 2026-11-22, expected more.');
    expect(scrubReportText('a'.repeat(900))).toHaveLength(500);
  });
  it('removes what identifies people or chats', () => {
    expect(scrubReportText('see www.example.com/x and http://a.b/c?d=1 or t.me/some_chat')).toBe('see [link] and [link] or [link]');
    expect(scrubReportText('ping @alice_b and @bo')).toBe('ping @[name] and @bo');
    expect(scrubReportText('call +1 (555) 010-9999 or 89991234567')).toBe('call [number] or [number]');
  });
  it('turns control and bidi characters into spaces', () => {
    expect(scrubReportText('a\u0000b​c‮d e\nf')).toBe('a b c d e f');
  });
});
