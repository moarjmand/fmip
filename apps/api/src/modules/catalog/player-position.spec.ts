import type { PlayerSpell } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { positionOf } from './internal/player-store';

/** T-1603: a player's position from what our records say, never a guess. */
describe("a player's position (T-1603)", () => {
  const spell = (position: PlayerSpell['position']): PlayerSpell => ({
    team: { id: 't', name: 'T', short_name: null },
    start_date: '2025-07-01',
    end_date: null,
    shirt_number: 8,
    position,
    on_loan: false,
  });
  const squad = { position: 'defender' as const, at: '2026-10-01T00:00:00.000Z' };
  const lineup = { position: 'forward' as const, at: '2026-10-20T15:00:00.000Z' };

  it('takes the open spell first, then the squad listing, both as registered', () => {
    expect(positionOf(spell('midfielder'), { squad, lineup })).toEqual({
      coverage: 'available',
      last_updated_at: null,
      data: { value: 'midfielder', basis: 'spell' },
    });
    expect(positionOf(spell(null), { squad, lineup })).toEqual({
      coverage: 'available',
      last_updated_at: squad.at,
      data: { value: 'defender', basis: 'squad' },
    });
  });

  it('reads the line-ups as limited: what the player played, not their registration', () => {
    expect(positionOf(null, { squad: null, lineup })).toEqual({
      coverage: 'limited',
      last_updated_at: lineup.at,
      data: { value: 'forward', basis: 'lineup' },
    });
  });

  it('says not supplied when nothing names one', () => {
    expect(positionOf(null, { squad: null, lineup: null })).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
  });
});
