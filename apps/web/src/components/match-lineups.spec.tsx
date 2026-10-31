import type { EntityMedia, MatchLineupPlayer } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { matchWords } from '@/lib/words-server';
import { LiteProvider } from './lite-mode';
import { MatchLineupsView } from './match-lineups';

/**
 * Player photos on the line-up pitch (T-1616, D-287): the photo in a ring of
 * the side's tone with the shirt number as a badge, the best rated in saffron
 * as a ring and a badge rather than a fill; without a photo the number circle
 * exactly as before, never a silhouette (rule 3); the bench with smaller
 * photos and the same fallback.
 */

const PHOTO = (id: string): EntityMedia => ({
  coverage: 'available',
  url: `/api/media/photo/${id}/abc123def456.png`,
});
const NONE: EntityMedia = { coverage: 'not_supplied', url: null };

let next = 0;
const player = (
  position: MatchLineupPlayer['position'],
  over: Partial<MatchLineupPlayer> = {},
): MatchLineupPlayer => {
  next += 1;
  const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
  return {
    id,
    name: `Player ${next}`,
    role: 'starter',
    shirt_number: next,
    position,
    is_captain: false,
    grid: null,
    photo: PHOTO(id),
    ...over,
  };
};
const eleven = (over: (i: number) => Partial<MatchLineupPlayer> = () => ({})) => [
  player('goalkeeper', over(0)),
  ...Array.from({ length: 4 }, (_, i) => player('defender', over(1 + i))),
  ...Array.from({ length: 4 }, (_, i) => player('midfielder', over(5 + i))),
  ...Array.from({ length: 2 }, (_, i) => player('forward', over(9 + i))),
];
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: '4-4-2',
  coach: null,
});

const render = (
  home: MatchLineupPlayer[],
  away: MatchLineupPlayer[],
  {
    ratings = new Map<string, number>(),
    locale = 'en',
  }: { ratings?: Map<string, number>; locale?: string } = {},
) =>
  renderToStaticMarkup(
    <MatchLineupsView
      home={team('h', 'Aston Villa')}
      away={team('a', 'Leeds')}
      lineups={{ home, away }}
      ratings={ratings}
      locale={locale}
      words={matchWords(locale)}
    />,
  );

const pitchOf = (html: string, side: 'home' | 'away') => {
  const start = html.indexOf(`data-testid="pitch-${side}"`);
  const end =
    side === 'away'
      ? html.indexOf('data-testid="pitch-home"')
      : html.indexOf('data-testid="lineup-pitch-note"');
  return html.slice(start, end);
};
const benchOf = (html: string) => html.slice(html.indexOf('data-testid="lineup-benches"'));

describe('player photos on the pitch (T-1616)', () => {
  it('draws the photo at a sized variant, lazy, with its box said, the number a badge on its edge', () => {
    const home = eleven();
    const html = render(home, eleven());
    const pitch = pitchOf(html, 'home');
    // Every starter is a photo: 22 discs on the pitch, each with its badge.
    expect(pitch.match(/data-photo="available"/g)).toHaveLength(11);
    expect(pitch).not.toContain('data-photo="none"');
    // A 40px disc asks for the 96px WebP (D-242), never the stored file.
    expect(pitch).toContain(`src="/api/media/photo/${home[0]!.id}/abc123def456-96.webp"`);
    expect(pitch).not.toMatch(/src="[^"]*\.png"/);
    expect(pitch).toMatch(/<img src="[^"]*" width="40" height="40" alt="" loading="lazy"/);
    // Round, cropped from the top, in the home side's ring.
    expect(pitch).toMatch(
      /class="[^"]*size-10 rounded-full bg-surface-raised object-cover border-2 p-px object-top border-fg"/,
    );
    // The shirt number as a badge in the side's tone, not the old circle.
    expect(pitch).toContain(
      `data-testid="lineup-shirt" class="absolute -end-1 bottom-0 grid place-items-center rounded-full px-0.5 leading-none font-extrabold tabular-nums ring-2 ring-surface-raised h-4.5 min-w-4.5 text-[10px] bg-fg text-canvas">${home[0]!.shirt_number}<`,
    );
    expect(pitch).not.toContain('data-testid="lineup-number"');
    // The away side in its own, muted tone.
    const away = pitchOf(html, 'away');
    expect(away).toContain('border-muted"');
    expect(away).toContain('bg-muted text-canvas">');
    expect(away).not.toContain('border-fg"');
  });

  it('keeps the number circle exactly as before when a player has no photo, never a silhouette', () => {
    const home = eleven((i) => (i === 3 ? { photo: NONE } : i === 4 ? { photo: undefined } : {}));
    const html = render(home, eleven());
    const pitch = pitchOf(html, 'home');
    expect(pitch.match(/data-photo="none"/g)).toHaveLength(2);
    expect(pitch.match(/data-photo="available"/g)).toHaveLength(9);
    // The circle the pitch drew before T-1616, in the slot every disc shares.
    expect(pitch).toContain(
      `<span class="relative grid shrink-0 place-items-center size-10" data-testid="lineup-disc" data-photo="none"><span data-testid="lineup-number" class="grid size-8 place-items-center rounded-full text-sm font-extrabold tabular-nums bg-fg text-canvas">${home[3]!.shirt_number}</span></span>`,
    );
    expect(pitch.match(/<img /g)).toHaveLength(9);
    // A foreign address is no photo at all.
    const foreign = eleven((i) =>
      i === 0 ? { photo: { coverage: 'available', url: 'https://media.example.com/p/1.png' } } : {},
    );
    const out = pitchOf(render(foreign, eleven()), 'home');
    expect(out).not.toContain('media.example.com');
    expect(out.match(/data-photo="none"/g)).toHaveLength(1);
  });

  it('draws the lettered mark for a player with neither a photo nor a shirt number', () => {
    const home = eleven((i) =>
      i === 0 ? { photo: NONE, shirt_number: null, name: 'Ali Daei' } : {},
    );
    const pitch = pitchOf(render(home, eleven()), 'home');
    expect(pitch).toContain('data-coverage="not_supplied" data-letters="AD"');
    // A photo without a number has no badge.
    const unnumbered = eleven((i) => (i === 0 ? { shirt_number: null } : {}));
    const out = pitchOf(render(unnumbered, eleven()), 'home');
    expect(out.match(/data-testid="lineup-shirt"/g)).toHaveLength(10);
  });

  it('marks the best rated with a saffron ring and badge, not a fill, and keeps the captain', () => {
    const home = eleven((i) => (i === 10 ? { is_captain: true } : {}));
    const away = eleven((i) => (i === 2 ? { photo: NONE } : {}));
    const ratings = new Map([
      [home[10]!.id, 8.9],
      [away[2]!.id, 9.1],
      [away[0]!.id, 6.2],
    ]);
    const html = render(home, away, { ratings });
    // The best has no photo: the old saffron circle.
    expect(pitchOf(html, 'away')).toContain(
      `data-best="true"><span data-testid="lineup-number" class="grid size-8 place-items-center rounded-full text-sm font-extrabold tabular-nums bg-accent text-on-accent">${away[2]!.shirt_number}</span>`,
    );
    // With a photo, the ring and the badge turn saffron and the photo stays.
    const best = new Map([[home[10]!.id, 9.4]]);
    const withPhoto = pitchOf(render(home, away, { ratings: best }), 'home');
    expect(withPhoto.match(/data-best="true"/g)).toHaveLength(1);
    expect(withPhoto).toContain('border-2 p-px object-top border-accent"');
    expect(withPhoto).toContain(`bg-accent text-on-accent">${home[10]!.shirt_number}<`);
    expect(withPhoto).not.toContain('bg-accent text-on-accent" data-testid');
    expect(withPhoto.match(/border-fg"/g)).toHaveLength(10);
    // The captain mark is kept beside the name.
    expect(withPhoto).toMatch(/Player \d+ \(c\)<\/span>/);
  });

  it('keeps the left and right of the badge logical, and the photo on a right-to-left page', () => {
    const html = render(eleven(), eleven(), { locale: 'fa' });
    expect(html).toContain('absolute -end-1 bottom-0');
    expect(html).not.toMatch(/\b(left|right)-/);
    // The shirt number in Persian digits on the badge.
    expect(html).toMatch(/data-testid="lineup-shirt" class="[^"]*">[۰-۹]+</);
  });

  it('cuts each name to its own share of a row of five, so names never run into each other', () => {
    const html = render(eleven(), eleven());
    expect(html).toContain(
      'class="flex w-18 min-w-0 flex-col items-center gap-0.5 px-0.5 text-center md:w-auto"',
    );
    expect(html).toContain('class="flex w-full min-w-0 flex-col items-center gap-0.5"');
    expect(html).toContain('class="block max-w-full truncate text-xs font-semibold text-fg"');
    // Room for a column of five with a photo, a name and a chip from 768px.
    expect(html).toContain('md:h-124');
    // From 768px the columns share the pitch and cut names rather than push
    // a goalkeeper off it: nine columns at 768px used to overflow.
    expect(
      html.match(/<ol (dir="ltr" )?class="flex justify-around py-1.5 md:min-w-0 md:flex-1/g),
    ).toHaveLength(8);
    expect(
      html.match(/class="relative flex flex-col md:min-w-0 md:flex-1 md:flex-row-reverse/g),
    ).toHaveLength(2);
  });

  it('draws nothing to fetch in lite mode: the number circle stands in for the photo', () => {
    const html = renderToStaticMarkup(
      <LiteProvider preference="on" slow={false}>
        <MatchLineupsView
          home={team('h', 'Aston Villa')}
          away={team('a', 'Leeds')}
          lineups={{ home: eleven(), away: eleven() }}
          locale="en"
          words={matchWords('en')}
        />
      </LiteProvider>,
    );
    expect(html).not.toContain('<img');
    expect(html.match(/data-testid="lineup-number"/g)?.length).toBeGreaterThanOrEqual(22);
  });
});

describe('player photos on the bench (T-1616)', () => {
  it('gives the bench smaller photos with the badge, and the number circle without one', () => {
    const home = [
      ...eleven(),
      player('forward', { role: 'bench' }),
      player('midfielder', { role: 'bench', photo: NONE }),
    ];
    const html = render(home, eleven());
    const bench = benchOf(html);
    expect(bench.match(/data-photo="available"/g)).toHaveLength(1);
    expect(bench.match(/data-photo="none"/g)).toHaveLength(1);
    // A 32px disc asks for the 96px WebP, its box said.
    expect(bench).toMatch(/<img src="[^"]*-96\.webp" width="32" height="32" alt="" loading="lazy"/);
    expect(bench).toContain('h-4 min-w-4 text-[9px] bg-fg text-canvas">');
    expect(bench).toContain(
      `data-testid="lineup-number" class="grid size-8 place-items-center rounded-full text-sm font-extrabold tabular-nums bg-fg text-canvas">${home[12]!.shirt_number}</span>`,
    );
    // The number is in the disc now, not written again before the name.
    expect(bench).not.toContain('font-mono');
    expect(bench).toContain(`href="/en/player/${home[11]!.id}"`);
  });

  it('gives a side drawn as a list the same discs', () => {
    const home = eleven().map((p) => ({ ...p, position: null }));
    const html = render(home, eleven());
    const list = html.slice(
      html.indexOf('data-testid="lineup-list-home"'),
      html.indexOf('data-testid="lineup-benches"'),
    );
    expect(list.match(/data-testid="lineup-disc"/g)).toHaveLength(11);
    expect(list).toMatch(/width="32" height="32"/);
  });
});

describe('one player on both line-ups (T-1687, D-333)', () => {
  it('marks him on each side as unclear in the source, with a note, and guesses nothing', () => {
    const home = eleven();
    const twice = home[7] as MatchLineupPlayer;
    const away = eleven();
    away[7] = { ...twice, shirt_number: 32 };
    const html = render(home, away);
    expect(html.match(/\(unclear in the source\)/g)?.length).toBe(2);
    expect(html).toContain('data-testid="lineup-both-sides"');
    // Both rows stay: the player is shown where the feed put him on each side.
    expect(html.split(twice.name).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('says so in Persian', () => {
    const home = eleven();
    const away = eleven();
    away[3] = { ...(home[3] as MatchLineupPlayer) };
    const html = render(home, away, { locale: 'fa' });
    expect(html).toContain('نامشخص در منبع');
  });

  it('marks nobody when the sides share no player', () => {
    const html = render(eleven(), eleven());
    expect(html).not.toContain('unclear in the source');
    expect(html).not.toContain('lineup-both-sides');
  });
});
