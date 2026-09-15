import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationSummary } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { conversationTitle, threadStanding } from './conversation-title';

/**
 * Naming a conversation (T-244).
 *
 * A group's room and every one of its match threads carry the same `group` and
 * no members of their own, so the failure to guard against is the quiet one: a
 * list that named them all by their group would show several entries with one
 * name and no way to tell them apart. Every kind in the contract gets a branch,
 * and the last test reads the contract rather than this file.
 */
const CONTRACT = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'src', 'conversations.ts'),
  'utf8',
);

const base: ConversationSummary = {
  id: 'c1',
  kind: 'direct',
  group: null,
  fixture: null,
  members: [],
  last_message: null,
  unread: 0,
  muted: false,
  left: false,
  their_read_seq: null,
};

const match = {
  id: 'f1',
  home: 'Liverpool',
  away: 'Esteghlal',
  score: null,
  status: 'scheduled',
  kickoff_at: '2099-03-01T15:00:00.000Z',
  last_updated_at: '2099-02-01T00:00:00.000Z',
};

describe('what a conversation is called', () => {
  it('names a direct conversation by whoever else is in it', () => {
    const title = conversationTitle(
      {
        ...base,
        members: [
          { username: 'me', display_name: 'Me' },
          { username: 'ada', display_name: 'Ada Lovelace' },
        ],
      },
      'me',
    );
    expect(title).toBe('Ada Lovelace');
  });

  it('names a group room by its group', () => {
    const title = conversationTitle(
      { ...base, kind: 'group', group: { slug: 'terrace', name: 'The Open Terrace' } },
      'me',
    );
    expect(title).toBe('The Open Terrace');
  });

  it('names a thread by its match and its group', () => {
    // Both halves: the match, because that is what the thread is about, and the
    // group, because a member is in several and the same match can have a
    // thread in each of them.
    const title = conversationTitle(
      {
        ...base,
        kind: 'group_thread',
        group: { slug: 'terrace', name: 'The Open Terrace' },
        fixture: match,
      },
      'me',
    );
    expect(title).toBe('Liverpool v Esteghlal · The Open Terrace');
  });

  it('says a match is missing rather than naming one it cannot see', () => {
    const title = conversationTitle(
      { ...base, kind: 'group_thread', group: { slug: 'terrace', name: 'The Open Terrace' } },
      'me',
    );
    expect(title).toBe('The Open Terrace · a match');
  });

  it('shows the standing a match has now, and only for a thread', () => {
    const thread: ConversationSummary = {
      ...base,
      kind: 'group_thread',
      group: { slug: 'terrace', name: 'The Open Terrace' },
      fixture: match,
    };
    expect(threadStanding(thread)).toBe('scheduled');
    expect(threadStanding({ ...thread, fixture: { ...match, score: { home: 2, away: 1 } } })).toBe(
      '2–1 · scheduled',
    );
    expect(threadStanding({ ...base, kind: 'group', fixture: null })).toBeNull();
  });

  it('has a branch for every kind the contract allows', () => {
    // Read from the contract, not typed out here: a kind added there and
    // forgotten here is a list entry with a name that tells a reader nothing.
    const body = /export const CONVERSATION_KINDS = \[([^\]]*)\]/.exec(CONTRACT)?.[1] ?? '';
    const kinds = [...body.matchAll(/'([a-z_]+)'/g)].map((found) => found[1] ?? '');
    const source = readFileSync(join(__dirname, 'conversation-title.ts'), 'utf8');

    expect(kinds.length).toBeGreaterThanOrEqual(3);
    for (const kind of kinds) {
      expect(source, `no branch for ${kind}`).toContain(`case '${kind}'`);
    }
  });
});
