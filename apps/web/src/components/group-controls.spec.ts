import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The group surfaces' guards (T-242).
 *
 * The acceptance criterion is **a private group is not discoverable, and an
 * invite-only one is not joinable**, and the interesting thing about both halves
 * is that this page does not enforce either. The API answers 404 for an
 * invite-only group nobody may know about and `members: null` for a
 * discoverable one, so there is no filter here to forget. What these guards
 * check is that the page *says* so rather than rendering an absence as a fact —
 * and that every standing the contract allows has a branch, because a standing
 * with no branch is a page that quietly offers nothing.
 */

const HERE = __dirname;
const CONTROLS = readFileSync(join(HERE, 'group-controls.tsx'), 'utf8');
const DIRECTORY = readFileSync(join(HERE, '..', 'app', '[locale]', 'groups', 'page.tsx'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'groups', '[slug]', 'page.tsx'),
  'utf8',
);
const CONTRACT = readFileSync(
  join(HERE, '..', '..', '..', '..', 'packages', 'contracts', 'src', 'groups.ts'),
  'utf8',
);

/** Read from the contract rather than typed out here. */
function list(name: string): string[] {
  const body = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(CONTRACT)?.[1] ?? '';
  return [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('every standing a group can have is answered', () => {
  it('has a branch for each one in the contract', () => {
    // Adding a standing and forgetting the branch would render a page with no
    // control and no explanation. Reading the list from the contract makes that
    // a failing test rather than an empty corner.
    for (const standing of list('GROUP_STANDINGS')) {
      expect(CONTROLS, `no branch for ${standing}`).toContain(`'${standing}'`);
    }
    expect(list('GROUP_STANDINGS').length).toBeGreaterThanOrEqual(9);
  });

  it('offers nothing to press on an invite-only group, and says why', () => {
    // A button that would always be refused is a worse answer than the
    // sentence. This is the "not joinable" half of the acceptance criterion as
    // a reader meets it.
    expect(CONTROLS).toContain('data-testid="group-invite-only"');
    expect(CONTROLS).toMatch(/joined by invitation/);
  });

  it('asks rather than joins where asking is the way in', () => {
    expect(CONTROLS).toContain('data-testid="group-ask"');
    expect(CONTROLS).toContain('testId="group-join"');
    expect(CONTROLS).toContain('askToJoinGroupAction');
  });

  it('never says why a group is unavailable', () => {
    // A member under a sanction hears about it from the surface that owns that
    // conversation, not from every group page they open.
    const unavailable = /group-unavailable"[\s\S]{0,200}/.exec(CONTROLS)?.[0] ?? '';
    expect(unavailable).not.toMatch(/sanction|block|restrict/i);
  });
});

describe('what the surfaces say about what they were not given', () => {
  it('states that a group can be found without being read', () => {
    // `members: null` is not an empty list, and rendering it as one would say
    // "nobody is in it", which of a group is never true.
    expect(PAGE).toContain('group.members === null');
    expect(PAGE).toContain('data-testid="group-members-hidden"');
    expect(PAGE).not.toMatch(/members\?\.length === 0/);
  });

  it('says the directory is not everything', () => {
    // The "not discoverable" half: an invite-only group is absent from the
    // answer, and a reader is told that rather than left to assume the list is
    // the world.
    expect(DIRECTORY).toContain('data-testid="group-directory-note"');
    expect(DIRECTORY).toMatch(/joined by invitation are not listed/);
  });

  it('states each absence rather than rendering nothing', () => {
    for (const testId of [
      'my-groups-none',
      'group-directory-none',
      'group-directory-unreachable',
      'my-groups-unreachable',
    ]) {
      expect(DIRECTORY, `no stated absence for ${testId}`).toContain(`data-testid="${testId}"`);
    }
    for (const testId of ['group-queue-none', 'group-queue-unreachable', 'group-unreachable']) {
      expect(PAGE, `no stated absence for ${testId}`).toContain(`data-testid="${testId}"`);
    }
  });
});

describe('the group board is the global board, scoped (T-243)', () => {
  it('borrows the leaderboard labels rather than writing a second set', () => {
    // A second `toFixed`, a second tier table or a second status word here is
    // how "the same rating rules" stops being true on the surface, months after
    // it is still true in the API.
    expect(PAGE).toContain("from '@/lib/leaderboard'");
    expect(PAGE).toContain('ratingLabel(entry)');
    expect(PAGE).toContain('tierLabel(entry.tier)');
    expect(PAGE).not.toMatch(/toFixed\(/);
  });

  it('asks for the board only where the membership is already visible', () => {
    // The board is the membership with numbers beside it, so it is the same
    // question; fetching it anyway and rendering the 403 would ask twice and
    // answer worse.
    expect(PAGE).toContain('group.members === null ? null : await fetchGroupLeaderboard');
  });

  it('states an empty board with the filter that emptied it', () => {
    // The floor does not bend for a small group (D-037). An empty list would
    // read as "nobody is in this group", which is never true of a group.
    expect(PAGE).toContain('data-testid="group-board-none"');
    expect(PAGE).toContain('board.data.min_settled');
    expect(PAGE).toContain('data-testid="group-board-unreachable"');
  });

  it('says what the rank is measured against', () => {
    expect(PAGE).toContain('data-testid="group-board-note"');
    expect(PAGE).toMatch(/same rating as the/);
  });
});

describe('correct before fast', () => {
  it('renders both surfaces on the server', () => {
    expect(DIRECTORY.startsWith("'use client'")).toBe(false);
    expect(PAGE.startsWith("'use client'")).toBe(false);
  });

  it('acts through forms over server actions, one per control', () => {
    // Joining, asking and leaving are the controls a member reaches for when
    // they want out of something or into something; none of them may depend on
    // a script having loaded.
    expect(CONTROLS).toContain('<form action={formAction}');
    expect(CONTROLS).not.toMatch(/onClick|useEffect|addEventListener/);
  });
});
