import { describe, expect, it } from 'vitest';
import { CONTROL_SNAPSHOT_FIELDS, controlSnapshotPoint, mcpCallPoint, writeMetric, type ControlSnapshot } from '../src/metrics';

describe('service metric points', () => {
  it('mcp_call has a fixed shape', () => {
    expect(mcpCallPoint({ tool: 'search_messages', outcome: 'RATE_LIMITED', durationMs: 12.6, firstOfDay: true, firstOfMonth: false })).toEqual({
      indexes: ['mcp_call'],
      blobs: ['v1', 'search_messages', 'RATE_LIMITED'],
      doubles: [1, 13, 1, 0]
    });
  });

  it('control_snapshot keeps the published column order and clamps bad numbers to 0', () => {
    const s = Object.fromEntries(CONTROL_SNAPSHOT_FIELDS.map((f, i) => [f, i + 1])) as ControlSnapshot;
    s.web_sessions_live = Number.NaN;
    s.grants_active = -3;
    const p = controlSnapshotPoint(s);
    expect(p.indexes).toEqual(['control_snapshot']);
    expect(p.blobs).toEqual(['v1']);
    expect(p.doubles).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 10, 11, 0]);
  });

  it('writeMetric tolerates a missing or throwing dataset', () => {
    const p = mcpCallPoint({ tool: 'list_accounts', outcome: 'ok', durationMs: 1, firstOfDay: false, firstOfMonth: false });
    expect(() => writeMetric(undefined, p)).not.toThrow();
    expect(() =>
      writeMetric(
        {
          writeDataPoint() {
            throw new Error('x');
          }
        },
        p
      )
    ).not.toThrow();
  });
});
