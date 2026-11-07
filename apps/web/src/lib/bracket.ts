import type {
  KnockoutBracket,
  KnockoutLeg,
  KnockoutRound,
  KnockoutRoundKey,
  KnockoutTie,
} from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, plural, t, type MessageKey } from '@/i18n/messages';

/**
 * The knockout bracket's words (T-630). Pure, so what a reader is told about
 * a tie — and above all what they are not told while it is undecided — is
 * one tested place. In the reader's language (T-1309); `locale` defaults to
 * English. Server only: it reads the catalogues.
 */

/** The stage names `stageLabel` uses, so a round reads the same here as on a score card (T-1343). */
const ROUND_KEY: Record<KnockoutRoundKey, MessageKey> = {
  round_of_32: 'stage.name.roundOf32',
  knockout_playoff: 'stage.name.knockoutPlayOffs',
  round_of_16: 'stage.name.roundOf16',
  quarter_final: 'stage.name.quarterFinals',
  semi_final: 'stage.name.semiFinals',
  final: 'stage.name.final',
};

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/** The round's name: "Round of 16", "Final". */
export function roundLabel(key: KnockoutRoundKey, locale = 'en'): string {
  return t(asLocale(locale), ROUND_KEY[key]);
}

const teamName = (team: { name: string; short_name: string | null }) =>
  team.short_name ?? team.name;

/** "2–1", in the locale's digits. */
const scoreOf = (l: Locale, home: number, away: number): string =>
  `${formatNumber(l, home)}–${formatNumber(l, away)}`;

/** "ALP 2–1 BET", "ALP 1–1 BET (aet, 4–3 pens)", or "ALP v BET" before kick-off. */
export function legLine(leg: KnockoutLeg, locale = 'en'): string {
  const l = asLocale(locale);
  const home = teamName(leg.home);
  const away = teamName(leg.away);
  if (leg.score === null) return interpolate(t(l, 'bracket.line.versus'), { home, away });
  const line = interpolate(t(l, 'bracket.line.score'), {
    home,
    score: scoreOf(l, leg.score.home, leg.score.away),
    away,
  });
  const pens = leg.penalties === null ? null : scoreOf(l, leg.penalties.home, leg.penalties.away);
  if (leg.after_extra_time && pens !== null) {
    return interpolate(t(l, 'bracket.line.aetPens'), { line, pens });
  }
  if (leg.after_extra_time) return interpolate(t(l, 'bracket.line.aet'), { line });
  if (pens !== null) return interpolate(t(l, 'bracket.line.pens'), { line, pens });
  return line;
}

/** "Leg 1", or "Match" for a single-match round. */
export function legLabel(leg: KnockoutLeg, legs: 1 | 2, locale = 'en'): string {
  const l = asLocale(locale);
  return legs === 1
    ? t(l, 'bracket.leg.match')
    : interpolate(t(l, 'scores.card.leg'), { leg: formatNumber(l, leg.leg) });
}

/**
 * The tie's outcome line. Names a winner only when the API decided one; a
 * tie still being played, or one our records cannot settle, says so.
 */
export function tieOutcome(tie: KnockoutTie, legs: 1 | 2, locale = 'en'): string {
  const l = asLocale(locale);
  const [a, b] = tie.teams;
  const aggregate =
    tie.aggregate === null
      ? ''
      : interpolate(t(l, 'bracket.outcome.aggregate'), {
          home: teamName(a),
          score: scoreOf(l, tie.aggregate[0], tie.aggregate[1]),
          away: teamName(b),
        });
  if (tie.winner !== null) {
    const key: MessageKey =
      legs === 1
        ? tie.decided_by === 'penalties'
          ? 'bracket.outcome.winsOnPenalties'
          : tie.decided_by === 'aggregate'
            ? 'bracket.outcome.winsOnAggregate'
            : 'bracket.outcome.wins'
        : tie.decided_by === 'penalties'
          ? 'bracket.outcome.throughOnPenalties'
          : tie.decided_by === 'aggregate'
            ? 'bracket.outcome.throughOnAggregate'
            : 'bracket.outcome.through';
    const through = interpolate(t(l, key), { team: tie.winner.name });
    return aggregate === '' ? through : `${aggregate} · ${through}`;
  }
  if (aggregate !== '') return `${aggregate} · ${t(l, 'bracket.outcome.notDecided')}`;
  return t(l, 'bracket.outcome.toBeDecided');
}

/** A round's chip on a phone (T-1763): "QF", "R16"; in Persian «۱/۴», «۱/۸». */
export function chipLabel(key: KnockoutRoundKey, locale = 'en'): string {
  const chip: Record<KnockoutRoundKey, MessageKey> = {
    round_of_32: 'bracket.chip.round_of_32',
    knockout_playoff: 'bracket.chip.knockout_playoff',
    round_of_16: 'bracket.chip.round_of_16',
    quarter_final: 'bracket.chip.quarter_final',
    semi_final: 'bracket.chip.semi_final',
    final: 'bracket.chip.final',
  };
  return t(asLocale(locale), chip[key]);
}

/**
 * The round a phone opens on (T-1763, D-378's D10): the latest round with a
 * tie drawn, so a finished season lands on its final; null when none is.
 */
export function openingStage(bracket: KnockoutBracket): KnockoutRoundKey | null {
  const drawn = bracket.rounds.filter((r) => r.state === 'drawn' && r.ties.length > 0);
  return drawn[drawn.length - 1]?.key ?? null;
}

/** `?stage=`: one of the bracket's rounds; anything else (or nothing) is null, the opening one. */
export function readStageParam(
  params: Record<string, string | string[] | undefined>,
  bracket: KnockoutBracket | null,
): KnockoutRoundKey | null {
  const raw = (Array.isArray(params.stage) ? params.stage[0] : params.stage) ?? '';
  return bracket?.rounds.find((r) => r.key === raw)?.key ?? null;
}

/**
 * A team's goals in one leg, read from the leg's score as the API sent it
 * (the side it played on that night); null before there is a score. Never a
 * sum: the aggregate is the API's (`KnockoutTie.aggregate`).
 */
export function legGoals(leg: KnockoutLeg, teamId: string): number | null {
  if (leg.score === null) return null;
  return leg.home.id === teamId ? leg.score.home : leg.score.away;
}

/** A team's shoot-out kicks in one leg, the same way; null without a shoot-out. */
export function legPenalties(leg: KnockoutLeg, teamId: string): number | null {
  if (leg.penalties === null) return null;
  return leg.home.id === teamId ? leg.penalties.home : leg.penalties.away;
}

/** What a round says about the ties it does not hold; null when it holds them all. */
export function roundNote(round: KnockoutRound, locale = 'en'): string | null {
  const l = asLocale(locale);
  if (round.state === 'not_drawn') return t(l, 'bracket.note.notDrawn');
  if (round.state === 'not_supplied') return t(l, 'bracket.note.notSupplied');
  const missing = round.expected_ties - round.ties.length;
  if (missing <= 0) return null;
  return plural(l, 'bracket.note.missing', missing).text;
}
