import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The group surfaces for threads and comparisons (T-248).
 *
 * The acceptance criterion is **a thread is opened from the match it is about,
 * and shows what the group called**, and the interesting risk is not either
 * half failing to render. It is the comparison quietly growing a second
 * settlement: a component that decided for itself whether somebody was right
 * would be the defect D-063 refuses one layer down, reappearing on the surface
 * where nobody would think to look for it.
 */
const HERE = __dirname;
const COMPARISON = readFileSync(join(HERE, 'group-comparison.tsx'), 'utf8');
const THREADS = readFileSync(join(HERE, 'match-threads.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'thread-actions.ts'), 'utf8');
const HEADER = readFileSync(join(HERE, 'conversation.tsx'), 'utf8');
const MATCH = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'match', '[id]', 'page.tsx'),
  'utf8',
);

describe('the comparison repeats a verdict and never reaches one', () => {
  it('reads the stored settlement and computes nothing from the score', () => {
    // The whole guard. `outcome_correct` is what settlement decided; comparing
    // a predicted outcome against an actual score here would be a second
    // settlement, and the day the two disagreed the page would contradict the
    // rating (rule 8, D-063).
    expect(COMPARISON).toContain('call.settlement');
    expect(COMPARISON).toContain('settled.outcome_correct');
    expect(COMPARISON).not.toMatch(/actual\.home\s*[><=]|version\.outcome\s*===\s*.*actual/);
  });

  it('says a call is not settled rather than leaving the verdict blank', () => {
    expect(COMPARISON).toMatch(/Not settled yet/);
    expect(COMPARISON).toMatch(/Void/);
  });

  it('counts the silent and the withheld separately, and says both', () => {
    // A list of three calls in a group of eight would otherwise read as the
    // whole group having spoken (rule 3).
    expect(COMPARISON).toContain('data-testid="group-comparison-absent"');
    expect(COMPARISON).toContain('silent');
    expect(COMPARISON).toContain('withheld');
    expect(COMPARISON).toContain('data-testid="group-comparison-none"');
  });

  it('says when a match has not kicked off, because calls can still change', () => {
    expect(COMPARISON).toContain('data-testid="group-comparison-open"');
    expect(COMPARISON).toMatch(/not kicked off/);
  });
});

describe('a thread is opened from the match it is about', () => {
  it('puts the control on the match page', () => {
    expect(MATCH).toContain('<MatchThreads');
    expect(MATCH).toContain('fixtureId={result.data.fixture.id}');
  });

  it('asks nothing before it can draw itself, because opening is idempotent', () => {
    // One button per group whatever the state. A "does this thread exist yet"
    // question per group would be six requests to render one line for a member
    // in six groups, and would be stale by the time it was pressed.
    expect(ACTIONS).toMatch(/idempotent/);
    expect(THREADS).toContain('openThreadAction');
    expect(THREADS).not.toMatch(/fetchGroupThreads|threadFor/);
  });

  it('takes a member into the room rather than telling them one exists', () => {
    expect(ACTIONS).toContain('redirect(`/${locale}/messages/${result.data.id}`)');
  });

  it('tells a member with no groups what a thread needs, and states unreachable apart from empty', () => {
    expect(THREADS).toContain('data-testid="match-threads-none"');
    expect(THREADS).toContain('data-testid="match-threads-unreachable"');
    expect(THREADS).toMatch(/happens inside a group/);
  });

  it('works without JavaScript: a form per control, no click handlers', () => {
    expect(THREADS).toContain('<form action={formAction}');
    expect(THREADS).not.toMatch(/onClick|useEffect|addEventListener/);
  });
});

describe('a thread says which match, at the top of its own page', () => {
  it('names every kind through one helper and links the match', () => {
    expect(HEADER).toContain('conversationTitle(conversation, me)');
    expect(HEADER).toContain('data-testid="conversation-fixture"');
    expect(HEADER).toContain('threadStanding(conversation)');
    // The old title named a group conversation "A conversation with nobody
    // else", because a group's membership is not copied into it (D-058).
    expect(HEADER).not.toMatch(/A conversation with nobody else/);
  });
});
