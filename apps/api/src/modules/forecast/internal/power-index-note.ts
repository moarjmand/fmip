import type { PowerIndexNote, PowerIndexNoteCode } from '@fmip/contracts';

/**
 * A Power Index component's note in our words (T-1602).
 *
 * The measures write each note as an English sentence (`power-index-measure.ts`,
 * `power-index-squad.ts`), and the stored indexes keep it: a stored index is
 * never rewritten. The sentences are this module's own templates, so each one
 * reads back to a code and the numbers in it, for a page to say in the
 * reader's language -- every stored row included, with no backfill. A note
 * none of these patterns reads is `null`, and the page says nothing in its
 * place rather than the English.
 */
const PATTERNS: readonly [RegExp, PowerIndexNoteCode, readonly string[]][] = [
  [
    /^(\d+) days since the previous match, (\d+) in the last (\d+); travel not modelled$/,
    'rest_days',
    ['days', 'matches', 'window'],
  ],
  [/^not modelled: needs the stakes of this stage/, 'context_not_modelled', []],
  [/^last (\d+) matches, adjusted for opponent strength$/, 'form_window', ['matches']],
  [/^(home|away) record over the last (\d+) matches$/, 'venue_record', ['side', 'matches']],
  [/^no (home|away) matches in the window$/, 'no_venue_matches', ['side']],
  [/^no matches in the recent window$/, 'no_recent_matches', []],
  [/^only (\d+) matches of history$/, 'thin_history', ['matches']],
  [
    /^only (\d+) teams in this division have enough history to rank against$/,
    'few_ranked_teams',
    ['teams'],
  ],
  [/^no recorded matches for .+ in this division$/, 'no_recorded_matches', []],
  [/^no previous fixture on record/, 'no_previous_fixture', []],
  [/^the announced starting XI/, 'announced_xi', []],
  [/^expected: the last starting XI less (\d+) reported out/, 'expected_xi_less_out', ['out']],
  [/^expected: the last starting XI/, 'expected_xi', []],
  [/^fewer than (\d+) of the line-up have a rating/, 'few_rated_starters', ['min']],
  [/^no line-up recorded for this team yet/, 'no_lineup', []],
  [/^too few teams in this competition have a measurable line-up/, 'few_measurable_lineups', []],
  [/^the coach.s run this season and how much of the XI carries over$/, 'coach_and_xi', []],
  [/^the coach.s run this season only$/, 'coach_only', []],
  [/^how much of the XI carries over only$/, 'xi_only', []],
  [/^too few line-ups recorded this season/, 'few_lineups', []],
  [/^no player ratings on the free data/, 'no_ratings_feed', []],
  [/^no manager or squad-stability feed/, 'no_stability_feed', []],
];

export function explainNote(note: string | null | undefined): PowerIndexNote | null {
  if (typeof note !== 'string') return null;
  for (const [pattern, code, names] of PATTERNS) {
    const match = pattern.exec(note);
    if (match === null) continue;
    const values: Record<string, number | string> = {};
    names.forEach((name, i) => {
      const raw = match[i + 1] ?? '';
      values[name] = /^\d+$/.test(raw) ? Number(raw) : raw;
    });
    return { code, values };
  }
  return null;
}
