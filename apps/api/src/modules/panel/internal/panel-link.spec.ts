import { describe, expect, it } from 'vitest';
import { incidentState, linkOf, parseLinkRequest } from './panel-link';
import type { PanelLinkRow } from './panel-store';

const ID = '11111111-1111-4111-8111-111111111111';
const HOME = '22222222-2222-4222-8222-222222222222';

function row(overrides: Partial<PanelLinkRow>): PanelLinkRow {
  return {
    post_id: ID,
    author_id: ID,
    author_username: 'writer',
    link_kind: 'incident',
    link_snapshot: null,
    incident_id: null,
    incident_kind: null,
    minute: null,
    added_time: null,
    incident_participant_id: null,
    incident_side: null,
    incident_person_id: null,
    incident_person_name: null,
    incident_related_id: null,
    incident_related_name: null,
    incident_detail: null,
    player_id: null,
    player_name: null,
    player_side: null,
    outcome: null,
    home_goals: null,
    away_goals: null,
    confidence: null,
    submitted_at: null,
    revised_since: false,
    stat_side: null,
    stat_metric: null,
    stat_current: null,
    ...overrides,
  };
}

const goal = {
  incident_id: ID,
  incident_kind: 'goal',
  minute: 23,
  added_time: null,
  incident_participant_id: HOME,
  incident_side: 'home' as const,
  incident_person_id: ID,
  incident_person_name: 'Scorer',
  incident_related_id: null,
  incident_detail: null,
  link_snapshot: {
    kind: 'goal',
    minute: 23,
    added_time: null,
    participant_id: HOME,
    person_id: ID,
    related_person_id: null,
    detail: null,
  },
};

describe('parseLinkRequest (T-1030)', () => {
  it('reads no link as none', () => {
    expect(parseLinkRequest(undefined)).toBeNull();
    expect(parseLinkRequest(null)).toBeNull();
  });

  it('accepts each kind in its own shape', () => {
    expect(parseLinkRequest({ kind: 'incident', incident_id: ID })).toEqual({
      kind: 'incident',
      incident_id: ID,
    });
    expect(parseLinkRequest({ kind: 'player', person_id: ID })).toEqual({
      kind: 'player',
      person_id: ID,
    });
    expect(parseLinkRequest({ kind: 'prediction', prediction_version_id: ID })).toEqual({
      kind: 'prediction',
    });
    expect(parseLinkRequest({ kind: 'statistic', side: 'away', metric: 'shots' })).toEqual({
      kind: 'statistic',
      side: 'away',
      metric: 'shots',
    });
  });

  it('names what is wrong with a malformed link', () => {
    expect(parseLinkRequest('goal')).toBe('A link must be an object.');
    expect(parseLinkRequest({ kind: 'forecast' })).toMatch(/kind is one of/);
    expect(parseLinkRequest({ kind: 'incident', incident_id: 'x' })).toMatch(/incident id/);
    expect(parseLinkRequest({ kind: 'player' })).toMatch(/player id/);
    expect(parseLinkRequest({ kind: 'statistic', side: 'left', metric: 'shots' })).toMatch(/side/);
    expect(parseLinkRequest({ kind: 'statistic', side: 'home', metric: 'xg' })).toMatch(
      /statistics/,
    );
  });
});

describe('incidentState (T-1030)', () => {
  it('is as linked while the feed says the same', () => {
    expect(incidentState(row(goal))).toBe('as_linked');
  });

  it('is changed when any field the card shows moved', () => {
    expect(incidentState(row({ ...goal, minute: 24 }))).toBe('changed');
    expect(incidentState(row({ ...goal, incident_kind: 'own_goal' }))).toBe('changed');
    expect(incidentState(row({ ...goal, incident_detail: 'VAR: offside' }))).toBe('changed');
  });

  it('is removed when the feed no longer has it', () => {
    expect(incidentState(row({ ...goal, incident_id: null }))).toBe('removed');
  });
});

describe('linkOf (T-1030)', () => {
  it('never shows a removed incident, and shows a changed one as it is now', () => {
    expect(linkOf(row({ ...goal, incident_id: null }), 'visible')).toEqual({
      kind: 'incident',
      state: 'removed',
      incident: null,
    });
    const changed = linkOf(row({ ...goal, minute: 31 }), 'visible');
    expect(changed).toMatchObject({ state: 'changed', incident: { minute: 31 } });
  });

  it('withholds a prediction the author does not show the public, naming the setting', () => {
    const call = row({
      link_kind: 'prediction',
      outcome: 'home',
      home_goals: 2,
      away_goals: 1,
      confidence: 4,
      submitted_at: new Date('2026-09-01T10:00:00Z'),
    });
    expect(linkOf(call, 'friends')).toEqual({
      kind: 'prediction',
      state: 'withheld',
      visibility: 'friends',
      prediction: null,
    });
    expect(linkOf(call, 'visible')).toMatchObject({
      state: 'visible',
      prediction: { outcome: 'home', home_goals: 2, revised_since: false },
    });
  });

  it('says when a linked player has left both line-ups', () => {
    expect(
      linkOf(row({ link_kind: 'player', player_id: ID, player_name: 'P' }), 'visible'),
    ).toEqual({ kind: 'player', player: { id: ID, name: 'P' }, side: null, in_lineup: false });
  });

  it('keeps the statistic as posted beside its value now', () => {
    expect(
      linkOf(
        row({
          link_kind: 'statistic',
          link_snapshot: { value: 55 },
          stat_side: 'home',
          stat_metric: 'possession_pct',
          stat_current: '61.00',
        }),
        'visible',
      ),
    ).toEqual({
      kind: 'statistic',
      side: 'home',
      metric: 'possession_pct',
      value_at_post: 55,
      current: 61,
    });
  });
});
