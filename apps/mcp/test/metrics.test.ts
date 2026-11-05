import { env } from 'cloudflare:workers';
import { METRIC_KIND, METRICS_SCHEMA, type MetricsDataset } from '@postun/contracts';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { toolCaller } from '../src/mcp';
import { setupWorld } from './helpers';

type Point = Parameters<MetricsDataset['writeDataPoint']>[0];

class FakeMetrics implements MetricsDataset {
  points: Point[] = [];
  writeDataPoint(p: Point): void {
    this.points.push(p);
  }
}

const withMetrics = (m: MetricsDataset): Env => ({ ...(env as unknown as Env), METRICS: m });

describe('service metrics: one aggregate point per MCP tool call', () => {
  it('records tool, outcome and first-use flags, and nothing that identifies the principal', async () => {
    const w = await setupWorld();
    const m = new FakeMetrics();
    const call = toolCaller(withMetrics(m), w.props);
    await call('list_dialogs', { account_id: w.accountIds[0], limit: 1 });
    await call('list_dialogs', { account_id: w.accountIds[0], limit: 1 });
    await call('list_accounts', {});
    await call('list_dialogs', { account_id: 'not-a-uuid' });

    expect(m.points.map((p) => p.blobs)).toEqual([
      [METRICS_SCHEMA, 'list_dialogs', 'ok', ''],
      [METRICS_SCHEMA, 'list_dialogs', 'ok', ''],
      [METRICS_SCHEMA, 'list_accounts', 'ok', ''],
      [METRICS_SCHEMA, 'list_dialogs', 'INVALID_INPUT', '']
    ]);
    // double5 = items returned (counts only), double6 = retry-after seconds
    expect(m.points.map((p) => p.doubles?.[5])).toEqual([0, 0, 0, 0]);
    expect(m.points[0]?.doubles?.[4]).toBeGreaterThan(0);
    expect(m.points[3]?.doubles?.[4]).toBe(0);
    expect(m.points.every((p) => p.indexes?.length === 1 && p.indexes[0] === METRIC_KIND.mcpCall)).toBe(true);
    // first counted call of the day and month, then not again; uncounted calls never claim first use
    expect(m.points.map((p) => [p.doubles?.[0], p.doubles?.[2], p.doubles?.[3]])).toEqual([
      [1, 1, 1],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0]
    ]);
    const serialized = JSON.stringify(m.points);
    for (const id of [w.principalId, w.grantId, ...w.accountIds]) expect(serialized).not.toContain(id);
    expect(serialized).not.toContain('not-a-uuid'); // arguments never reach a metric
  });

  it('records QUOTA_EXCEEDED as the outcome code', async () => {
    const w = await setupWorld();
    const m = new FakeMetrics();
    const call = toolCaller(withMetrics(m), w.props);
    for (let i = 0; i < 101; i++) await call('list_dialogs', { account_id: w.accountIds[0], limit: 1 });
    const outcomes = m.points.map((p) => p.blobs?.[2]);
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(100);
    expect(outcomes.at(-1)).toBe('QUOTA_EXCEEDED');
  });

  it('a failing or missing metrics binding never changes the tool result', async () => {
    const w = await setupWorld();
    const broken: MetricsDataset = {
      writeDataPoint() {
        throw new Error('dataset unavailable');
      }
    };
    const viaBroken = await toolCaller(withMetrics(broken), w.props)('list_accounts', {});
    const viaNone = await toolCaller({ ...(env as unknown as Env), METRICS: undefined }, w.props)('list_accounts', {});
    expect('isError' in viaBroken).toBe(false);
    expect('isError' in viaNone).toBe(false);
  });
});
