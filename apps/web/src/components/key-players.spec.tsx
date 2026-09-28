import type { KeyPlayer, KeyPlayers } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { availabilityLine, coverageLine, figuresLine, ruleNote } from '@/lib/key-players';
import { KeyPlayersPanel } from './key-players';

/**
 * The match centre's key players (T-841), rendered: the stated rule under
 * the section, season figures per player, a doubt as a doubt, nothing
 * claimed when the provider was never asked, and a side without figures
 * said in a sentence.
 */

const player = (over: Partial<KeyPlayer> = {}): KeyPlayer => ({
  id: 'p1',
  name: 'One',
  position: 'forward',
  appearances: 15,
  minutes: 1234,
  goals: 6,
  assists: 1,
  availability: null,
  ...over,
});

const base: KeyPlayers = {
  fixture_id: 'm',
  competition: { id: 'c', name: 'Premier League' },
  season: { id: 's', label: '2024/25' },
  home: {
    coverage: 'limited',
    last_updated_at: '2025-01-01T00:00:00.000Z',
    data: {
      team: { id: 'h', name: 'Home' },
      matches_played: 16,
      matches_with_figures: 15,
      players: [
        player(),
        player({
          id: 'p2',
          name: 'Two',
          position: null,
          availability: { status: 'doubtful', kind: 'injury', reason: 'Hamstring' },
        }),
        player({
          id: 'p3',
          name: 'Three',
          availability: { status: 'not_listed', kind: null, reason: null },
        }),
      ],
    },
  },
  away: { coverage: 'not_supplied', last_updated_at: null, data: null },
  availability_asked_at: '2025-01-04T09:00:00.000Z',
};

describe('the key players words', () => {
  it('states the rule as a count, with the competition and the season', () => {
    const note = ruleNote('Premier League', '2024/25');
    expect(note).toContain('3 with the most minutes in Premier League 2024/25 before this match');
    expect(note).toContain('goals plus assists, then the name');
    expect(note).toContain('no rating is used');
  });

  it('writes the season figures, singular where one', () => {
    const format = (n: number) => String(n);
    expect(figuresLine(player(), format)).toBe('1234 min in 15 matches · 6 goals · 1 assist');
    expect(figuresLine(player({ appearances: 1, goals: 1, assists: 0 }), format)).toBe(
      '1234 min in 1 match · 1 goal · 0 assists',
    );
  });

  it('keeps a doubt a doubt and claims nothing never asked', () => {
    expect(availabilityLine(player())).toBeNull();
    expect(
      availabilityLine(
        player({ availability: { status: 'doubtful', kind: 'injury', reason: 'Knee' } }),
      ),
    ).toBe('Doubtful · Knee');
    expect(
      availabilityLine(player({ availability: { status: 'out', kind: null, reason: null } })),
    ).toBe('Out');
    expect(
      availabilityLine(
        player({ availability: { status: 'not_listed', kind: null, reason: null } }),
      ),
    ).toBe('Not on the provider’s absence list');
  });

  it('says how much of the season the figures cover', () => {
    const side = { team: { id: 'h', name: 'H' }, players: [] };
    expect(coverageLine({ ...side, matches_played: 0, matches_with_figures: 0 })).toMatch(
      /no minutes to count yet/,
    );
    expect(coverageLine({ ...side, matches_played: 16, matches_with_figures: 15 })).toBe(
      'From player figures for 15 of 16 matches played: the other matches have none, so these totals are a floor.',
    );
    expect(coverageLine({ ...side, matches_played: 1, matches_with_figures: 1 })).toBe(
      'From player figures for all 1 match played.',
    );
  });
});

describe('the key players panel', () => {
  const html = renderToStaticMarkup(
    <KeyPlayersPanel players={base} home="Home" away="Away" locale="en" timeZone="UTC" />,
  );

  it('lists each side, its coverage, and links every player', () => {
    expect(html.match(/data-testid="key-players-side"/g)).toHaveLength(2);
    expect(html.match(/data-testid="key-player"/g)).toHaveLength(3);
    expect(html).toContain('data-coverage="limited"');
    expect(html).toContain('href="/en/player/p1"');
    expect(html).toContain('1,234 min in 15 matches · 6 goals · 1 assist');
    expect(html).toContain(' · Forward');
    // Stacked on a phone, side by side from `sm`.
    expect(html).toContain('grid-cols-1 gap-4 text-sm sm:grid-cols-2');
  });

  it('shows a doubt as a doubt, and a player with nothing said about him with nothing', () => {
    expect(html).toMatch(/data-status="doubtful"[^>]*>Doubtful · Hamstring</);
    expect(html).toContain('data-status="not_listed"');
    expect(html.match(/data-testid="key-player-availability"/g)).toHaveLength(2);
  });

  it('says a side without figures in a sentence, with its own name', () => {
    expect(html).toContain('<bdi>Away</bdi>');
    expect(html).toContain('No per-match player figures for this side this season.');
  });

  it('carries the rule and when the provider was asked', () => {
    expect(html).toContain('data-testid="key-players-rule"');
    expect(html).toContain('Availability as the provider gave it');
    expect(html).not.toMatch(/rating [0-9]/i);
  });

  it('claims no availability when the provider was never asked', () => {
    const never = renderToStaticMarkup(
      <KeyPlayersPanel
        players={{ ...base, availability_asked_at: null }}
        home="Home"
        away="Away"
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(never).toContain('has not been asked about this match, so none is claimed');
  });

  it('says so when the API cannot be reached', () => {
    const down = renderToStaticMarkup(
      <KeyPlayersPanel players={null} home="Home" away="Away" locale="en" timeZone="UTC" />,
    );
    expect(down).toContain('data-state="unreachable"');
  });
});
