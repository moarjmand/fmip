import type { MatchCentre, PanelLinkedPrediction } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { linkCard, linkChoices, parseLinkChoice } from './panel-link';

const ID = '11111111-1111-4111-8111-111111111111';
const names = { home: 'Home FC', away: 'Away FC' };

function centre(overrides: Partial<MatchCentre>): MatchCentre {
  const none = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;
  return {
    fixture: { home: { name: 'Home FC' }, away: { name: 'Away FC' } },
    timeline: none,
    statistics: none,
    lineups: none,
    ...overrides,
  } as unknown as MatchCentre;
}

const call: PanelLinkedPrediction = {
  outcome: 'home',
  home_goals: 2,
  away_goals: 1,
  confidence: 4,
  submitted_at: '2026-09-01T10:00:00Z',
  revised_since: false,
};

describe('linkChoices (T-1030)', () => {
  it('offers nothing the feed did not supply', () => {
    expect(linkChoices(centre({}), false)).toEqual([]);
  });

  it('offers incidents, both line-ups, supplied statistics and the member’s own call', () => {
    const groups = linkChoices(
      centre({
        timeline: {
          coverage: 'available',
          last_updated_at: null,
          data: [
            {
              id: ID,
              sequence: 1,
              minute: 23,
              added_time: null,
              kind: 'goal',
              side: 'home',
              player: { id: ID, name: 'Scorer' },
              related_player: null,
              detail: null,
            },
          ],
        },
        lineups: {
          coverage: 'available',
          last_updated_at: null,
          data: {
            home: [
              {
                id: ID,
                name: 'Keeper',
                role: 'starter',
                shirt_number: 1,
                position: 'goalkeeper',
                is_captain: false,
              },
            ],
            away: [],
          },
        },
        statistics: {
          coverage: 'available',
          last_updated_at: null,
          data: [{ metric: 'shots', home: 7, away: null }],
        },
      }),
      true,
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Incidents',
      'Players',
      'Statistics',
      'Your prediction',
    ]);
    expect(groups[0]?.choices[0]?.value).toBe(`incident:${ID}`);
    expect(groups[1]?.choices[0]).toEqual({ value: `player:${ID}`, label: 'Keeper (Home FC)' });
    // The away side supplied no shots: no choice for it rather than a zero.
    expect(groups[2]?.choices.map((c) => c.value)).toEqual(['statistic:home:shots']);
  });
});

describe('parseLinkChoice (T-1030)', () => {
  it('round-trips every kind and drops anything else', () => {
    expect(parseLinkChoice('')).toBeNull();
    expect(parseLinkChoice('prediction')).toEqual({ kind: 'prediction' });
    expect(parseLinkChoice(`incident:${ID}`)).toEqual({ kind: 'incident', incident_id: ID });
    expect(parseLinkChoice(`player:${ID}`)).toEqual({ kind: 'player', person_id: ID });
    expect(parseLinkChoice('statistic:away:corners')).toEqual({
      kind: 'statistic',
      side: 'away',
      metric: 'corners',
    });
    expect(parseLinkChoice('statistic:left:corners')).toBeNull();
    expect(parseLinkChoice('incident:nope')).toBeNull();
  });
});

describe('linkCard (T-1030)', () => {
  it('says an incident was removed and shows nothing of it', () => {
    const card = linkCard(
      { kind: 'incident', state: 'removed', incident: null },
      'Cara',
      names,
      null,
    );
    expect(card.lines).toEqual([]);
    expect(card.note).toBe('The data feed has since removed this incident.');
  });

  it('says an incident changed and shows it as it stands now', () => {
    const card = linkCard(
      {
        kind: 'incident',
        state: 'changed',
        incident: {
          kind: 'red_card',
          minute: 41,
          added_time: null,
          side: 'away',
          player: { id: ID, name: 'Hothead' },
          related_player: null,
          detail: null,
        },
      },
      'Cara',
      names,
      null,
    );
    expect(card.lines[0]).toContain('Hothead (Away FC)');
    expect(card.note).toMatch(/changed this incident after it was linked/);
  });

  it('labels a prediction as the member’s own, never the model’s', () => {
    const card = linkCard(
      { kind: 'prediction', state: 'visible', visibility: null, prediction: call },
      'Cara',
      names,
      null,
    );
    expect(card.heading).toBe("Cara's prediction");
    expect(card.lines).toContain(
      "A member's own call. Not the model's forecast or the community's.",
    );
    expect(card.lines[0]).toBe("Cara's prediction: home win 2-1, confidence 4 of 5.");
  });

  it('withholds a prediction unless this viewer was sent it', () => {
    const withheld = {
      kind: 'prediction',
      state: 'withheld',
      visibility: 'friends',
      prediction: null,
    } as const;
    expect(linkCard(withheld, 'Cara', names, null)).toEqual({
      heading: "Cara's prediction",
      lines: [],
      note: 'This member shows their predictions to friends only.',
    });
    expect(linkCard(withheld, 'Cara', names, call).lines[0]).toMatch(/home win/);
  });

  it('keeps a statistic as posted and says what it is now', () => {
    const card = linkCard(
      {
        kind: 'statistic',
        side: 'home',
        metric: 'possession_pct',
        value_at_post: 55,
        current: 61,
      },
      'Cara',
      names,
      null,
    );
    expect(card.lines[0]).toMatch(/55% when posted/);
    expect(card.note).toBe('Now 61%.');
  });

  it('says when a linked player left both line-ups', () => {
    expect(
      linkCard(
        { kind: 'player', player: { id: ID, name: 'Sub' }, side: null, in_lineup: false },
        'Cara',
        names,
        null,
      ).note,
    ).toMatch(/no longer lists this player/);
  });
});
