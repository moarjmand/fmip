import type { PlayerSpell } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { type ClubSource, type ClubSources, clubOf } from './internal/player-store';

/**
 * T-1629 (D-295): the club a player page names. Production had no open spell
 * at all, so the header named the team of the latest line-up of any kind: a
 * national team for 4,283 players, and the former club for 2,760 who had
 * moved since their last line-up for a club.
 */
describe("a player's club (T-1629)", () => {
  const team = (id: string) => ({ id, name: id, short_name: null, colour: null });
  const at = (day: string, club: string | null, loan = false): ClubSource => ({
    team: club === null ? null : team(club),
    day,
    at: `${day}T12:00:00.000Z`,
    loan,
  });
  const none: ClubSources = { squad: null, move: null, lineup: null };

  it('takes an open spell first', () => {
    const spell: PlayerSpell = {
      team: team('spell'),
      start_date: '2025-07-01',
      end_date: null,
      shirt_number: 9,
      position: 'forward',
      on_loan: true,
    };
    expect(clubOf(spell, { ...none, lineup: at('2026-10-25', 'other') })).toEqual({
      coverage: 'available',
      last_updated_at: null,
      data: { team: team('spell'), basis: 'spell', since: '2025-07-01', on_loan: true },
    });
  });

  it('reads the latest club line-up as limited: what he played for, not a contract', () => {
    expect(clubOf(null, { ...none, lineup: at('2026-10-25', 'madrid') })).toEqual({
      coverage: 'limited',
      last_updated_at: '2026-10-25T12:00:00.000Z',
      data: { team: team('madrid'), basis: 'lineup', since: '2026-10-25', on_loan: false },
    });
  });

  it('names the club of a newer squad list or move, not the former one', () => {
    // Javier Llabrés: last line-up for Mallorca in May, in Burgos's squad in October.
    expect(
      clubOf(null, {
        ...none,
        lineup: at('2026-05-23', 'mallorca'),
        squad: at('2026-10-22', 'burgos'),
      }).data,
    ).toMatchObject({ team: { id: 'burgos' }, basis: 'squad', since: '2026-10-22' });
    // Emil Riis Jacobsen: Bristol City in August, moved to Leicester on the 31st.
    expect(
      clubOf(null, {
        ...none,
        lineup: at('2026-08-22', 'bristol'),
        move: at('2026-08-31', 'leicester'),
      }),
    ).toMatchObject({
      coverage: 'available',
      data: { team: { id: 'leicester' }, basis: 'transfer', since: '2026-08-31', on_loan: false },
    });
  });

  it('keeps a line-up newer than the squad list or the move, and wins a tie', () => {
    expect(
      clubOf(null, {
        squad: at('2026-10-21', 'old'),
        move: at('2026-08-01', 'old'),
        lineup: at('2026-10-25', 'new'),
      }).data,
    ).toMatchObject({ team: { id: 'new' }, basis: 'lineup' });
    expect(
      clubOf(null, {
        ...none,
        squad: at('2026-10-25', 'listed'),
        lineup: at('2026-10-25', 'played'),
      }).data,
    ).toMatchObject({ team: { id: 'played' }, basis: 'lineup' });
  });

  it('says on loan when the latest move into that club was a loan', () => {
    expect(
      clubOf(null, {
        ...none,
        move: at('2026-08-30', 'loan-club', true),
        lineup: at('2026-10-20', 'loan-club'),
      }).data,
    ).toMatchObject({ team: { id: 'loan-club' }, basis: 'lineup', on_loan: true });
    expect(clubOf(null, { ...none, move: at('2026-08-30', 'loan-club', true) }).data).toMatchObject(
      { basis: 'transfer', on_loan: true },
    );
  });

  it('names no club after a newer move to a club we do not hold, or to none', () => {
    expect(
      clubOf(null, { ...none, lineup: at('2026-05-02', 'former'), move: at('2026-08-12', null) }),
    ).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    // An older such move changes nothing.
    expect(
      clubOf(null, { ...none, lineup: at('2026-10-02', 'current'), move: at('2026-08-12', null) })
        .data,
    ).toMatchObject({ team: { id: 'current' } });
  });

  it('says not supplied when nothing names a club', () => {
    expect(clubOf(null, none)).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
  });
});
