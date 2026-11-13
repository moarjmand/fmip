import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EN } from '@/i18n/messages';
import { matchWords } from '@/lib/words-server';
import { liveSlots } from '@/components/match-live-slots';

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
  } as unknown as MatchCentre;
}
const answer = (data: MatchCentre) => ({ ok: true, status: 200, data, setCookie: null });

afterEach(() => read.mockReset());

describe('refreshLiveModules: what it accepts', () => {
  it('asks nothing for a malformed id, an unknown locale or an unknown zone', async () => {
    expect(await refreshLiveModules('not-a-uuid', 'en', ZONE)).toBeNull();
    expect(await refreshLiveModules(ID, 'xx', ZONE)).toBeNull();
    expect(await refreshLiveModules(ID, 'en', 'Mars/Olympus')).toBeNull();
    expect(await refreshLiveModules(ID, 'en', 5 as unknown as string)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('is a public, read-only server function: no cookie, no write, nothing drawn from the client', () => {
    expect(SOURCE.startsWith("'use server';")).toBe(true);
    expect(SOURCE).not.toMatch(/cookies\(|sessionCookieHeader|cookie:|fetchMe\(/);
    expect(SOURCE).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'|revalidate/);
    // Three arguments, the match read by the server itself.
    expect(SOURCE).toMatch(
      /refreshLiveModules\(\s*fixtureId: string,\s*locale: string,\s*timeZone: string,\s*\)/,
    );
  });
});

describe('refreshLiveModules: what it draws', () => {
  it('asks for the match in the page’s locale and draws its key events while it is on', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    const modules = await refreshLiveModules(ID, 'en', ZONE);
    expect(read).toHaveBeenCalledWith(ID, 'en');
    const html = renderToStaticMarkup(<>{modules?.keyEvents}</>);
    expect(html).toContain('data-testid="timeline"');
    expect(html).toContain('Key events');
    expect(html).toContain('Salah');
  });

  it('says "Not in yet" for a live match with no events from the feed (rule 3)', async () => {
    read.mockResolvedValue(answer(match('live', null)));
    const html = renderToStaticMarkup(<>{(await refreshLiveModules(ID, 'en', ZONE))?.keyEvents}</>);
    expect(html).toContain('data-testid="timeline"');
    expect(html).toContain(EN['matchCentre.notInYet']);
    expect(html).not.toContain('Not supplied for this match.');
  });

  it('draws the same cards as the page in every state (`liveSlots`, T-1812)', async () => {
    const c = match('scheduled', null);
    read.mockResolvedValue(answer(c));
    const modules = await refreshLiveModules(ID, 'en', ZONE);
    const words = matchWords('en');
    const drawn = liveSlots({ centre: c, locale: 'en', timeZone: ZONE, words });
    expect(Object.keys(modules ?? {})).toEqual(Object.keys(drawn));
    expect(renderToStaticMarkup(<>{modules?.keyEvents}</>)).toBe(
      renderToStaticMarkup(<>{drawn.keyEvents}</>),
    );
    // Before kick-off the card has no "kicked off" row.
    expect(renderToStaticMarkup(<>{modules?.keyEvents}</>)).not.toContain(
      EN['matchCentre.kickedOff'],
    );
  });

  it('is null when the match cannot be read: the page keeps what it has', async () => {
    read.mockResolvedValue({ ok: false, status: 0, error: null, setCookie: null });
    expect(await refreshLiveModules(ID, 'en', ZONE)).toBeNull();
    read.mockResolvedValue({ ok: false, status: 404, error: null, setCookie: null });
    expect(await refreshLiveModules(ID, 'en', ZONE)).toBeNull();
  });
});

describe('refreshLiveModules: calls that arrive together share one read', () => {
  it('one read for a burst of the same match and locale, a new one after it settles', async () => {
    let settle: (value: unknown) => void = () => undefined;
    read.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const calls = [1, 2, 3].map(() => refreshLiveModules(ID, 'en', ZONE));
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    settle(answer(match('live', [goal])));
    const results = await Promise.all(calls);
    expect(results.every((r) => r !== null && r.keyEvents !== undefined)).toBe(true);
    read.mockResolvedValue(answer(match('live', [goal])));
    await refreshLiveModules(ID, 'en', ZONE);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('another locale is another read: the names are in the reader’s language', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    await Promise.all([refreshLiveModules(ID, 'en', ZONE), refreshLiveModules(ID, 'fa', ZONE)]);
    expect(read.mock.calls).toEqual([
      [ID, 'en'],
      [ID, 'fa'],
    ]);
  });
});
