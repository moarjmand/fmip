import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EN } from '@/i18n/messages';
import {
  LIVE_FORMAT,
  type LiveAnswer,
  type LivePart,
  SHARED_FOR_MS,
  type WireNode,
  liveModulesPath,
  liveSignature,
} from '@/lib/live-modules';
import { matchWords } from '@/lib/words-server';
import { fromWire } from '@/components/live-wire';
import { liveSlot, liveSlots } from '@/components/match-live-slots';

/**
 * The live modules' address (D-422, amending D-409 point 2): validated,
 * read-only, public -- no cookie, no reader header, the same bytes for every
 * reader -- one shared read and drawing for calls that arrive together, the
 * cards as data that the page draws back into the same markup, and a short
 * public cache header Cloudflare honours on a `.js` path.
 */

const read = vi.fn();
vi.mock('@/lib/api', () => ({ fetchMatchCentre: (...args: unknown[]) => read(...args) }));

const { liveAnswer, partsOf, serverInstance, toWire } = await import('./live-modules-server');
const { GET } = await import('@/app/api/fixtures/[id]/live.js/route');

const ID = '00000000-0000-4000-8000-000000000901';
const ZONE = 'Europe/London';
const SOURCE = readFileSync(join(__dirname, 'live-modules-server.tsx'), 'utf8');
const ROUTE = readFileSync(
  join(__dirname, '..', 'app', 'api', 'fixtures', '[id]', 'live.js', 'route.ts'),
  'utf8',
);

/** The answer as the page reads it, or `null` for anything but 200. */
async function refreshLiveModules(
  fixtureId: string,
  locale: string,
  timeZone: string,
  parts?: LivePart[] | string,
): Promise<LiveAnswer | null> {
  const named = parts === undefined ? null : Array.isArray(parts) ? parts.join(',') : parts;
  const { status, body } = await liveAnswer(fixtureId, locale, timeZone, named);
  return status === 200 ? (JSON.parse(body) as LiveAnswer) : null;
}

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

/** A card from the wire, drawn as the page draws it. */
const html = (node: WireNode | ReactNode | undefined, wire = true) =>
  renderToStaticMarkup(<>{wire ? fromWire((node ?? null) as WireNode) : (node as ReactNode)}</>);

describe('the live modules’ address: what it accepts', () => {
  it('asks nothing for a malformed id, an unknown locale, an unknown zone or unknown parts', async () => {
    expect(await refreshLiveModules('not-a-uuid', 'en', ZONE)).toBeNull();
    expect(await refreshLiveModules(ID, 'xx', ZONE)).toBeNull();
    expect(await refreshLiveModules(ID, 'en', 'Mars/Olympus')).toBeNull();
    for (const parts of ['', 'clock', 'events,stats,events', 'events,events', 'stats,']) {
      expect(await refreshLiveModules(ID, 'en', ZONE, parts)).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
    expect(partsOf('stats,events')).toEqual(['events', 'stats']);
    expect(partsOf(null)).toEqual(['events', 'stats']);
  });

  it('is public and read-only: no cookie, no reader header, no write', () => {
    for (const source of [SOURCE, ROUTE]) {
      expect(source).not.toMatch(/cookies\(|sessionCookieHeader|cookie:|fetchMe\(|headers\(\)/);
      expect(source).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'|revalidate|'use server'/);
    }
    // Only the address's own parts are read from the request.
    expect(ROUTE).toMatch(/query\.get\('locale'\),\s*query\.get\('tz'\),\s*query\.get\('parts'\)/);
    expect(ROUTE).not.toMatch(/request\.headers/);
  });

  it('reads the right-to-left pseudo-locale as the default language, as the page does (review m1)', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    expect(await refreshLiveModules(ID, 'x-rtl', ZONE)).not.toBeNull();
    expect(read).toHaveBeenCalledWith(ID, 'en');
  });
});

describe('the live modules’ address: what it answers', () => {
  it('a public, two-second answer on a path Cloudflare keeps; failures never kept', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    const path = liveModulesPath(ID, {
      instance: 'i1',
      locale: 'en',
      parts: ['stats', 'events'],
      timeZone: ZONE,
    });
    // One order of the query, so one answer has one key; the path ends in `.js` (T-1461).
    expect(path).toBe(
      `/api/fixtures/${ID}/live.js?b=i1&locale=en&parts=events%2Cstats&tz=Europe%2FLondon`,
    );
    const ok = await GET(
      new Request(`http://web${path}`, { headers: { cookie: 'fmip_session=x' } }),
      {
        params: Promise.resolve({ id: ID }),
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('public, max-age=2, s-maxage=2');
    expect(ok.headers.get('content-type')).toMatch(/^application\/json/);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    // Nothing of the reader varies it or is set on it.
    expect(ok.headers.get('set-cookie')).toBeNull();
    expect(ok.headers.get('vary')).toBeNull();
    const body = (await ok.json()) as LiveAnswer;
    expect(body.v).toBe(LIVE_FORMAT);
    expect(body.instance).toBe(serverInstance());
    // The same bytes without the cookie.
    const guest = await GET(new Request(`http://web${path}`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(await guest.text()).toBe(JSON.stringify(body));
    read.mockResolvedValue({ ok: false, status: 0, error: null, setCookie: null });
    vi.setSystemTime(clockAt + SHARED_FOR_MS);
    const down = await GET(new Request(`http://web${path}`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(down.status).toBe(503);
    expect(down.headers.get('cache-control')).toBe('no-store');
    const bad = await GET(new Request(`http://web/api/fixtures/x/live.js?locale=en&tz=${ZONE}`), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(bad.status).toBe(400);
    expect(bad.headers.get('cache-control')).toBe('no-store');
  });

  it('holds the match’s public cards only: no member, no session, no email', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    const text = JSON.stringify(await refreshLiveModules(ID, 'en', ZONE));
    expect(text).not.toMatch(/email|session|username|cookie|token/i);
  });

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

  it('draws the same markup as the page, slot by slot, in every state (`liveSlots`)', async () => {
    for (const status of ['scheduled', 'live', 'finished'] as const) {
      const c = match(status, status === 'scheduled' ? null : [goal]);
      read.mockResolvedValue(answer(c));
      vi.setSystemTime((clockAt += 10 * SHARED_FOR_MS));
      const answered = await refreshLiveModules(ID, 'en', ZONE);
      const drawn = liveSlots({ centre: c, locale: 'en', timeZone: ZONE, words: matchWords('en') });
      expect(Object.keys(answered?.modules ?? {})).toEqual(Object.keys(drawn));
      for (const slot of Object.keys(drawn) as (keyof typeof drawn)[]) {
        expect(html(answered?.modules[slot])).toBe(html(drawn[slot], false));
      }
    }
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
    await Promise.resolve();
    read.mockResolvedValue({ ok: false, status: 404, error: null, setCookie: null });
    expect(await refreshLiveModules(ID, 'en', ZONE)).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('the live modules’ address: one read and one drawing in a short window (review M1)', () => {
  it('a burst shares one read and one written answer; a new read once the window has passed', async () => {
    let settle: (value: unknown) => void = () => undefined;
    read.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const calls = [1, 2, 3].map(() => liveAnswer(ID, 'en', ZONE, null));
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    settle(answer(match('live', [goal])));
    const results = await Promise.all(calls);
    expect(results.every((r) => r.status === 200)).toBe(true);
    // The same written bytes for every reader: drawn and written once.
    expect(results[1]?.body).toBe(results[0]?.body);
    vi.setSystemTime(clockAt + SHARED_FOR_MS - 1);
    await refreshLiveModules(ID, 'en', ZONE);
    expect(read).toHaveBeenCalledTimes(1);
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
});

describe('a card as data, and back (D-422)', () => {
  it('the client components come back by name: the link, the live age and "may be behind"', async () => {
    const c = match('live', [goal]);
    const card = toWire(
      liveSlot('keyEvents', { centre: c, locale: 'en', timeZone: ZONE, words: matchWords('en') }),
    );
    const text = JSON.stringify(card);
    expect(text).toContain('"i":"link"');
    expect(text).toContain('"i":"behind"');
    expect(text).not.toMatch(/"t":"(function|undefined)"/);
  });

  it('refuses a component it has no name for, loudly', () => {
    const Unknown = () => {
      throw new Error('a client component outside React');
    };
    expect(() => toWire(<Unknown />)).toThrow();
  });
});
