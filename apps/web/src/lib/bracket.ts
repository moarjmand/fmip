import type { KnockoutLeg, KnockoutRound, KnockoutRoundKey, KnockoutTie } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, plural, t, type MessageKey } from '@/i18n/messages';

/**
 * The knockout bracket's words (T-630). Pure, so what a reader is told about
 * a tie — and above all what they are not told while it is undecided — is
 * one tested place. In the reader's language (T-1309); `locale` defaults to
 * English. Server only: it reads the catalogues.
 */

const ROUND_KEY: Record<KnockoutRoundKey, MessageKey> = {
  round_of_32: 'bracket.round.roundOf32',
  knockout_playoff: 'bracket.round.knockoutPlayoff',
  round_of_16: 'bracket.round.roundOf16',
  quarter_final: 'bracket.round.quarterFinal',
  semi_final: 'bracket.round.semiFinal',
  final: 'bracket.round.final',
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

/** What a round says about the ties it does not hold; null when it holds them all. */
export function roundNote(round: KnockoutRound, locale = 'en'): string | null {
  const l = asLocale(locale);
  if (round.state === 'not_drawn') return t(l, 'bracket.note.notDrawn');
  if (round.state === 'not_supplied') return t(l, 'bracket.note.notSupplied');
  const missing = round.expected_ties - round.ties.length;
  if (missing <= 0) return null;
  return plural(l, 'bracket.note.missing', missing).text;
}
