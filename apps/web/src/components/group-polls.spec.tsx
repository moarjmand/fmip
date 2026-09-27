import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GroupPoll } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions need a request; the section only binds them.
vi.mock('@/lib/group-poll-actions', () => {
  const action = async () => null;
  return {
    createPollAction: action,
    votePollAction: action,
    withdrawPollVoteAction: action,
    closePollAction: action,
    removePollAction: action,
  };
});

const { GroupPollsSection } = await import('./group-polls');

/**
 * A group's polls on its page (T-643, D-091). The section draws what the API
 * sent and nothing else: no counts before the member has voted, a stated
 * absence for none and for unreachable, the ceiling of three said in words,
 * and every form a plain server-action form.
 */

const HERE = __dirname;
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'groups', '[slug]', 'page.tsx'),
  'utf8',
);
const SECTION = readFileSync(join(HERE, 'group-polls.tsx'), 'utf8');

const poll = (over: Partial<GroupPoll> = {}): GroupPoll => ({
  id: 'p1',
  question: 'Who wins the derby?',
  options: [
    { id: 'o1', label: 'Home', votes: null },
    { id: 'o2', label: 'Away', votes: null },
  ],
  created_by: 'bo',
  created_at: '2026-09-28T10:00:00.000Z',
  closes_at: '2026-10-05T10:00:00.000Z',
  closed_at: null,
  status: 'open',
  my_vote: null,
  total_votes: null,
  may_close: false,
  may_remove: false,
  ...over,
});

const render = (polls: GroupPoll[] | null) =>
  renderToStaticMarkup(
    <GroupPollsSection
      locale="en"
      slug="derby-club"
      timeZone="UTC"
      result={
        polls === null
          ? { ok: false, status: 0, error: null, setCookie: null }
          : { ok: true, status: 200, data: { polls }, setCookie: null }
      }
    />,
  );

describe('group polls on the group page', () => {
  it('is fetched only for somebody in the group', () => {
    expect(PAGE).toContain("const inside = decides || group.standing === 'member';");
    expect(PAGE).toContain('inside ? await fetchGroupPolls(slug, cookie) : null');
    expect(PAGE).toContain('<GroupPollsSection');
  });

  it('says so when there are none, and when they cannot be fetched', () => {
    expect(render([])).toContain('data-testid="group-polls-none"');
    expect(render(null)).toContain('data-testid="group-polls-unreachable"');
  });

  it('shows no counts before the member votes, and a vote form with every answer', () => {
    const html = render([poll()]);
    expect(html).toContain('data-testid="group-poll-hidden"');
    expect(html).not.toContain('data-testid="group-poll-results"');
    expect(html).toContain('name="option_id" value="o1"');
    expect(html).toContain('name="option_id" value="o2"');
    expect(html).not.toContain('data-testid="group-poll-close"');
    expect(html).not.toContain('data-testid="group-poll-remove"');
  });

  it('shows the counts and the member’s own answer once they have voted', () => {
    const html = render([
      poll({
        my_vote: 'o2',
        total_votes: 3,
        options: [
          { id: 'o1', label: 'Home', votes: 1 },
          { id: 'o2', label: 'Away', votes: 2 },
        ],
        may_close: true,
        may_remove: true,
      }),
    ]);
    expect(html).toContain('data-testid="group-poll-results"');
    expect(html).toContain('2 votes');
    expect(html).toContain('3 votes');
    expect(html).toContain('your answer');
    expect(html).toContain('data-testid="group-poll-withdraw"');
    expect(html).toContain('data-testid="group-poll-close"');
    expect(html).toContain('data-testid="group-poll-remove"');
    expect(html).toContain('name="reason"');
  });

  it('takes no vote on a closed poll', () => {
    const html = render([
      poll({
        status: 'closed',
        closed_at: '2026-09-29T10:00:00.000Z',
        total_votes: 0,
        options: [
          { id: 'o1', label: 'Home', votes: 0 },
          { id: 'o2', label: 'Away', votes: 0 },
        ],
      }),
    ]);
    expect(html).not.toContain('name="option_id"');
    expect(html).toContain('Closed');
  });

  it('offers a new poll until three are open, then says why not', () => {
    expect(render([poll()])).toContain('data-testid="group-poll-create"');
    const full = render([poll({ id: 'a' }), poll({ id: 'b' }), poll({ id: 'c' })]);
    expect(full).not.toContain('data-testid="group-poll-create"');
    expect(full).toContain('data-testid="group-polls-limit"');
  });

  it('uses no physical sides', () => {
    expect(SECTION).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-(?:\d)|text-(?:left|right)/);
  });
});
