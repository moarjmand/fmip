import type { EntityMedia, HighlightListItem, HighlightsResponse } from '@fmip/contracts';
import { NO_MEDIA } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HighlightsQuery } from '@/lib/highlights';
import { HighlightsView } from './view';

/**
 * The Highlights page as match posters (T-1614, D-285): the newest clip
 * featured on the first page, the rest by the reader's day; each poster drawn
 * from our own crests and logos (a lettered mark where none is stored, never a
 * video frame), a play badge, the link out naming the destination's host and
 * the publisher beside it; the filter as logo chips with the chosen one marked
 * and the rest behind a disclosure; Persian digits on /fa.
 */

const NOW = new Date('2026-10-26T12:00:00Z');
const PL = '00000000-0000-4000-8000-000000000201';
const crest = (id: string): EntityMedia => ({
  coverage: 'available',
  url: `/api/media/crest/${id}/0123456789ab.png`,
});
const logo = (id: string): EntityMedia => ({
  coverage: 'available',
  url: `/api/media/logo/${id}/0123456789ab.png`,
});

function clip(
  id: string,
  kickoff: string,
  over: Partial<HighlightListItem> = {},
  stored = true,
): HighlightListItem {
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    publisher: 'Premier League',
    source: { id: 'src', name: 'Highlightly', rights: 'link' },
    fixture: {
      id: `fx-${id}`,
      kickoff_at: kickoff,
      status: 'finished',
      competition: { id: PL, name: 'Premier League', short_name: null, logo: logo(PL) },
      home: {
        id: `home-${id}`,
        name: 'Liverpool',
        short_name: null,
        crest: stored ? crest(`home-${id}`) : NO_MEDIA,
      },
      away: {
        id: `away-${id}`,
        name: 'Manchester United',
        short_name: 'Man United',
        crest: NO_MEDIA,
      },
      score: { home: 2, away: 1 },
      penalties: null,
    },
    restricted: false,
    last_updated_at: kickoff,
    ...over,
  };
}

function answer(over: Partial<HighlightsResponse> = {}): HighlightsResponse {
  return {
    generated_at: NOW.toISOString(),
    territory: { state: 'not_chosen' },
    offered: 'all',
    competition: null,
    competitions: [
      { id: PL, name: 'Premier League', short_name: null, count: 3, logo: logo(PL) },
      { id: 'liga', name: 'La Liga', short_name: null, count: 1, logo: NO_MEDIA },
    ],
    page: 1,
    page_size: 20,
    total: 3,
    items: [
      clip('a', '2026-10-26T10:00:00Z'),
      clip('b', '2026-10-26T08:00:00Z', { restricted: true, publisher: null }),
      clip('c', '2026-10-25T15:00:00Z', {}, false),
    ],
    last_updated_at: NOW.toISOString(),
    ...over,
  };
}

const Q: HighlightsQuery = { competition: undefined, page: 1, territory: undefined };

function render(
  over: Partial<HighlightsResponse> | null = {},
  props: { locale?: string; q?: HighlightsQuery; signedIn?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <HighlightsView
      locale={props.locale ?? 'en'}
      q={props.q ?? Q}
      data={over === null ? null : answer(over)}
      timeZone="UTC"
      signedIn={props.signedIn ?? false}
      territories={[]}
      now={NOW}
    />,
  );
}

/** The markup of each poster, by its look. */
function posters(html: string): { look: string; html: string }[] {
  return [...html.matchAll(/<article[^>]*data-look="(\w+)"[^>]*>([\s\S]*?)<\/article>/g)].map(
    (m) => ({ look: m[1]!, html: m[0] }),
  );
}

describe('the clips', () => {
  it("features the newest on the first page, the rest by the reader's day", () => {
    const html = render();
    const all = posters(html);
    expect(all.map((p) => p.look)).toEqual(['featured', 'card', 'card']);
    expect(all[0]!.html).toContain('data-fixture="fx-a"');
    expect(
      [...html.matchAll(/data-testid="highlights-day" data-day="([\d-]+)"/g)].map((m) => m[1]),
    ).toEqual(['2026-10-26', '2026-10-25']);
    expect(html).toContain('Today');
    expect(html).toContain('Yesterday');
    expect(html).toContain('Latest highlights');
  });

  it('has no featured poster past the first page', () => {
    const html = render({ page: 2, total: 23 });
    expect(posters(html).map((p) => p.look)).toEqual(['card', 'card', 'card']);
  });

  it('draws each poster from our own crests and logos, a lettered mark where none is stored', () => {
    const [featured, , unstored] = posters(render());
    // The stored crest, at the size the poster draws it; the competition's logo.
    expect(featured!.html).toContain('src="/api/media/crest/home-a/0123456789ab-192.webp"');
    expect(featured!.html).toContain(`src="/api/media/logo/${PL}/0123456789ab-48.webp"`);
    // No crest stored: the neutral mark, never a stand-in image.
    expect(unstored!.html).not.toContain('/api/media/crest/');
    expect(unstored!.html).toContain('data-coverage="not_supplied"');
    expect(unstored!.html).toContain('data-letters="MU"');
  });

  it('opens the clip on its site, naming the host and the publisher, and never plays it here', () => {
    const html = render();
    const [featured, untitled] = posters(html);
    expect(featured!.html).toContain('href="https://www.youtube.com/watch?v=a"');
    expect(featured!.html).toContain('rel="noopener noreferrer"');
    expect(featured!.html).toContain('data-link-out="youtube.com"');
    expect(featured!.html).toContain('data-testid="highlight-play"');
    expect(featured!.html).toMatch(/By <bdi[^>]*>Premier League<\/bdi>/);
    // No publisher named: the host alone says where it goes.
    expect(untitled!.html).not.toContain('highlight-publisher');
    expect(html).not.toMatch(/<(iframe|video)\b/);
    // The match page, with the poster's teams and score.
    expect(featured!.html).toContain('href="/en/match/fx-a"');
    expect(featured!.html).toContain('Liverpool');
    expect(featured!.html).toMatch(/data-testid="highlight-score"[^>]*>2–1</);
  });

  it('marks only a restricted clip as one that may not play', () => {
    const [a, b, c] = posters(render());
    expect(b!.html).toContain('data-testid="highlight-restricted"');
    expect(b!.html).toContain('May not play in your country');
    expect(a!.html).not.toContain('highlight-restricted');
    expect(c!.html).not.toContain('highlight-restricted');
  });

  it("carries a guest's territory to the match page, and a member's never", () => {
    const q = { ...Q, territory: 'IR' };
    expect(render({}, { q })).toContain('href="/en/match/fx-a?territory=IR"');
    expect(render({}, { q, signedIn: true })).toContain('href="/en/match/fx-a"');
  });
});

describe('the filter', () => {
  it('is logo chips, the chosen one current, every one an address', () => {
    const html = render({ competition: PL }, { q: { ...Q, competition: PL } });
    const chip =
      /<a[^>]*data-testid="highlights-filter-competition"[^>]*data-competition="([^"]+)"[^>]*>/g;
    const chips = [...html.matchAll(chip)];
    expect(chips.map((m) => m[1])).toEqual([PL, 'liga']);
    expect(chips[0]![0]).toContain('aria-current="page"');
    expect(chips[0]![0]).toContain(`href="/en/highlights?competition=${PL}"`);
    expect(chips[1]![0]).not.toContain('aria-current');
    expect(html).toMatch(
      /data-testid="highlights-filter-all"[^>]*href="\/en\/highlights"|href="\/en\/highlights"[^>]*data-testid="highlights-filter-all"/,
    );
  });

  it('keeps the competitions past the first chips behind a disclosure, never the chosen one', () => {
    const competitions = Array.from({ length: 14 }, (_, i) => ({
      id: `c${i}`,
      name: `League ${i}`,
      short_name: null,
      count: 20 - i,
    }));
    const html = render({ competitions, competition: 'c12' }, { q: { ...Q, competition: 'c12' } });
    const more = /<details[^>]*data-testid="highlights-filter-more"[\s\S]*?<\/details>/.exec(
      html,
    )![0];
    expect(more).toContain('2 more competitions');
    expect(more).toContain('data-competition="c11"');
    expect(more).toContain('data-competition="c13"');
    expect(more).not.toContain('data-competition="c12"');
    expect(html).toMatch(
      /aria-current="page"[^>]*data-competition="c12"|data-competition="c12"[^>]*aria-current="page"/,
    );
  });
});

describe('the header and the states', () => {
  it('counts the clips and the competitions, and shows logos only when three are held', () => {
    const html = render();
    expect(html).toContain('3 highlights');
    expect(html).toContain('2 competitions');
    expect(html).not.toContain('data-testid="highlights-logos"');
    const held = ['x', 'y', 'z'].map((id) => ({
      id,
      name: id,
      short_name: null,
      count: 1,
      logo: logo(id),
    }));
    expect(render({ competitions: held })).toContain('data-testid="highlights-logos"');
  });

  it('says every clip is listed with no territory, and not with one', () => {
    expect(render()).toContain('data-testid="highlights-all"');
    const chosen = render({
      offered: 'territory',
      territory: { state: 'chosen', territory: { code: 'IR', name: 'Iran' } },
    });
    expect(chosen).not.toContain('data-testid="highlights-all"');
  });

  it('names an unreachable API and an empty list rather than drawing nothing', () => {
    const down = render(null);
    expect(down).toContain('data-testid="highlights-unreachable"');
    expect(posters(down)).toEqual([]);
    const empty = render({ items: [], total: 0, competitions: [] });
    expect(empty).toContain('data-testid="highlights-empty"');
    expect(empty).not.toContain('data-testid="highlights-filter"');
  });

  it('is in Persian on /fa, with Persian digits', () => {
    const html = render({}, { locale: 'fa' });
    expect(html).toContain('هایلایت‌ها');
    expect(html).toContain('تازه‌ترین هایلایت');
    expect(html).toContain('۳ هایلایت');
    expect(html).toMatch(/data-testid="highlight-score"[^>]*>۲–۱</);
    expect(html).toContain('href="/fa/match/fx-a"');
  });
});
