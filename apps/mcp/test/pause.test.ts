import { describe, expect, it } from 'vitest';
import { BUSY_RETRY_SECONDS, isPause, pauseSource, pauseText, toolErrorResult } from '../src/pause';
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
    expect(m).toContain('repeat exactly the same call');
    expect(m).not.toMatch(/limited|refused the|denied/i);
  });
  it('a Telegram FLOOD_WAIT is attributed to Telegram and still framed as a short pause', () => {
    const { error } = parse(toolErrorResult({ code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 25, reason: 'FLOOD_WAIT' }));
    expect(error.source).toBe('telegram');
    expect(String(error.message)).toContain('Telegram asked this account to pause');
    expect(String(error.message)).toContain('does not limit what can be found');
  });
  it('a busy account (CONFLICT from the account lock) is a pause with a default wait', () => {
    const { error } = parse(toolErrorResult({ code: 'CONFLICT', message: 'Operation already in progress' }));
    expect(error).toMatchObject({ status: 'paused', code: 'CONFLICT', retryAfterSeconds: BUSY_RETRY_SECONDS, source: 'postun' });
    expect(String(error.message)).toContain('still running');
  });
  it('long pauses tell the AI to report when the search continues, not that it was limited', () => {
    const t = pauseText({ code: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 1800, reason: 'HOURLY_CAP' });
    expect(t).toContain('30 minutes');
    expect(t).toContain('do not report that the search was limited or refused');
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
