import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SocialCardPayload,
  SocialForecastPayload,
  SocialResultPayload,
  SocialVerdictPayload,
} from '@fmip/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-1835 (D-427 point 11): each social card draws at exactly 1080 x 1350
 * from its frozen payload; the route answers 404 with no picture for an id
 * the API does not answer, 503 when the API cannot be asked or the renderer
 * fails (never the plain card), the card itself `immutable`, and
 * `X-Robots-Tag: noindex` on every answer. No crest is read: nothing here
 * reaches `/api/media` or `crestDataUrl`.
 *
 * With `SOCIAL_CARD_OUT` set to a folder, the four sample cards are written
 * there as PNGs for a person to look at.
 */

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/lib/api', () => api);

const { drawSocialCard, SocialCardImage } = await import('./social-card-image');
const { GET } = await import('@/app/social-card/[id]/card.png/route');
const { SOCIAL_CARD_CACHE } = await import('@/lib/social-card');

const ID = '6f1d3c1e-5b8a-4f0e-9a51-0c2b7d4e9a10';
const team = (name: string, code: string | null, short_name: string | null = null) => ({
  id: `00000000-0000-4000-8000-${String(name.length).padStart(12, '0')}`,
  name,
  short_name,
  code,
});

const NEWCASTLE_ARSENAL: SocialForecastPayload = {
  kind: 'forecast_pre_match',
  fixture_id: ID,
  competition: { id: ID, name: 'Premier League' },
  round: 'Matchday 11',
  kick_off: '2026-11-21T17:30:00.000Z',
  home: team('Newcastle', 'NEW'),
  away: team('Arsenal', 'ARS'),
  model: {
    name: 'The Stadiomind model',
    version: 'dixon-coles-elo@0.7.0',
    forecast_id: ID,
    computed_at: '2026-11-14T17:32:00.000Z',
  },
  percent: { home: 17.7, draw: 25.3, away: 57.0 },
};

const SALAMANCA_CELTA: SocialVerdictPayload = {
  kind: 'model_verdict',
  fixture_id: ID,
  competition: { id: ID, name: 'Copa del Rey' },
  round: 'Round of 128',
  kick_off: '2026-11-13T19:00:00.000Z',
  home: team('Salamanca UDS', null),
  away: team('Celta Vigo', 'CEL'),
  model: {
    name: 'The Stadiomind model',
    version: 'dixon-coles-elo@0.7.0',
    forecast_id: ID,
    computed_at: '2026-11-13T09:55:00.000Z',
  },
  score: { home: 0, away: 5 },
  after_extra_time: false,
  called: 'away',
  called_percent: 86,
  percent: { home: 4.5, draw: 10.0, away: 85.5 },
  correct: true,
};

const AVILA_UNIONISTAS: SocialVerdictPayload = {
  kind: 'model_verdict',
  fixture_id: ID,
  competition: { id: ID, name: 'Copa del Rey' },
  round: 'Round of 128',
  kick_off: '2026-10-29T18:00:00.000Z',
  home: team('Real Ávila', null),
  away: team('Unionistas de Salamanca', null, 'Unionistas'),
  model: {
    name: 'The Stadiomind model',
    version: 'dixon-coles-elo@0.6.0',
    forecast_id: ID,
    computed_at: '2026-10-28T11:04:00.000Z',
  },
  score: { home: 0, away: 0 },
  after_extra_time: true,
  called: 'away',
  called_percent: 44,
  percent: { home: 27.9, draw: 27.7, away: 44.4 },
  correct: false,
};

const NORWAY_WALES: SocialResultPayload = {
  kind: 'result',
  fixture_id: ID,
  competition: { id: ID, name: 'UEFA Nations League A' },
  round: 'Matchday 5',
  kick_off: '2026-11-14T17:00:00.000Z',
  home: team('Norway', 'NOR'),
  away: team('Wales', 'WAL'),
  score: { home: 3, away: 1 },
  after_extra_time: false,
  penalties: null,
  half_time: { home: 0, away: 0 },
  goals: [
    { side: 'home', player: 'Nusa', minute: 59, added: null, kind: 'goal' },
    { side: 'home', player: 'Schjelderup', minute: 68, added: null, kind: 'goal' },
    { side: 'away', player: 'Brooks', minute: 79, added: null, kind: 'goal' },
    { side: 'home', player: 'Haaland', minute: 88, added: null, kind: 'penalty' },
  ],
};

const goal = (side: 'home' | 'away', player: string, minute: number, extra = {}) => ({
  side,
  player,
  minute,
  added: null,
  kind: 'goal' as const,
  ...extra,
});

/** The hardest words the cards meet: the longest names, a shoot-out, eight goals, no bar. */
const EDGES = {
  'edge-long-names-forecast': {
    ...NEWCASTLE_ARSENAL,
    competition: { id: ID, name: 'CONMEBOL Copa Libertadores' },
    round: 'Quarter-finals · 2nd Leg',
    home: team('Unionistas de Salamanca', null),
    away: team('Borussia Mönchengladbach', 'BMG', 'Gladbach'),
    percent: { home: 33, draw: 34, away: 33 },
  },
  'edge-shoot-out-result': {
    ...NORWAY_WALES,
    home: team('Wolverhampton Wanderers', 'WOL', 'Wolves'),
    away: team('Brighton & Hove Albion', 'BHA', 'Brighton'),
    competition: { id: ID, name: 'EFL Cup' },
    round: 'Round of 16',
    score: { home: 2, away: 2 },
    after_extra_time: true,
    penalties: { home: 4, away: 3 },
    half_time: null,
    goals: null,
  },
  'edge-eight-goals-result': {
    ...NORWAY_WALES,
    score: { home: 7, away: 1 },
    goals: [
      goal('home', 'Haaland', 3),
      goal('home', 'Haaland', 19),
      goal('away', 'Ampadu', 27, { kind: 'own_goal' }),
      goal('home', 'Ødegaard', 45, { added: 2 }),
      goal('home', 'Sørloth', 51),
      goal('home', 'Schjelderup', 66, { kind: 'penalty' }),
      goal('home', 'Nusa', 80),
      goal('home', 'Bobb', 90, { added: 4 }),
    ],
  },
  'edge-check-no-bar': {
    ...AVILA_UNIONISTAS,
    percent: null,
    called_percent: 44,
    home: team('Real Sociedad de Fútbol', 'RSO', 'Real Sociedad'),
  },
} satisfies Record<string, SocialCardPayload>;

const SAMPLES = {
  'forecast-newcastle-arsenal': NEWCASTLE_ARSENAL,
  'model-check-hit-salamanca-celta': SALAMANCA_CELTA,
  'model-check-miss-after-90-avila-unionistas': AVILA_UNIONISTAS,
  'result-norway-wales': NORWAY_WALES,
  ...EDGES,
} as const;

async function png(response: Response): Promise<Buffer> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  const body = Buffer.from(await response.arrayBuffer());
  expect(body.subarray(1, 4).toString()).toBe('PNG');
  return body;
}

beforeEach(() => {
  api.apiRequest.mockReset();
});

describe('the social cards', () => {
  it('draws every kind at exactly 1080 x 1350, kept for good and never indexed', async () => {
    const out = process.env.SOCIAL_CARD_OUT;
    if (out !== undefined && out !== '') await mkdir(out, { recursive: true });
    for (const [name, payload] of Object.entries(SAMPLES)) {
      const response = await drawSocialCard(payload);
      const body = await png(response);
      expect(body.readUInt32BE(16), name).toBe(1080);
      expect(body.readUInt32BE(20), name).toBe(1350);
      expect(response.headers.get('cache-control')).toBe(SOCIAL_CARD_CACHE);
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
      if (out !== undefined && out !== '') await writeFile(join(out, `${name}.png`), body);
    }
  }, 60_000);

  it('answers the card of a post the API answers, from its payload alone', async () => {
    api.apiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: ID, payload: NORWAY_WALES },
      setCookie: null,
    });
    const response = await GET(new Request('http://web/'), { params: Promise.resolve({ id: ID }) });
    await png(response);
    expect(api.apiRequest).toHaveBeenCalledTimes(1);
    expect(api.apiRequest).toHaveBeenCalledWith(`/social-posts/${ID}/card`);
  }, 20_000);

  it('answers 404 with no picture for a malformed id or a post the API does not answer', async () => {
    const malformed = await GET(new Request('http://web/'), {
      params: Promise.resolve({ id: 'not-a-post' }),
    });
    expect(malformed.status).toBe(404);
    expect(api.apiRequest).not.toHaveBeenCalled();
    // Unknown, rejected, expired and superseded posts are all the API's 404.
    api.apiRequest.mockResolvedValue({ ok: false, status: 404, error: null, setCookie: null });
    const gone = await GET(new Request('http://web/'), { params: Promise.resolve({ id: ID }) });
    for (const response of [malformed, gone]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
    }
  });

  it('answers 503 with no picture when the API cannot be asked', async () => {
    api.apiRequest.mockResolvedValue({ ok: false, status: 0, error: null, setCookie: null });
    const response = await GET(new Request('http://web/'), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('answers 503, never the plain card, when the renderer fails', async () => {
    // A payload the words cannot be made from fails inside the drawing.
    const broken = { ...NORWAY_WALES, kick_off: 'not a date' };
    const response = await drawSocialCard(broken);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  }, 20_000);

  it('reads no crest, logo or photo: no media request and no crest import', async () => {
    const files = [
      join(process.cwd(), 'src', 'components', 'social-card-image.tsx'),
      join(process.cwd(), 'src', 'lib', 'social-card.ts'),
      join(process.cwd(), 'src', 'app', 'social-card', '[id]', 'card.png', 'route.tsx'),
    ];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/crestDataUrl|crest-image|\/media\b|<img\b/);
    }
    expect(await readdir(join(process.cwd(), 'src', 'app', 'social-card', '[id]'))).toEqual([
      'card.png',
    ]);
    expect(typeof SocialCardImage).toBe('function');
  });
});
