import { describe, expect, it } from 'vitest';
import { BUSY_RETRY_SECONDS, duration, isPause, pauseSource, pauseText, toolErrorResult } from '../src/pause';
import { SERVER_INSTRUCTIONS } from '../src/schemas';

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text) as { error: Record<string, unknown> };

describe('a pause is shown to the AI as a pause, not a refusal', () => {
  it('Postun pacing (LOOKUP_CAP) says it is Postun, not Telegram, and asks to repeat the same call', () => {
    const r = toolErrorResult({ code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 4, reason: 'LOOKUP_CAP', hint: 'h' });
    expect(r.isError).toBe(true);
    const { error } = parse(r);
    expect(Object.keys(error)[0]).toBe('status');
    expect(error).toMatchObject({ status: 'paused', code: 'RATE_LIMITED', temporary: true, source: 'postun', retryAfterSeconds: 4, reason: 'LOOKUP_CAP', hint: 'h' });
    const m = String(error.message);
    expect(m.startsWith('PAUSED, not refused')).toBe(true);
    expect(m).toContain('4 seconds');
    expect(m).toContain('not Telegram');
    expect(m).toContain('Repeat exactly the same call');
    expect(m).toContain('now: Postun queues it');
    expect(error.action).toBe('repeat the same call with the same arguments now');
    expect(m).not.toMatch(/limited|refused the|denied/i);
  });
  it('a Telegram FLOOD_WAIT is attributed to Telegram and still framed as a short pause', () => {
    const { error } = parse(toolErrorResult({ code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 25, reason: 'FLOOD_WAIT' }));
    expect(error.source).toBe('telegram');
    expect(String(error.message)).toContain('Telegram itself asked this account to pause');
    expect(String(error.message)).toContain('does not limit what can be found');
    expect(String(error.message)).toContain('Wait 25 seconds, then repeat exactly the same call');
    expect(String(error.message)).not.toContain('short');
    expect(error.action).toBe('wait retryAfterSeconds, then repeat the same call with the same arguments');
  });
  it('a busy account (CONFLICT from the account lock) is a pause with a default wait', () => {
    const { error } = parse(toolErrorResult({ code: 'CONFLICT', message: 'Operation already in progress', reason: 'ACCOUNT_BUSY' }));
    expect(error).toMatchObject({ status: 'paused', code: 'CONFLICT', retryAfterSeconds: BUSY_RETRY_SECONDS, source: 'postun' });
    expect(String(error.message)).toContain('still running');
  });
  it('an operation_id reused for a different request is a real error, not a pause', () => {
    const f = { code: 'CONFLICT' as const, message: 'Operation already in progress', hint: 'use a new operation_id' };
    expect(isPause(f)).toBe(false);
    const { error } = parse(toolErrorResult(f));
    expect(error).toEqual({ code: 'CONFLICT', message: 'Operation already in progress', hint: 'use a new operation_id' });
  });
  it('long pauses tell the AI to say until when the search is on hold, not that it was limited', () => {
    const t = pauseText({ code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 1800, reason: 'HOURLY_CAP' });
    expect(t).toContain('about 30 minutes');
    expect(t).toContain('on hold until then and can be run again; it was not refused or limited');
    const daily = pauseText({ code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 7200, reason: 'LOOKUP_CAP' });
    expect(daily).toContain('daily allowance of global searches');
    expect(daily).not.toContain('one per second');
  });
  it('durations read naturally around unit boundaries', () => {
    expect(duration(1)).toBe('1 second');
    expect(duration(119)).toBe('119 seconds');
    expect(duration(120)).toBe('about 2 minutes');
    expect(duration(150)).toBe('about 3 minutes');
    expect(duration(7199)).toBe('about 2 hours');
    expect(duration(7260)).toBe('about 2 hours');
  });
  it('other errors keep the plain error shape', () => {
    const { error } = parse(toolErrorResult({ code: 'NOT_FOUND', message: 'Not found' }));
    expect(error).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    expect(isPause({ code: 'NOT_FOUND' })).toBe(false);
    expect(pauseSource({ reason: 'SLOWMODE_WAIT' })).toBe('telegram');
  });
  it('server instructions explain pauses and never call them refusals', () => {
    expect(SERVER_INSTRUCTIONS).toContain('status "paused"');
    expect(SERVER_INSTRUCTIONS).toContain('never a refusal');
    expect(SERVER_INSTRUCTIONS).not.toContain('calls are refused');
  });
});
