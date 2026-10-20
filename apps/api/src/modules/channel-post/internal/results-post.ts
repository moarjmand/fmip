import type { MatchOutcome, ModelProbabilities, ScoresGroup } from '@fmip/contracts';
import type { CountedEvaluation } from '../../forecast/evaluation.service';
import { type DailyPost, dayLabel, matchUrl, percentages } from './daily-post';
import { MAX_MESSAGE_LENGTH, packMessages } from './pack';

/**
 * The previous day's results against the statistical model (T-1430, D-222),
 * as text. Pure.
 *
 * Each finished match carries the forecast the site's accuracy figures count
 * for it -- the last published version computed before kick-off (D-209) --
 * and the stored evaluation of that forecast: whether the model's most likely
 * outcome happened is the evaluation's own `correct`, never worked out again
 * here (rule 5). The score shown beside a scored forecast is the one it was
 * scored against. Only the statistical model is read, and every message says
 * so (rule 6). A match the model did not forecast says that (rule 3); one
 * whose forecast is not scored yet says that, and neither is counted.
 */

export type ResultVerdict =
  | {
      kind: 'scored';
      /** Percentages to one decimal, totalling exactly 100. */
      percentages: ModelProbabilities;
      /** The outcome(s) the model gave the most probability; two only on a tie. */
      pick: MatchOutcome[];
      /** The stored evaluation's verdict. */
      correct: boolean;
      modelVersion: string;
    }
  /** An available forecast before kick-off, not evaluated yet. */
  | { kind: 'pending' }
  /** No available published forecast before kick-off. */
  | { kind: 'none' };

export interface ResultMatch {
  fixtureId: string;
  home: string;
  away: string;
  score: { home: number; away: number };
  verdict: ResultVerdict;
}

export interface ResultCompetition {
  title: string;
  matches: ResultMatch[];
}

const OUTCOMES: MatchOutcome[] = ['home', 'draw', 'away'];

function pickOf(p: ModelProbabilities): MatchOutcome[] {
  const top = Math.max(p.home, p.draw, p.away);
  return OUTCOMES.filter((o) => p[o] === top);
}

/**
 * The day's finished matches, in the product's order (the guest's scores
 * list for the day, T-504), each with the model's counted evaluation. Kept: a
 * finished match in a season whose scores are not declared unsupplied, with a
 * full-time score on record. A match with no score to show is left out
 * rather than given one.
 */
export function selectResults(
  groups: ScoresGroup[],
  counted: ReadonlyMap<string, CountedEvaluation>,
): ResultCompetition[] {
  const competitions: ResultCompetition[] = [];
  for (const group of groups) {
    const matches: ResultMatch[] = [];
    for (const card of group.fixtures) {
      if (card.status !== 'finished' || card.coverage === 'not_supplied') continue;
      const entry = counted.get(card.id);
      const evaluation = entry?.evaluation ?? null;
      const score = evaluation?.actual ?? card.scores.full_time;
      if (score === null) continue;
      matches.push({
        fixtureId: card.id,
        home: card.home.name,
        away: card.away.name,
        score: { home: score.home, away: score.away },
        verdict:
          evaluation !== null
            ? {
                kind: 'scored',
                percentages: percentages(evaluation.probabilities),
                pick: pickOf(evaluation.probabilities),
                correct: evaluation.correct,
                modelVersion: evaluation.model_version,
              }
            : entry?.hasForecast === true
              ? { kind: 'pending' }
              : { kind: 'none' },
      });
    }
    if (matches.length === 0) continue;
    competitions.push({
      title:
        group.country === null
          ? group.competition.name
          : `${group.country.name} · ${group.competition.name}`,
      matches,
    });
  }
  return competitions;
}

/** Matches whose forecast is waiting for its evaluation. */
export function pendingCount(competitions: ResultCompetition[]): number {
  return competitions.flatMap((c) => c.matches).filter((m) => m.verdict.kind === 'pending').length;
}

function header(
  day: string,
  versions: string[],
  scored: number,
  right: number,
  pending: number,
  part: number,
  total: number,
): string {
  const title =
    `FMIP · The statistical model's results · ${dayLabel(day)}` +
    (total > 1 ? ` (${part}/${total})` : '');
  const named =
    versions.length === 0
      ? ''
      : ` (${versions.join(', ')}${versions.length > 1 ? '; each line names its version' : ''})`;
  const source = `The day's finished matches against the statistical model's last forecast before kick-off${named}. Full-time scores; the day is the UTC day.`;
  const tally =
    scored === 0
      ? "None of the model's forecasts is scored yet."
      : `The model's most likely outcome happened in ${right} of ${scored} ${scored === 1 ? 'match' : 'matches'}.`;
  const waiting =
    pending === 0
      ? ''
      : ` ${pending} more ${pending === 1 ? 'is' : 'are'} not scored yet and not counted.`;
  return `${title}\n${source}\n${tally}${waiting}`;
}

function outcomeName(match: ResultMatch, outcome: MatchOutcome): string {
  return outcome === 'home' ? match.home : outcome === 'away' ? match.away : 'Draw';
}

function matchText(match: ResultMatch, origin: string, nameVersion: boolean): string {
  const v = match.verdict;
  const result = `${match.home} ${match.score.home}-${match.score.away} ${match.away}`;
  const lines =
    v.kind === 'scored'
      ? [
          `Model: ${match.home} ${v.percentages.home}% · Draw ${v.percentages.draw}% · ${match.away} ${v.percentages.away}%` +
            (nameVersion ? ` · ${v.modelVersion}` : ''),
          `Model's pick: ${v.pick.map((o) => outcomeName(match, o)).join(' or ')} · ${v.correct ? 'right' : 'wrong'}`,
        ]
      : v.kind === 'pending'
        ? ["The model's forecast is not scored yet"]
        : ['No forecast from the statistical model before kick-off'];
  return [result, ...lines, matchUrl(origin, match.fixtureId)].join('\n');
}

/**
 * The day's results post, split at competition boundaries under `limit`, or
 * null when there is nothing to recap: no finished match, or none the model
 * forecast. `forecasts` counts the scored matches, `fixtures` the listed ones.
 */
export function composeResultsPost(
  day: string,
  competitions: ResultCompetition[],
  origin: string,
  limit = MAX_MESSAGE_LENGTH,
): DailyPost | null {
  const matches = competitions.flatMap((c) => c.matches);
  const scored = matches.flatMap((m) => (m.verdict.kind === 'scored' ? [m.verdict] : []));
  const pending = pendingCount(competitions);
  if (scored.length + pending === 0) return null;

  const right = scored.filter((v) => v.correct).length;
  const versions = [...new Set(scored.map((v) => v.modelVersion))].sort();
  const nameVersion = versions.length > 1;
  return {
    day,
    messages: packMessages(
      competitions.map((competition) => ({
        title: competition.title,
        blocks: competition.matches.map((m) => matchText(m, origin, nameVersion)),
      })),
      (part, total) => header(day, versions, scored.length, right, pending, part, total),
      limit,
    ),
    fixtures: matches.length,
    forecasts: scored.length,
    modelVersions: versions,
  };
}
