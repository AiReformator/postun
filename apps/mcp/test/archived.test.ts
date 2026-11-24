import { describe, expect, it } from 'vitest';
import { HELP } from '../src/help';
import { callTool, errCode, setupWorld } from './helpers';

type Dialog = { peerId: string; title: string };
const dialogs = (r: { data: Record<string, unknown> }) => r.data.dialogs as Dialog[];

describe('list_dialogs archived', () => {
  it('lists the main list by default and says so, without any archived chat in it', async () => {
    const w = await setupWorld();
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 100 });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.archived).toBe(false);
    expect(dialogs(r).length).toBe(100);
    expect(dialogs(r).some((d) => d.title.includes('Archived'))).toBe(false);
  });

  it('archived=true returns only the archive, flagged as such, and nothing from the main list', async () => {
    const w = await setupWorld();
    const main = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 100 });
    const a = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], archived: true });
    expect(a.isError, a.raw).toBe(false);
    expect(a.data.archived).toBe(true);
    expect(dialogs(a).map((d) => d.title)).toEqual(['Synthetic Archived Dialog 0', 'Synthetic Archived Dialog 1', 'Synthetic Archived Dialog 2']);
    const mainIds = new Set(dialogs(main).map((d) => d.peerId));
    for (const d of dialogs(a)) expect(mainIds.has(d.peerId), d.title).toBe(false);
    expect(a.data.nextCursor).toBeNull();
  });

  it('pages the archive with its own cursor', async () => {
    const w = await setupWorld();
    const first = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], archived: true, limit: 2 });
    expect(dialogs(first)).toHaveLength(2);
    expect(typeof first.data.nextCursor).toBe('string');
    const second = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], archived: true, limit: 2, cursor: first.data.nextCursor });
    expect(dialogs(second).map((d) => d.title)).toEqual(['Synthetic Archived Dialog 2']);
    expect(second.data.nextCursor).toBeNull();
  });

  it('a cursor of one list is refused by the other, in both directions', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const main = await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 2 });
    const arch = await callTool(w.token, 'list_dialogs', { account_id: acc, archived: true, limit: 2 });
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: acc, archived: true, limit: 2, cursor: main.data.nextCursor }))).toBe('INVALID_CURSOR');
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: acc, limit: 2, cursor: arch.data.nextCursor }))).toBe('INVALID_CURSOR');
  });

  it('history and search work for an archived chat once its peer is known', async () => {
    const w = await setupWorld();
    const acc = w.accountIds[0];
    const peer = dialogs(await callTool(w.token, 'list_dialogs', { account_id: acc, archived: true }))[0]!.peerId;
    const h = await callTool(w.token, 'get_history', { account_id: acc, peer, limit: 2 });
    expect(h.isError, h.raw).toBe(false);
    expect((h.data.messages as unknown[]).length).toBe(2);
    expect((await callTool(w.token, 'search_messages', { account_id: acc, query: 'synth-msg', peer, limit: 2 })).isError).toBe(false);
  });

  it('rejects a non-boolean archived and still defaults to false', async () => {
    const w = await setupWorld();
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], archived: 'yes' }))).toBe('INVALID_INPUT');
    expect((await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], limit: 1 })).data.archived).toBe(false);
  });

  it('the tool description and the help tell the AI to use archived=true', () => {
    expect(HELP['archived-chats'].steps.join(' ')).toContain('archived=true');
    expect(HELP['missing-dialogs'].steps.join(' ')).toContain('archived-chats');
  });

  it('tells the AI to look for a person under both the Cyrillic and the Latin spelling (found a real miss: "Zotov" vs "Зотов")', () => {
    expect(HELP['missing-dialogs'].steps.join(' ')).toMatch(/Cyrillic and the Latin spelling/);
  });
});
