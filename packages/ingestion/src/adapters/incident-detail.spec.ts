import { describe, expect, it } from 'vitest';
import { INCIDENT_DETAILS, INCIDENT_KINDS, type IncidentKind } from '../normalised';
import { validateIncident } from '../harness/validate';
import { incidentDetail } from './_incident-detail';
import { mapIncidents } from './api-football/map';

/**
 * T-1378 (rule 2): a provider's incident text never reaches a page. Only what
 * a VAR review decided is a detail, in our words; a detail that repeats the
 * kind is none, and so is one we cannot name.
 */
describe('incidentDetail (T-1378)', () => {
  // API-Football's `type` and `detail` as the live feed sends them, each with
  // the kind `incidentKind` gives it, and the detail we keep.
  const known: [type: string, detail: string, kind: IncidentKind, ours: string | null][] = [
    ['Goal', 'Normal Goal', 'goal', null],
    ['Goal', 'Penalty', 'penalty_goal', null],
    ['Goal', 'Own Goal', 'own_goal', null],
    ['Goal', 'Missed Penalty', 'penalty_missed', null],
    ['Card', 'Yellow Card', 'yellow_card', null],
    ['Card', 'Red card', 'red_card', null],
    ['Card', 'Second Yellow card', 'second_yellow_card', null],
    ['subst', 'Substitution 1', 'substitution', null],
    ['subst', 'Substitution 5', 'substitution', null],
    ['Var', 'Var', 'var', null],
    ['Var', 'Goal cancelled', 'var', 'goal_cancelled'],
    ['Var', 'Goal Disallowed - offside', 'var', 'goal_cancelled'],
    ['Var', 'Goal Disallowed - Foul', 'var', 'goal_cancelled'],
    ['Var', 'Goal Disallowed - handball', 'var', 'goal_cancelled'],
    ['Var', 'Goal confirmed', 'var', 'goal_confirmed'],
    ['Var', 'Penalty confirmed', 'var', 'penalty_confirmed'],
    ['Var', 'Penalty cancelled', 'var', 'penalty_cancelled'],
    ['Var', 'Penalty awarded', 'var', 'penalty_awarded'],
    ['Var', 'Card upgrade', 'var', 'card_upgraded'],
    ['Var', 'Red card cancelled', 'var', 'card_cancelled'],
  ];

  it.each(known)('maps %s / "%s" to its kind and our detail', (type, detail, kind, ours) => {
    const [incident] = mapIncidents(
      [
        {
          time: { elapsed: 10, extra: null },
          team: { id: 1 },
          player: { id: 7, name: 'P' },
          assist: { id: 8, name: 'Q' },
          type,
          detail,
        },
      ],
      '1',
      '1',
    );
    expect(incident?.kind).toBe(kind);
    expect(incident?.detail).toBe(ours);
    expect(incidentDetail(kind, detail)).toBe(ours);
    expect(validateIncident(incident)).toEqual([]);
  });

  it('names no detail it cannot read, and never returns the text', () => {
    for (const kind of INCIDENT_KINDS) {
      for (const text of ['Something new', 'Foul', 'Goal under review', '', '  ', null, 3]) {
        expect(incidentDetail(kind, text)).toBeNull();
      }
    }
  });

  it('gives a detail only to a VAR review', () => {
    for (const kind of INCIDENT_KINDS.filter((k) => k !== 'var')) {
      expect(incidentDetail(kind, 'Goal cancelled')).toBeNull();
      expect(incidentDetail(kind, 'goal_cancelled')).toBeNull();
    }
  });

  it('maps a stored code to itself, so a row of either age reads the same', () => {
    for (const code of INCIDENT_DETAILS) expect(incidentDetail('var', code)).toBe(code);
  });

  it('reads the subject a text names first', () => {
    expect(incidentDetail('var', 'Goal cancelled - penalty to the other side')).toBe(
      'goal_cancelled',
    );
    expect(incidentDetail('var', 'Penalty cancelled - no goal')).toBe('penalty_cancelled');
  });

  it('refuses the provider text as a stored detail in the harness', () => {
    const incident = {
      fixtureExternalId: '1',
      sequence: 1,
      minute: 10,
      addedTime: null,
      kind: 'goal',
      side: 'home',
      player: { externalId: '7', name: 'P' },
      relatedPlayer: null,
    };
    expect(validateIncident({ ...incident, detail: 'Normal Goal' })).not.toEqual([]);
    expect(validateIncident({ ...incident, detail: 'goal_cancelled' })).not.toEqual([]);
    expect(validateIncident({ ...incident, detail: null })).toEqual([]);
  });
});
