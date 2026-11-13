import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EN } from '@/i18n/messages';
import { type LivePart, SHARED_FOR_MS, liveSignature } from '@/lib/live-modules';
import { matchWords } from '@/lib/words-server';
import { liveSlot, liveSlots, prerender } from '@/components/match-live-slots';

/**
 * The server function that draws the match centre's moving modules again
 * (T-1811, D-409 point 2): validated like D-301's, read-only, one shared
 * read for calls that arrive together, `null` when the match cannot be read.
 */

const read = vi.fn();
vi.mock('@/lib/api', () => ({ fetchMatchCentre: (...args: unknown[]) => read(...args) }));

const { refreshLiveModules } = await import('./live-modules-actions');

const ID = '00000000-0000-4000-8000-000000000901';
const ZONE = 'Europe/London';
const SOURCE = readFileSync(join(__dirname, 'live-modules-actions.tsx'), 'utf8');

const covered = <T,>(data: T | null) => ({
  coverage: 'available' as const,
  last_updated_at: '2026-11-13T20:30:00.000Z',
  data,
});
const goal: MatchIncident = {
  id: '00000000-0000-4000-8000-0000000000a1',
  sequence: 1,
  minute: 23,
  added_time: null,
  kind: 'goal',
  side: 'home',
  player: { id: '00000000-0000-4000-8000-0000000000b1', name: 'Mohamed Salah' },
  related_player: null,
  detail: null,
};
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: null,
  coach: null,
  crest: null,
});
function match(status: MatchCentre['fixture']['status'], incidents: MatchIncident[] | null) {
  return {
    fixture: {
      id: ID,
      kickoff_at: '2026-11-13T20:00:00.000Z',
      status,
      minute: 30,
      competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('00000000-0000-4000-8000-0000000000c1', 'Liverpool'),
      away: team('00000000-0000-4000-8000-0000000000c2', 'Chelsea'),
      scores: {
        current: { home: 1, away: 0 },
        half_time: null,
        full_time: null,
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      venue: null,
      is_neutral_venue: false,
      referee: null,
      attendance: null,
      periods: [],
      last_updated_at: '2026-11-13T20:30:00.000Z',
      freshness: null,
    },
    timeline: covered(incidents),
    // The other live slots' modules, as the API sends them (T-1813, T-1814).
    statistics: NONE,
    player_statistics: NONE,
    player_expected_goals: { ...NONE, source: 'highlightly', unplaced: 0 },
    lineups: NONE,
    coverage: {
      scores: 'available',
      incidents: 'available',
      lineups: 'available',
      statistics: 'available',
      standings: 'available',
      availability: 'available',
      advanced_statistics: 'not_supplied',
    },
  } as unknown as MatchCentre;
}
const NONE = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const answer = (data: MatchCentre) => ({ ok: true, status: 200, data, setCookie: null });

// Every test on its own clock, two shared windows apart: the shared read is
// keyed by fixture, locale and zone, and would otherwise answer the next test.
let clockAt = Date.parse('2026-11-13T20:30:00.000Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clockAt += 10 * SHARED_FOR_MS;
  vi.setSystemTime(clockAt);
});
afterEach(() => {
  read.mockReset();
  vi.useRealTimers();
});

const html = (node: unknown) => renderToStaticMarkup(<>{node as ReactNode}</>);

describe('refreshLiveModules: what it accepts', () => {
  it('asks nothing for a malformed id, an unknown locale, an unknown zone or unknown parts', async () => {
    expect(await refreshLiveModules('not-a-uuid', 'en', ZONE)).toBeNull();
    expect(await refreshLiveModules(ID, 'xx', ZONE)).toBeNull();
    expect(await refreshLiveModules(ID, 'en', 'Mars/Olympus')).toBeNull();
    expect(await refreshLiveModules(ID, 'en', 5 as unknown as string)).toBeNull();
    for (const parts of [[], ['clock'], ['events', 'stats', 'events'], 'events']) {
      expect(await refreshLiveModules(ID, 'en', ZONE, parts as LivePart[])).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('is a public, read-only server function: no cookie, no write, nothing drawn from the client', () => {
    expect(SOURCE.startsWith("'use server';")).toBe(true);
    expect(SOURCE).not.toMatch(/cookies\(|sessionCookieHeader|cookie:|fetchMe\(/);
    expect(SOURCE).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'|revalidate/);
    // Four arguments, the match read by the server itself.
    expect(SOURCE).toMatch(
      /refreshLiveModules\(\s*fixtureId: string,\s*locale: string,\s*timeZone: string,\s*parts\?: LivePart\[\],\s*\)/,
    );
  });

  it('reads the right-to-left pseudo-locale as the default language, as the page does (review m1)', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    const answered = await refreshLiveModules(ID, 'x-rtl', ZONE);
    expect(answered).not.toBeNull();
    expect(read).toHaveBeenCalledWith(ID, 'en');
  });
});

describe('refreshLiveModules: what it draws', () => {
  it('asks for the match in the page’s locale and draws its key events while it is on', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    const answered = await refreshLiveModules(ID, 'en', ZONE);
    expect(read).toHaveBeenCalledWith(ID, 'en');
    const card = html(answered?.modules.keyEvents);
    expect(card).toContain('data-testid="timeline"');
    expect(card).toContain('Key events');
    expect(card).toContain('Salah');
  });

  it('says "Not in yet" for a live match with no events from the feed (rule 3)', async () => {
    read.mockResolvedValue(answer(match('live', null)));
    const card = html((await refreshLiveModules(ID, 'en', ZONE))?.modules.keyEvents);
    expect(card).toContain('data-testid="timeline"');
    expect(card).toContain(EN['matchCentre.notInYet']);
    expect(card).not.toContain('Not supplied for this match.');
  });

  it('draws the same cards as the page in every state (`liveSlots`, T-1812)', async () => {
    const c = match('scheduled', null);
    read.mockResolvedValue(answer(c));
    const answered = await refreshLiveModules(ID, 'en', ZONE);
    const words = matchWords('en');
    const drawn = liveSlots({ centre: c, locale: 'en', timeZone: ZONE, words });
    expect(Object.keys(answered?.modules ?? {})).toEqual(Object.keys(drawn));
    for (const slot of Object.keys(drawn) as (keyof typeof drawn)[]) {
      expect(html(answered?.modules[slot])).toBe(html(drawn[slot]));
    }
    // Before kick-off the card has no "kicked off" row.
    expect(html(answered?.modules.keyEvents)).not.toContain(EN['matchCentre.kickedOff']);
  });

  it('draws only the slots that read the parts asked for (review m2)', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    const events = await refreshLiveModules(ID, 'en', ZONE, ['events']);
    expect(Object.keys(events?.modules ?? {}).sort()).toEqual(['keyEvents', 'matchLineups']);
    expect(events?.parts).toEqual(['events']);
    const stats = await refreshLiveModules(ID, 'en', ZONE, ['stats']);
    expect(Object.keys(stats?.modules ?? {}).sort()).toEqual([
      'matchLineups',
      'matchStats',
      'topRated',
    ]);
  });

  it('says what data it drew from: the signature of the read, not of what was asked (review B2)', async () => {
    const before = match('live', []);
    read.mockResolvedValue(answer(before));
    const answered = await refreshLiveModules(ID, 'en', ZONE, ['events']);
    expect(answered?.drawn).toEqual(liveSignature(before));
    expect(answered?.drawn).not.toEqual(liveSignature(match('live', [goal])));
    expect(answered?.readAt).toBe(clockAt);
  });

  it('is null when the match cannot be read, and a failed read is not shared', async () => {
    read.mockResolvedValue({ ok: false, status: 0, error: null, setCookie: null });
    expect(await refreshLiveModules(ID, 'en', ZONE)).toBeNull();
    // Let the failed read be forgotten, then a 404 is asked for afresh.
    await Promise.resolve();
    read.mockResolvedValue({ ok: false, status: 404, error: null, setCookie: null });
    expect(await refreshLiveModules(ID, 'en', ZONE)).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('refreshLiveModules: one read and one drawing for every reader in a short window (review M1)', () => {
  it('a burst shares one read; each card is drawn once; a new read once the window has passed', async () => {
    let settle: (value: unknown) => void = () => undefined;
    read.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const calls = [1, 2, 3].map(() => refreshLiveModules(ID, 'en', ZONE));
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    settle(answer(match('live', [goal])));
    const results = await Promise.all(calls);
    expect(results.every((r) => r !== null && r.modules.keyEvents !== undefined)).toBe(true);
    // The same drawn card object for every reader: drawn once.
    expect(results[1]?.modules.keyEvents).toBe(results[0]?.modules.keyEvents);
    // Within the window a later call is answered from the same read.
    vi.setSystemTime(clockAt + SHARED_FOR_MS - 1);
    await refreshLiveModules(ID, 'en', ZONE);
    expect(read).toHaveBeenCalledTimes(1);
    // After it, a new read.
    read.mockResolvedValue(answer(match('live', [goal])));
    vi.setSystemTime(clockAt + SHARED_FOR_MS);
    const later = await refreshLiveModules(ID, 'en', ZONE);
    expect(read).toHaveBeenCalledTimes(2);
    expect(later?.readAt).toBe(clockAt + SHARED_FOR_MS);
  });

  it('another locale or zone is another read and drawing', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    await Promise.all([
      refreshLiveModules(ID, 'en', ZONE),
      refreshLiveModules(ID, 'fa', ZONE),
      refreshLiveModules(ID, 'en', 'Asia/Tehran'),
    ]);
    expect(read.mock.calls).toEqual([
      [ID, 'en'],
      [ID, 'fa'],
      [ID, 'en'],
    ]);
  });

  it('a card drawn ahead is the same markup React would draw', async () => {
    const c = match('live', [goal]);
    read.mockResolvedValue(answer(c));
    const answered = await refreshLiveModules(ID, 'en', ZONE);
    const words = matchWords('en');
    const card = liveSlot('keyEvents', { centre: c, locale: 'en', timeZone: ZONE, words });
    expect(html(prerender(card))).toBe(html(card));
    expect(html(answered?.modules.keyEvents)).toBe(html(card));
  });
});
