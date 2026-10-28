import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerPage } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The compare page names each player's club, national team, position and age
 * (T-1630). The maintainer found it showed neither the club nor the position:
 * it read both from an open spell, and production holds none. Rendered whole
 * with the API mocked.
 */

const api = vi.hoisted(() => ({ fetchPlayer: vi.fn(), fetchSearch: vi.fn() }));
vi.mock('@/lib/api', () => api);
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));

const { default: ComparePlayersPage } = await import('./page');

const MBAPPE = '420771d9-e919-40f4-849c-b5e837c57b21';
const UNKNOWN = '00000000-0000-4000-8000-00000000c002';
const MADRID = '00000000-0000-4000-8000-000000000603';
const FRANCE = '00000000-0000-4000-8000-0000000006f1';
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function player(id: string, name: string, over: Partial<PlayerPage> = {}): PlayerPage {
  return {
    person: {
      id,
      full_name: name,
      known_as: null,
      localised_name: null,
      date_of_birth: null,
      nationality: null,
      height_cm: null,
      preferred_foot: null,
    },
    current_spell: null,
    spells: [],
    record: { coverage: 'not_supplied', last_updated_at: null, data: null },
    recent_matches: { coverage: 'not_supplied', last_updated_at: null, data: null },
    availability: {
      team: null,
      fixture: null,
      listing: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason: 'no_team',
    },
    last_updated_at: null,
    ...over,
  };
}

const mbappe = player(MBAPPE, 'Kylian Mbappé', {
  person: {
    ...player(MBAPPE, 'Kylian Mbappé').person,
    date_of_birth: '1998-12-20',
  },
  position: {
    coverage: 'limited',
    last_updated_at: '2026-10-25T19:00:00.000Z',
    data: { value: 'forward', basis: 'lineup' },
  },
  club: {
    coverage: 'limited',
    last_updated_at: '2026-10-25T19:00:00.000Z',
    data: {
      team: {
        id: MADRID,
        name: 'Real Madrid',
        short_name: null,
        crest: { coverage: 'available', url: '/api/media/team/madrid.png' },
      },
      basis: 'lineup',
      since: '2026-10-25',
      on_loan: false,
    },
  },
  national_team: {
    team: {
      id: FRANCE,
      name: 'France',
      short_name: null,
      crest: { coverage: 'not_supplied', url: null },
    },
    last_lineup: '2026-10-05',
  },
});

const unknown = player(UNKNOWN, 'Nobody Known', {
  position: { coverage: 'not_supplied', last_updated_at: null, data: null },
  club: { coverage: 'not_supplied', last_updated_at: null, data: null },
  national_team: null,
});

async function render(locale: string): Promise<string> {
  const element = await ComparePlayersPage({
    params: Promise.resolve({ locale, id: MBAPPE }),
    searchParams: Promise.resolve({ with: UNKNOWN }),
  });
  return renderToStaticMarkup(element);
}

/** The markup of one player's identity block, by its order on the page. */
function identity(html: string, index: number): string {
  const chunk = html.split('data-testid="compare-player"')[index + 1] ?? '';
  return chunk.split('</dl>')[0] ?? '';
}

describe('the compare page names who each player is (T-1630)', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    api.fetchPlayer.mockImplementation(async (id: string) => ({
      ok: true,
      data: id === MBAPPE ? mbappe : unknown,
    }));
  });

  it('shows the club with its crest and what says so, the national team, the position and the age', async () => {
    const a = identity(await render('en'), 0);
    expect(a).toMatch(/data-testid="compare-position"[^>]*>Forward</);
    expect(a).toMatch(/data-testid="compare-club".*href="\/en\/team\/[^"]*000603".*Real Madrid/);
    expect(a).toContain('src="/api/media/team/madrid.png');
    expect(a).toContain('from the latest club line-up that names this player, 25 October 2026');
    expect(a).toMatch(
      /data-testid="compare-national".*National team.*href="\/en\/team\/[^"]*0006f1".*France/,
    );
    expect(a).toMatch(/data-testid="compare-age"[^>]*>Age 27</);
  });

  it('says what it does not hold instead of leaving it blank', async () => {
    const b = identity(await render('en'), 1);
    expect(b).toContain('No current team on record');
    expect(b).toContain('Position not recorded');
    expect(b).toContain('Age not supplied');
    expect(b).not.toContain('compare-national');
  });

  it('says it in Persian, with Persian digits', async () => {
    const html = await render('fa');
    const a = identity(html, 0);
    expect(a).toContain('سن ۲۷');
    expect(a).toContain('تیم ملی');
    expect(a).toContain('بر پایه‌ی آخرین ترکیب باشگاهی که نام این بازیکن در آن آمده');
    expect(identity(html, 1)).toContain('سن ارائه نشده');
  });

  it('lays the blocks out with logical properties only', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(PHYSICAL);
  });
});
