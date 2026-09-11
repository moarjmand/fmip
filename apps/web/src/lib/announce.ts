import type { MatchCentre, ScoreCard, ScoresResponse } from '@fmip/contracts';

/**
 * Live-score announcements for assistive technology (T-081, D-041). A
 * screen reader cannot watch a number change, so every change the stream
 * brings is put into words once, in a polite live region: a goal, a kick-off,
 * a red card, full time. Pure, so the wording is unit-tested.
 */

export interface Snapshot {
  id: string;
  home: string;
  away: string;
  status: string;
  score: { home: number; away: number } | null;
  redCards: { home: number; away: number };
}

const STATUS_WORD: Record<string, string> = {
  live: 'Kick-off',
  finished: 'Full time',
  postponed: 'Postponed',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
  awarded: 'Result awarded',
};

function scoreWords(s: Snapshot): string {
  return s.score === null
    ? `${s.home} against ${s.away}`
    : `${s.home} ${s.score.home}, ${s.away} ${s.score.away}`;
}

/** What to say when `before` became `after`; nothing when nothing worth saying changed. */
export function describeChange(before: Snapshot | undefined, after: Snapshot): string[] {
  const said: string[] = [];
  if (before === undefined) return said;
  if (before.status !== after.status) {
    const word = STATUS_WORD[after.status];
    if (word !== undefined) said.push(`${word}: ${scoreWords(after)}.`);
  }
  if (after.score !== null && before.score !== null) {
    const homeUp = after.score.home > before.score.home;
    const awayUp = after.score.away > before.score.away;
    const down = after.score.home < before.score.home || after.score.away < before.score.away;
    // A score that went down is a correction, not a goal.
    if (down) said.push(`Score corrected: ${scoreWords(after)}.`);
    else {
      if (homeUp) said.push(`Goal for ${after.home}: ${scoreWords(after)}.`);
      if (awayUp) said.push(`Goal for ${after.away}: ${scoreWords(after)}.`);
    }
  }
  if (after.redCards.home > before.redCards.home) said.push(`Red card for ${after.home}.`);
  if (after.redCards.away > before.redCards.away) said.push(`Red card for ${after.away}.`);
  return said;
}

function fromCard(card: ScoreCard): Snapshot {
  return {
    id: card.id,
    home: card.home.name,
    away: card.away.name,
    status: card.status,
    score: card.scores.current === null ? null : { ...card.scores.current },
    redCards: { home: card.red_cards.home, away: card.red_cards.away },
  };
}

function cardsOf(scores: ScoresResponse): ScoreCard[] {
  return [...scores.pinned, ...scores.groups.flatMap((g) => g.fixtures)];
}

/** Everything worth saying between two scores snapshots, in list order. */
export function scoresAnnouncements(before: ScoresResponse, after: ScoresResponse): string[] {
  const previous = new Map(cardsOf(before).map((c) => [c.id, fromCard(c)]));
  return cardsOf(after).flatMap((card) => describeChange(previous.get(card.id), fromCard(card)));
}

/** Red cards per side from the timeline, when the timeline is there. */
function redCardsOf(centre: MatchCentre): { home: number; away: number } {
  const counts = { home: 0, away: 0 };
  for (const incident of centre.timeline.data ?? []) {
    if (
      (incident.kind === 'red_card' || incident.kind === 'second_yellow_card') &&
      incident.side !== null
    ) {
      counts[incident.side] += 1;
    }
  }
  return counts;
}

function fromCentre(centre: MatchCentre): Snapshot {
  const f = centre.fixture;
  return {
    id: f.id,
    home: f.home.name,
    away: f.away.name,
    status: f.status,
    score: f.scores.current === null ? null : { ...f.scores.current },
    redCards: redCardsOf(centre),
  };
}

/** Everything worth saying between two match-centre snapshots. */
export function matchAnnouncements(before: MatchCentre, after: MatchCentre): string[] {
  return describeChange(fromCentre(before), fromCentre(after));
}
