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
  liveQuery,
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

const { canonicalZone, liveAnswer, partsOf, serverInstance, toWire } =
  await import('./live-modules-server');
const { GET } = await import('@/app/api/fixtures/[id]/live.js/route');

const ID = '00000000-0000-4000-8000-000000000901';
const ZONE = 'Europe/London';
const SOURCE = readFileSync(join(__dirname, 'live-modules-server.tsx'), 'utf8');
const ROUTE = readFileSync(
  join(__dirname, '..', 'app', 'api', 'fixtures', '[id]', 'live.js', 'route.ts'),
  'utf8',
);

/** The query the page writes, for this server process. */
const query = (locale: string, timeZone: string, parts: readonly string[] = ['events', 'stats']) =>
  `?${liveQuery({ instance: serverInstance(), locale, parts, timeZone })}`;

/** The answer as the page reads it, or `null` for anything but 200. */
async function refreshLiveModules(
  fixtureId: string,
  locale: string,
  timeZone: string,
  parts?: LivePart[],
): Promise<LiveAnswer | null> {
  const { status, body } = await liveAnswer(fixtureId, query(locale, timeZone, parts));
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

describe('the live modules’ address: what it accepts (review R2-B1)', () => {
  const status = async (id: string, search: string) => (await liveAnswer(id, search)).status;
  const b = () => serverInstance();

  it('answers only the query the page writes', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    expect(await status(ID, query('en', ZONE))).toBe(200);
    expect(await status(ID, query('en', ZONE, ['events']))).toBe(200);
    expect(await status(ID, query('en', ZONE, ['stats']))).toBe(200);
  });

  it('a malformed or upper-case id, an unknown locale, unknown or reordered parts: 400', async () => {
    expect(await status('not-a-uuid', query('en', ZONE))).toBe(400);
    expect(await status('0000000A-0000-4000-8000-000000000901', query('en', ZONE))).toBe(400);
    expect(await status(ID, query('xx', ZONE))).toBe(400);
    for (const parts of [
      '',
      'clock',
      'stats,events',
      'events,stats,events',
      'events,events',
      'stats,',
    ]) {
      const search = `?b=${b()}&locale=en&parts=${encodeURIComponent(parts)}&tz=${encodeURIComponent(ZONE)}`;
      expect(await status(ID, search), parts).toBe(400);
    }
    expect(partsOf('stats,events')).toBeNull();
    expect(partsOf(null)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('a zone not in its canonical IANA name -- another spelling, an alias, an offset -- is 400', async () => {
    for (const zone of [
      'europe/london',
      'eUROPE/lONDON',
      'GB',
      '+03:30',
      '-0500',
      'Mars/Olympus',
      'Etc/GMT+99',
    ]) {
      expect(await status(ID, query('en', zone)), zone).toBe(400);
    }
    expect(canonicalZone('Europe/London')).toBe('Europe/London');
    expect(canonicalZone('UTC')).toBe('UTC');
    expect(canonicalZone('+03:30')).toBeNull();
    expect(canonicalZone('GB')).toBe('Europe/London');
    expect(read).not.toHaveBeenCalled();
    // The page hands the live view the canonical name, the only one answered.
    const page = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'match', '[id]', 'page.tsx'),
      'utf8',
    );
    expect(page).toMatch(/timeZone=\{canonicalZone\(timeZone\) \?\? timeZone\}/);
  });

  it('an extra name, a missing one, another order, a duplicate or another encoding: 400', async () => {
    const tz = encodeURIComponent(ZONE);
    for (const search of [
      `${query('en', ZONE)}&x=1`,
      `?b=${b()}&locale=en&parts=events%2Cstats`,
      `?locale=en&b=${b()}&parts=events%2Cstats&tz=${tz}`,
      `${query('en', ZONE)}&tz=${tz}`,
      `?b=${b()}&locale=en&parts=events,stats&tz=${tz}`,
      `?b=${b()}&locale=en&parts=events%2Cstats&tz=Europe/London`,
      '',
    ]) {
      expect(await status(ID, search), search).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('a page from another server process gets a small no-store reload signal, no cards (409)', async () => {
    const other = '00000000-0000-4000-8000-00000000beef';
    const search = `?${liveQuery({ instance: other, locale: 'en', parts: ['events'], timeZone: ZONE })}`;
    const reply = await liveAnswer(ID, search);
    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body)).toEqual({ v: LIVE_FORMAT, reload: true, instance: b() });
    const response = await GET(new Request(`http://web/api/fixtures/${ID}/live.js${search}`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(read).not.toHaveBeenCalled();
  });

  it('is public and read-only: no cookie, no reader header, no write', () => {
    for (const source of [SOURCE, ROUTE]) {
      expect(source).not.toMatch(/cookies\(|sessionCookieHeader|cookie:|fetchMe\(|headers\(\)/);
      expect(source).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'|revalidate|'use server'/);
    }
    // Only the address's own query is read from the request.
    expect(ROUTE).toMatch(/liveAnswer\(id, new URL\(request\.url\)\.search\)/);
    expect(ROUTE).not.toMatch(/request\.headers/);
  });

  it('reads the right-to-left pseudo-locale as the default language, as the page does', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    expect(await refreshLiveModules(ID, 'x-rtl', ZONE)).not.toBeNull();
    expect(read).toHaveBeenCalledWith(ID, 'en');
  });
});

describe('the live modules’ address: what it answers', () => {
  it('a public, two-second answer on a path Cloudflare keeps; failures never kept', async () => {
    read.mockResolvedValue(answer(match('live', [goal])));
    const path = liveModulesPath(ID, {
      instance: serverInstance(),
      locale: 'en',
      parts: ['stats', 'events'],
      timeZone: ZONE,
    });
    // One order of the query, so one answer has one key; the path ends in `.js` (T-1461).
    expect(path).toBe(
      `/api/fixtures/${ID}/live.js?b=${serverInstance()}&locale=en&parts=events%2Cstats&tz=Europe%2FLondon`,
    );
    const ok = await GET(
      new Request(`http://web${path}`, { headers: { cookie: 'fmip_session=x' } }),
      { params: Promise.resolve({ id: ID }) },
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
    const calls = [1, 2, 3].map(() => liveAnswer(ID, query('en', ZONE)));
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

describe('nothing in a cached answer is trusted further than the cards need (review R2-B2)', () => {
  const draw = (node: unknown) => renderToStaticMarkup(<>{fromWire(node as WireNode)}</>);

  it('drops a tag outside the list, with its subtree', () => {
    for (const t of [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'a',
      'style',
      'link',
      'meta',
      'base',
    ]) {
      const html = draw({ t: 'div', c: [{ t, p: { src: '/x', href: '/x' }, c: ['HOSTILE'] }] });
      expect(html, t).toBe('<div></div>');
    }
  });

  it('drops markup, handlers, frames, form actions, refs and style strings', () => {
    const html = draw({
      t: 'div',
      p: {
        dangerouslySetInnerHTML: { __html: '<img src=x onerror=alert(1)>' },
        onClick: 'alert(1)',
        ONMOUSEOVER: 'alert(1)',
        srcDoc: '<script>alert(1)</script>',
        formAction: 'javascript:alert(1)',
        ref: 'x',
        style: 'background:url(javascript:alert(1))',
        className: 'kept',
        'data-ok': 'kept',
      },
      c: ['text'],
    });
    expect(html).toBe('<div class="kept" data-ok="kept">text</div>');
  });

  it('keeps a style object only with the two properties the cards set, as lengths', () => {
    expect(draw({ t: 'span', p: { style: { inlineSize: '40%' } } })).toBe(
      '<span style="inline-size:40%"></span>',
    );
    for (const style of [
      { inlineSize: 'calc(100% - 1px)' },
      { backgroundImage: 'url(https://evil.example/x.png)' },
      { inlineSize: '40%', position: 'fixed' },
      ['inlineSize'],
    ]) {
      expect(draw({ t: 'span', p: { style } }), JSON.stringify(style)).toBe('<span></span>');
    }
  });

  it('an image and a link only to a path on this site', () => {
    expect(draw({ t: 'img', p: { src: '/api/media/crest/x/1.png', alt: '' } })).toContain(
      'src="/api/media/crest/x/1.png"',
    );
    for (const src of [
      'https://evil.example/x.png',
      '//evil.example/x.png',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:image/png;base64,AA',
      '/ok path',
    ]) {
      expect(draw({ t: 'img', p: { src, alt: '' } }), src).not.toContain('src=');
      expect(draw({ i: 'link', p: { href: src, children: 'x' } }), src).not.toContain(
        `href="${src}"`,
      );
    }
    expect(draw({ i: 'link', p: { href: '/en/player/p1', children: 'Salah' } })).toContain(
      'href="/en/player/p1"',
    );
  });

  it('looks client components up in a Map, never through a prototype; their props allow-listed', () => {
    for (const i of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'script']) {
      expect(draw({ t: 'div', c: [{ i, p: {}, c: ['x'] }] }), i).toBe('<div></div>');
    }
    // A link with a handler or markup: those props go, the link stays harmless.
    const link = draw({
      i: 'link',
      p: {
        href: '/en',
        onClick: 'alert(1)',
        dangerouslySetInnerHTML: { __html: '<b>x</b>' },
        children: 'x',
      },
    });
    expect(link).toBe('<a href="/en">x</a>');
    // A drawn subtree inside a component's prop is checked as any other.
    expect(
      draw({ i: 'pictured', p: { children: { $n: { t: 'script', c: ['x'] } }, fallback: 'ok' } }),
    ).not.toContain('script');
  });

  it('an unknown shape is nothing, never a crash', () => {
    for (const node of [{ t: 5 }, { x: 1 }, { t: 'div', p: 'x', c: 'y' }]) {
      expect(() => draw(node)).not.toThrow();
    }
  });

  it('the server refuses to write what the page would drop: a tag, an attribute, a component prop', () => {
    expect(() => toWire(<iframe srcDoc="x" />)).toThrow(/iframe/);
    expect(() => toWire(<div dangerouslySetInnerHTML={{ __html: 'x' }} />)).toThrow(
      /dangerouslySetInnerHTML/,
    );
    expect(() => toWire(<div onClick={() => undefined} />)).toThrow(/onClick/);
    // eslint-disable-next-line @next/next/no-img-element -- a hostile card, never drawn
    expect(() => toWire(<img src="https://evil.example/x.png" alt="" />)).toThrow(/src/);
    expect(() => toWire(<span style={{ position: 'fixed' }} />)).toThrow(/style/);
  });
});
