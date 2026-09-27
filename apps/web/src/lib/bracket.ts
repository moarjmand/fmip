import type { KnockoutLeg, KnockoutRound, KnockoutRoundKey, KnockoutTie } from '@fmip/contracts';

/**
 * The knockout bracket's words (T-630). Pure, so what a reader is told about
 * a tie — and above all what they are not told while it is undecided — is
 * one tested place.
 */

export const ROUND_LABEL: Record<KnockoutRoundKey, string> = {
  round_of_32: 'Round of 32',
  knockout_playoff: 'Knockout play-offs',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-finals',
  semi_final: 'Semi-finals',
  final: 'Final',
};

const teamName = (t: { name: string; short_name: string | null }) => t.short_name ?? t.name;

/** "ALP 2–1 BET", "ALP 1–1 BET (aet, 4–3 pens)", or "ALP v BET" before kick-off. */
export function legLine(leg: KnockoutLeg): string {
  const home = teamName(leg.home);
  const away = teamName(leg.away);
  if (leg.score === null) return `${home} v ${away}`;
  const extras: string[] = [];
  if (leg.after_extra_time) extras.push('aet');
  if (leg.penalties !== null) extras.push(`${leg.penalties.home}–${leg.penalties.away} pens`);
  const suffix = extras.length === 0 ? '' : ` (${extras.join(', ')})`;
  return `${home} ${leg.score.home}–${leg.score.away} ${away}${suffix}`;
}

/** "Leg 1", or "Match" for a single-match round. */
export function legLabel(leg: KnockoutLeg, legs: 1 | 2): string {
  return legs === 1 ? 'Match' : `Leg ${leg.leg}`;
}

/**
 * The tie's outcome line. Names a winner only when the API decided one; a
 * tie still being played, or one our records cannot settle, says so.
 */
export function tieOutcome(tie: KnockoutTie, legs: 1 | 2): string {
  const [a, b] = tie.teams;
  const aggregate =
    tie.aggregate === null
      ? ''
      : `${teamName(a)} ${tie.aggregate[0]}–${tie.aggregate[1]} ${teamName(b)} on aggregate`;
  if (tie.winner !== null) {
    const how =
      tie.decided_by === 'penalties'
        ? 'on penalties'
        : tie.decided_by === 'aggregate'
          ? 'on aggregate'
          : '';
    const through = `${tie.winner.name} ${legs === 1 ? 'win' : 'go through'}${how === '' ? '' : ` ${how}`}`;
    return aggregate === '' ? through : `${aggregate} · ${through}`;
  }
  if (aggregate !== '') return `${aggregate} · not decided in our records`;
  return 'Still to be decided';
}

/** What a round says about the ties it does not hold; null when it holds them all. */
export function roundNote(round: KnockoutRound): string | null {
  if (round.state === 'not_drawn') return 'Not drawn yet.';
  if (round.state === 'not_supplied') return 'Not supplied: our records hold none of its matches.';
  const missing = round.expected_ties - round.ties.length;
  if (missing <= 0) return null;
  return `${missing} more ${missing === 1 ? 'tie' : 'ties'} not in our records yet.`;
}
