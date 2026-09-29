import type { EntityNewsResponse, PlayerAvailability } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerAvailabilitySection } from './player-availability';
import { EntityNews } from './related-news';

/**
 * The player page's availability and news (T-1007, D-127), rendered: nothing
 * claimed before the feed was asked, "not listed" and never "fit" once it
 * was, the time of the ask with a warning when it is old, and a player's news
 * that says it cannot speak while no story links any person.
 */
const NOW = new Date('2026-09-29T12:00:00Z');
const none = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;
const team = { id: 't', name: 'Home FC', short_name: null, basis: 'spell' } as const;
const fixture = {
  id: 'm',
  kickoff_at: '2026-10-01T18:00:00Z',
  opponent: { id: 'o', name: 'Away FC', short_name: null },
};

const render = (availability: PlayerAvailability): string =>
  renderToStaticMarkup(
    <PlayerAvailabilitySection locale="en" timeZone="UTC" availability={availability} now={NOW} />,
  );

describe('PlayerAvailabilitySection (T-1007)', () => {
  it('says why it says nothing: no team, no match ahead, not asked', () => {
    expect(render({ team: null, fixture: null, listing: none, reason: 'no_team' })).toContain(
      'No current team on record',
    );
    expect(render({ team, fixture: null, listing: none, reason: 'no_next_match' })).toContain(
      'No scheduled match ahead',
    );
    const unasked = render({ team, fixture, listing: none, reason: 'not_asked' });
    expect(unasked).toContain('has not yet been asked');
    expect(unasked).toContain('Home FC – Away FC');
    expect(unasked).not.toContain('Feed asked');
  });

  it('once asked: out with the reason, or not listed -- never fit', () => {
    const out = render({
      team,
      fixture,
      listing: {
        coverage: 'available',
        last_updated_at: '2026-09-29T11:00:00Z',
        data: {
          status: 'out',
          kind: 'injury',
          reason: 'Hamstring',
          reported_at: '2026-09-28T10:00:00Z',
        },
      },
      reason: null,
    });
    expect(out).toContain('Listed out');
    expect(out).toContain('Injury');
    expect(out).toContain('Hamstring');
    expect(out).not.toContain('may have changed');
    const absent = render({
      team,
      fixture,
      listing: {
        coverage: 'available',
        last_updated_at: '2026-09-29T01:00:00Z',
        data: { status: 'not_listed', kind: null, reason: null, reported_at: null },
      },
      reason: null,
    });
    expect(absent).toContain('Not on the feed');
    expect(absent).toContain('never confirms that a player is fit');
    expect(absent).toContain('may have changed');
  });
});

describe('EntityNews for a player (T-1007)', () => {
  it('says the list cannot speak while no story links any person', () => {
    const news: EntityNewsResponse = {
      entity: { type: 'person', id: 'p' },
      stories: { coverage: 'not_supplied', last_updated_at: '2026-09-29T10:00:00Z', data: null },
      reason: 'persons_unlinked',
    };
    const html = renderToStaticMarkup(<EntityNews locale="en" timeZone="UTC" news={news} />);
    expect(html).toContain('not linked to players yet');
    expect(html).toContain('data-state="not_supplied"');
  });

  it('says nobody wrote about the player once links exist', () => {
    const news: EntityNewsResponse = {
      entity: { type: 'person', id: 'p' },
      stories: { coverage: 'available', last_updated_at: '2026-09-29T10:00:00Z', data: [] },
      reason: 'nothing_linked',
    };
    const html = renderToStaticMarkup(<EntityNews locale="en" timeZone="UTC" news={news} />);
    expect(html).toContain('reported on this player');
  });
});
