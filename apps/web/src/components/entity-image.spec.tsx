import type { EntityMedia, ScoreCard as ScoreCardData } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scoresWords } from '@/lib/words-server';
import { EntityImage, initials } from './entity-image';
import { ScoreCard } from './score-card';

/**
 * Crests, logos and photos (T-1321, D-176): an image from our own origin,
 * sized so nothing moves, or a neutral lettered mark that cannot pass for a
 * crest (rule 3). Rendered, not read from the source.
 */

const CREST: EntityMedia = { coverage: 'available', url: '/api/media/crest/t-1/0123456789ab' };
const NONE: EntityMedia = { coverage: 'not_supplied', url: null };
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const srcs = (markup: string) => [...markup.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1]);

describe('EntityImage', () => {
  it('draws a stored crest as a sized, lazy, decorative image beside its name', () => {
    const out = html(<EntityImage media={CREST} kind="crest" name="Liverpool" size={22} />);
    expect(out).toMatch(/^<img /);
    expect(out).toContain('src="/api/media/crest/t-1/0123456789ab"');
    expect(out).toContain('width="22"');
    expect(out).toContain('height="22"');
    expect(out).toContain('alt=""');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toContain('object-contain');
    expect(out).toContain('bg-surface-raised');
    expect(out).toContain('data-coverage="available"');
  });

  it('loads a header image at once, and names it when it stands alone', () => {
    const out = html(
      <EntityImage
        media={CREST}
        kind="crest"
        name="Liverpool"
        size={48}
        decorative={false}
        aboveFold
      />,
    );
    expect(out).toContain('loading="eager"');
    expect(out).not.toContain('decoding="async"');
    expect(out).toContain('alt="Liverpool"');
  });

  it('draws a photo round and cropped to fill', () => {
    const photo: EntityMedia = { coverage: 'available', url: '/api/media/photo/p-1/abcdefabcdef' };
    const out = html(<EntityImage media={photo} kind="photo" name="Mohamed Salah" size={40} />);
    expect(out).toContain('rounded-full');
    expect(out).toContain('object-cover');
  });

  it.each([
    ['not_supplied', NONE],
    ['absent', undefined],
  ])('draws a lettered mark, never an image, when the crest is %s', (_label, media) => {
    const out = html(<EntityImage media={media} kind="crest" name="Manchester United" size={22} />);
    expect(out).not.toContain('<img');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('data-letters="MU"');
    // Drawn by CSS, so a heading's or a link's text stays the name alone.
    expect(out).toMatch(/data-letters="MU"><\/span>$/);
    expect(out).toContain('data-coverage="not_supplied"');
    expect(out).toContain('rounded-sm');
  });

  it('names the mark when it stands alone, and draws a person as a circle of initials', () => {
    const out = html(
      <EntityImage media={NONE} kind="photo" name="Virgil van Dijk" size={40} decorative={false} />,
    );
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Virgil van Dijk"');
    expect(out).toContain('rounded-full');
    expect(out).toContain('data-letters="VD"');
  });

  it('refuses an address that is not our own, so the browser asks nobody else', () => {
    const foreign = {
      coverage: 'available',
      url: 'https://media.example.com/teams/40.png',
    } as const;
    const out = html(<EntityImage media={foreign} kind="crest" name="Liverpool" size={22} />);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('example.com');
  });

  it('takes whole letters from any script', () => {
    expect(initials('Liverpool', 'crest')).toBe('L');
    expect(initials('Manchester United', 'crest')).toBe('MU');
    expect(initials('Virgil van Dijk', 'photo')).toBe('VD');
    expect(initials('استقلال تهران', 'crest')).toBe('ات');
    expect(initials('  ', 'crest')).toBe('');
  });

  it('uses no physical side in either state', () => {
    for (const media of [CREST, NONE]) {
      for (const kind of ['crest', 'logo', 'photo'] as const) {
        expect(
          html(<EntityImage media={media} kind={kind} name="Sepahan" size={40} />),
        ).not.toMatch(PHYSICAL);
      }
    }
  });
});

const card = (over: Partial<ScoreCardData> = {}): ScoreCardData => ({
  id: '00000000-0000-4000-8000-000000000901',
  kickoff_at: '2025-01-05T16:30:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c', name: 'Persian Gulf Pro League', short_name: null, country_id: null },
  season: { id: 's', label: '2024/25' },
  stage: null,
  round: null,
  leg: null,
  home: { id: 'h', name: 'Esteghlal', short_name: null, code: 'EST', crest: CREST },
  away: { id: 'a', name: 'Persepolis', short_name: null, code: 'PRS', crest: NONE },
  scores: {
    current: null,
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  red_cards: { home: 0, away: 0 },
  incidents: [],
  venue: null,
  coverage: 'available',
  last_updated_at: '2025-01-05T15:40:00.000Z',
  freshness: null,
  pinned: false,
  ...over,
});

describe('a score row with crests', () => {
  for (const locale of ['en', 'fa'] as const) {
    it(`puts each crest on the inner side, beside the score (${locale})`, () => {
      const out = html(
        <ScoreCard words={scoresWords(locale)} card={card()} timeZone="UTC" locale={locale} />,
      );
      const home = out.slice(
        out.indexOf('data-testid="home-team"'),
        out.indexOf('data-testid="score"'),
      );
      const away = out.slice(out.indexOf('data-testid="away-team"'));
      // Home: the name, then the crest next to the score; away: the mark, then the name.
      expect(home.indexOf('Esteghlal</bdi>')).toBeLessThan(home.indexOf('<img'));
      expect(away.indexOf('data-coverage="not_supplied"')).toBeLessThan(
        away.indexOf('Persepolis</bdi>'),
      );
      expect(out).not.toMatch(PHYSICAL);
    });
  }

  it('asks only our own origin for every image it draws', () => {
    const out = html(
      <ScoreCard
        words={scoresWords('en')}
        card={card({
          away: {
            ...card().away,
            crest: { coverage: 'available', url: '/api/media/crest/a/fedcba987654' },
          },
        })}
        timeZone="UTC"
        locale="en"
      />,
    );
    const found = srcs(out);
    expect(found).toHaveLength(2);
    for (const src of found) expect(src).toMatch(/^\/api\/media\//);
  });

  it('draws the marks when the API attached no media at all', () => {
    const plain = card();
    const out = html(
      <ScoreCard
        words={scoresWords('en')}
        card={{
          ...plain,
          home: { id: 'h', name: 'Esteghlal', short_name: null, code: 'EST' },
          away: { id: 'a', name: 'Persepolis', short_name: null, code: 'PRS' },
        }}
        timeZone="UTC"
        locale="en"
      />,
    );
    expect(srcs(out)).toEqual([]);
    expect(out.match(/data-coverage="not_supplied"/g)).toHaveLength(2);
  });
});
