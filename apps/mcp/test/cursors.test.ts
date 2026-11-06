import { describe, expect, it } from 'vitest';
import { encodeDialogOffset, encodeSearchOffset, parseDialogOffset, parseSearchOffset } from '../src/telegram/cursors';

describe('Telegram-native continuation strings', () => {
  it('round-trips a dialog offset and a global search offset', () => {
    const d = { date: 1_700_000_000, id: 4242, peer: 'c:1000:-7' };
    expect(parseDialogOffset(encodeDialogOffset(d))).toEqual(d);
    expect(parseDialogOffset(null)).toBeNull();
    const g = { rate: 123_456, id: 99, peer: 'u:5:123456789' };
    expect(parseSearchOffset(encodeSearchOffset(g))).toEqual(g);
    expect(parseSearchOffset(null)).toBeNull();
  });

  it('refuses old skip cursors with INVALID_INPUT "Cursor expired, start again"', () => {
    for (const parse of [parseDialogOffset, parseSearchOffset]) {
      for (const old of ['0', '100', '500']) {
        let e: unknown;
        try {
          parse(old);
        } catch (x) {
          e = x;
        }
        expect(e).toMatchObject({ code: 'INVALID_INPUT', reason: 'CURSOR_EXPIRED', message: 'Cursor expired, start again' });
      }
    }
  });

  it('is strict about shape and kind: a dialog offset is not a search offset, garbage and injection are refused', () => {
    const d = encodeDialogOffset({ date: 1, id: 2, peer: 'c:1:2' });
    expect(() => parseSearchOffset(d)).toThrow();
    expect(() => parseDialogOffset(encodeSearchOffset({ rate: 1, id: 2, peer: 'c:1:2' }))).toThrow();
    for (const bad of ['d1:1:2', 'd1:a:2:c:1:2', 'd1:1:2:x:1:2', 'd1:1:2:c:1:2:extra', 'd1:-1:2:c:1:2', 'd1:1:2:c:1:2\nfoo', '']) {
      expect(() => parseDialogOffset(bad), bad).toThrow();
    }
  });
});
