import type { MatchCentre, ScoreCard, ScoresResponse } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import { fill } from '@/lib/words';

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

/** The words an announcement is made of, resolved for the reader's locale (T-1303). */
export type AnnounceKey =
  | 'scores.announce.kickOff'
  | 'scores.announce.fullTime'
  | 'scores.announce.awarded'
  | 'scores.announce.status'
  | 'scores.announce.scoreLine'
  | 'scores.announce.against'
  | 'scores.announce.corrected'
  | 'scores.announce.goal'
  | 'scores.announce.redCard'
  | 'status.postponed'
  | 'status.suspended'
  | 'status.cancelled'
  | 'status.abandoned';

export interface AnnounceWords {
  locale: string;
  m: Record<AnnounceKey, Message>;
}

const STATUS_WORD: Record<string, AnnounceKey> = {
  live: 'scores.announce.kickOff',
  finished: 'scores.announce.fullTime',
  postponed: 'status.postponed',
  suspended: 'status.suspended',
  cancelled: 'status.cancelled',
  abandoned: 'status.abandoned',
  awarded: 'scores.announce.awarded',
};

function scoreWords(s: Snapshot, words: AnnounceWords): string {
  return s.score === null
    ? fill(words.m['scores.announce.against'].text, { home: s.home, away: s.away })
    : fill(words.m['scores.announce.scoreLine'].text, {
        home: s.home,
        homeGoals: formatNumber(words.locale, s.score.home),
        away: s.away,
        awayGoals: formatNumber(words.locale, s.score.away),
      });
}

/** What to say when `before` became `after`; nothing when nothing worth saying changed. */
export function describeChange(
  before: Snapshot | undefined,
  after: Snapshot,
  words: AnnounceWords,
): string[] {
  const said: string[] = [];
  if (before === undefined) return said;
  const say = (key: AnnounceKey, params: Record<string, string>): void => {
    said.push(fill(words.m[key].text, params));
  };
  const score = (): string => scoreWords(after, words);
  if (before.status !== after.status) {
    const word = STATUS_WORD[after.status];
    if (word !== undefined)
      say('scores.announce.status', { status: words.m[word].text, score: score() });
  }
  if (after.score !== null && before.score !== null) {
    const homeUp = after.score.home > before.score.home;
    const awayUp = after.score.away > before.score.away;
    const down = after.score.home < before.score.home || after.score.away < before.score.away;
    // A score that went down is a correction, not a goal.
    if (down) say('scores.announce.corrected', { score: score() });
    else {
      if (homeUp) say('scores.announce.goal', { team: after.home, score: score() });
      if (awayUp) say('scores.announce.goal', { team: after.away, score: score() });
    }
  }
  if (after.redCards.home > before.redCards.home)
    say('scores.announce.redCard', { team: after.home });
  if (after.redCards.away > before.redCards.away)
    say('scores.announce.redCard', { team: after.away });
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
export function scoresAnnouncements(
  before: ScoresResponse,
  after: ScoresResponse,
  words: AnnounceWords,
): string[] {
  const previous = new Map(cardsOf(before).map((c) => [c.id, fromCard(c)]));
  return cardsOf(after).flatMap((card) =>
    describeChange(previous.get(card.id), fromCard(card), words),
  );
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
export function matchAnnouncements(
  before: MatchCentre,
  after: MatchCentre,
  words: AnnounceWords,
): string[] {
  return describeChange(fromCentre(before), fromCentre(after), words);
}
