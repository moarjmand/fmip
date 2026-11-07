import {
  ACCURACY_MINIMUM_MATCHES,
  type AdminAccuracySeries,
  type ConsoleModelCalibrationBand,
  type ConsoleModelCandidate,
  type ConsoleModelComparison,
  type ConsoleModelCompetition,
  type ConsoleModelEstimate,
  type ConsoleModelInputState,
  type ConsoleModelPairFigures,
  type ConsoleModelRecord,
  type ConsoleModelReport,
  type ConsoleModelVersion,
  type ConsoleModelVersionState,
} from '@fmip/contracts';
import { CONSOLE_MODEL_PAIRED_MINIMUM } from '@fmip/contracts/console';
import type {
  CalibrationRow,
  ModelInputRow,
  ModelRecordRow,
  PairedRow,
  VersionCalibrationRow,
  VersionCountsRow,
  VersionKey,
  VersionPairRow,
  VersionRecordRow,
} from './evaluation-store';
import { ACCURACY_REFERENCE, accuracyCoverage } from './model-accuracy';

/**
 * The console's model page (T-1729, D-355; every version, T-1752, D-371), as
 * pure arithmetic over the rows `PostgresEvaluationStore` reads. The
 * intervals are the model watch's
 * (`.claude/skills/model-watch/model-watch.sql`): normal for a mean score,
 * and for a share the Wilson interval, which stays inside 0..1 on a small
 * band. Nothing here judges a version, and a version in shadow now is
 * compared by count alone, whatever the count has reached: D-336's one look
 * (T-1720) is the weekly watch's, and its verdict is the ledger's (D-371).
 */

const Z = 1.96;
const DAY_MS = 86_400_000;

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/** A mean and its normal 95% interval; no bounds below two matches. */
export function normalEstimate(
  mean: number,
  sd: number | null,
  n: number,
  digits = 6,
): ConsoleModelEstimate {
  if (n < 2 || sd === null) return { mean: round(mean, digits), low: null, high: null };
  const half = (Z * sd) / Math.sqrt(n);
  return {
    mean: round(mean, digits),
    low: round(mean - half, digits),
    high: round(mean + half, digits),
  };
}

/** A share of `n` and its Wilson 95% interval; no bounds below two. */
export function wilsonEstimate(successes: number, n: number, digits = 4): ConsoleModelEstimate {
  const p = successes / n;
  if (n < 2) return { mean: round(p, digits), low: null, high: null };
  const z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return {
    mean: round(p, digits),
    low: round(Math.max(0, centre - half), digits),
    high: round(Math.min(1, centre + half), digits),
  };
}

export function modelRecord(row: ModelRecordRow | undefined): ConsoleModelRecord {
  const n = row?.matches ?? 0;
  if (row === undefined || n === 0) {
    return {
      matches: 0,
      coverage: accuracyCoverage(0),
      log_loss: null,
      brier: null,
      rps: null,
      uniform_rps: null,
      accuracy: null,
      first_kickoff_at: null,
      last_kickoff_at: null,
      limited: null,
      median_lead_hours: null,
    };
  }
  return {
    matches: n,
    coverage: accuracyCoverage(n),
    log_loss: row.logLoss === null ? null : normalEstimate(row.logLoss, row.logLossSd, n),
    brier: row.brier === null ? null : normalEstimate(row.brier, row.brierSd, n),
    rps: row.rps === null ? null : normalEstimate(row.rps, row.rpsSd, n),
    uniform_rps: row.uniformRps === null ? null : round(row.uniformRps, 6),
    accuracy: wilsonEstimate(row.correct, n),
    first_kickoff_at: row.firstKickoffAt?.toISOString() ?? null,
    last_kickoff_at: row.lastKickoffAt?.toISOString() ?? null,
    limited: row.limited,
    median_lead_hours: row.medianLeadHours === null ? null : round(row.medianLeadHours, 2),
  };
}

export function calibrationBands(rows: readonly CalibrationRow[]): ConsoleModelCalibrationBand[] {
  const order = { home: 0, draw: 1, away: 2 } as const;
  return rows
    .filter((row) => row.forecasts > 0)
    .map((row) => ({
      outcome: row.outcome,
      band: row.band,
      forecasts: row.forecasts,
      said: round(row.said, 4),
      seen: wilsonEstimate(row.seen, row.forecasts),
    }))
    .sort((a, b) => order[a.outcome] - order[b.outcome] || a.band - b.band);
}

/**
 * Competitions best first by log loss; those under the minimum (their
 * figures rest on too few matches to rank) after, by name.
 */
export function competitionRecords(rows: readonly ModelRecordRow[]): ConsoleModelCompetition[] {
  const out = rows
    .filter((row) => row.competition !== null)
    .map((row) => ({
      competition: row.competition as { id: string; name: string },
      record: modelRecord(row),
    }));
  const ranked = (c: ConsoleModelCompetition) =>
    c.record.matches >= ACCURACY_MINIMUM_MATCHES && c.record.log_loss !== null;
  return [
    ...out
      .filter(ranked)
      .sort(
        (a, b) =>
          (a.record.log_loss?.mean ?? 0) - (b.record.log_loss?.mean ?? 0) ||
          a.competition.name.localeCompare(b.competition.name),
      ),
    ...out
      .filter((c) => !ranked(c))
      .sort((a, b) => a.competition.name.localeCompare(b.competition.name)),
  ];
}

/**
 * A version in shadow now, per competition: the count and the window, by
 * name, and no figure. Its new divisions' rows would add up to the figure
 * D-336 judges once ("better than chance where it is new").
 */
export function competitionCounts(rows: readonly ModelRecordRow[]): ConsoleModelCompetition[] {
  return rows
    .filter((row) => row.competition !== null)
    .map((row) => ({
      competition: row.competition as { id: string; name: string },
      record: {
        ...modelRecord(row),
        log_loss: null,
        brier: null,
        rps: null,
        uniform_rps: null,
        accuracy: null,
      },
    }))
    .sort((a, b) => a.competition.name.localeCompare(b.competition.name));
}

// --- Every version (T-1752) --------------------------------------------------------

const same = (a: VersionKey, b: VersionKey): boolean =>
  a.role === b.role && a.modelVersion === b.modelVersion;

const STATE_ORDER: Record<ConsoleModelVersionState, number> = {
  published_now: 0,
  shadow_now: 1,
  earlier: 2,
};

export interface VersionsInput {
  /** The version on the site now; null when nothing is published. */
  published: string | null;
  /** The versions in shadow now, by name. */
  shadow: readonly string[];
  counts: readonly VersionCountsRow[];
  records: readonly VersionRecordRow[];
  calibration: readonly VersionCalibrationRow[];
  /** The console's weekly accuracy series (T-1369), every version and role. */
  trends: readonly AdminAccuracySeries[];
}

/**
 * What a version is now. A shadow version is being judged when the model
 * service runs it, and also -- from the stored forecasts alone, so a silent
 * or forgetful service never turns a candidate into history and lets its
 * figures out (D-371, review rev-2026-11-07-01) -- when it was never
 * published and stored a shadow forecast after the version on the site
 * started: it ran beside it, and its verdict is the weekly watch's.
 */
export function versionState(key: VersionKey, input: VersionsInput): ConsoleModelVersionState {
  if (key.role === 'published') {
    return key.modelVersion === input.published ? 'published_now' : 'earlier';
  }
  if (input.shadow.includes(key.modelVersion)) return 'shadow_now';
  return beingJudged(input.counts, input.published).has(key.modelVersion)
    ? 'shadow_now'
    : 'earlier';
}

/**
 * The shadow versions being judged, from the stored forecasts alone
 * (D-371, T-1771): never published, and storing a shadow forecast after the
 * version on the site started -- or, with none on the site, storing any.
 * The console's page and the admin accuracy report both withhold their
 * figures by it, so neither shows what the weekly watch judges once.
 */
export function beingJudged(
  counts: readonly VersionCountsRow[],
  published: string | null,
): Set<string> {
  const site =
    published === null
      ? undefined
      : counts.find((row) => row.role === 'published' && row.modelVersion === published);
  const out = new Set<string>();
  for (const row of counts) {
    if (row.role !== 'shadow' || row.last === null) continue;
    if (counts.some((o) => o.role === 'published' && o.modelVersion === row.modelVersion)) continue;
    if (site === undefined || site.first === null || row.last.getTime() >= site.first.getTime()) {
      out.add(row.modelVersion);
    }
  }
  return out;
}

/**
 * A record with its figures withheld (T-1771): its sample, window, limited
 * share and lead time stay; every score and share is null until the weekly
 * watch has judged the version and it is published or set aside.
 */
export function withheldRecord(record: ConsoleModelRecord): ConsoleModelRecord {
  return { ...record, log_loss: null, brier: null, rps: null, uniform_rps: null, accuracy: null };
}

/**
 * Every version in every role it stored a forecast in: the one on the site,
 * then those in shadow now, then the earlier ones, newest first.
 */
export function versionRecords(input: VersionsInput): ConsoleModelVersion[] {
  return input.counts
    .map((count): ConsoleModelVersion => {
      const own = input.records.filter((row) => same(row, count));
      const state = versionState(count, input);
      return {
        model_version: count.modelVersion,
        role: count.role,
        state,
        first_forecast_at: count.first?.toISOString() ?? null,
        last_forecast_at: count.last?.toISOString() ?? null,
        counts: {
          forecasts: count.forecasts,
          evaluated: count.evaluated,
          awaiting: count.awaiting,
          after_kickoff: count.afterKickoff,
          unavailable: count.unavailable,
        },
        // A version being judged gives counts only, everywhere (T-1771): its
        // own record and trend would let its conditions be read before the
        // weekly watch's one look.
        record:
          state === 'shadow_now'
            ? withheldRecord(modelRecord(own.find((row) => row.competition === null)))
            : modelRecord(own.find((row) => row.competition === null)),
        calibration:
          state === 'shadow_now'
            ? []
            : calibrationBands(input.calibration.filter((row) => same(row, count))),
        trend: (
          input.trends.find(
            (s) =>
              s.role === count.role &&
              s.model_version === count.modelVersion &&
              s.competition === null,
          )?.points ?? []
        ).map((p) =>
          state === 'shadow_now'
            ? { ...p, log_loss: null, brier: null, rps: null, accuracy: null, uniform_rps: null }
            : p,
        ),
        withheld: state === 'shadow_now',
        competitions: state === 'shadow_now' ? competitionCounts(own) : competitionRecords(own),
      };
    })
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        (b.last_forecast_at ?? '').localeCompare(a.last_forecast_at ?? '') ||
        a.model_version.localeCompare(b.model_version) ||
        a.role.localeCompare(b.role),
    );
}

/** One side's means on the shared matches. */
const side = (logLoss: number, brier: number, rps: number, correct: number, n: number) => ({
  log_loss: round(logLoss, 6),
  brier: round(brier, 6),
  rps: round(rps, 6),
  accuracy: round(correct / n, 4),
});

/** A pair's figures with `a` as the subject, or with `b` (the difference turned round). */
function pairFigures(row: VersionPairRow, subjectIsA: boolean): ConsoleModelPairFigures {
  const a = side(row.aLogLoss, row.aBrier, row.aRps, row.aCorrect, row.matches);
  const b = side(row.bLogLoss, row.bBrier, row.bRps, row.bCorrect, row.matches);
  return {
    subject: subjectIsA ? a : b,
    reference: subjectIsA ? b : a,
    difference: normalEstimate(
      subjectIsA ? row.difference : -row.difference,
      row.differenceSd,
      row.matches,
    ),
  };
}

/**
 * Which side a comparison is about: a version in shadow now; else the one
 * that started later (the newer version against the one before it); and
 * where both started within a day, the shadow side, the candidate of its day.
 */
function subjectIsA(row: VersionPairRow, input: VersionsInput): boolean {
  const aNow = versionState(row.a, input) === 'shadow_now';
  const bNow = versionState(row.b, input) === 'shadow_now';
  if (aNow !== bNow) return aNow;
  const first = (key: VersionKey) =>
    input.counts.find((count) => same(count, key))?.first?.getTime() ?? 0;
  const later = first(row.a) - first(row.b);
  if (Math.abs(later) > DAY_MS) return later > 0;
  if (row.a.role !== row.b.role) return row.a.role === 'shadow';
  return later >= 0;
}

/**
 * Every two versions that scored the same matches. A pair with a version in
 * shadow now is `judging`: the counts alone, overall and per competition,
 * whatever they have reached (D-082, D-139, D-336's one look; D-371). Any
 * other pair is a record of versions whose verdict was taken long ago, and
 * gives its figures from the page's minimum (30) on, as every other small
 * sample does.
 */
export function versionComparisons(
  pairs: readonly VersionPairRow[],
  input: VersionsInput,
): ConsoleModelComparison[] {
  const overall = pairs.filter((row) => row.competition === null);
  return overall
    .map((row): ConsoleModelComparison => {
      const fromA = subjectIsA(row, input);
      const judging =
        versionState(row.a, input) === 'shadow_now' || versionState(row.b, input) === 'shadow_now';
      const minimum = judging ? CONSOLE_MODEL_PAIRED_MINIMUM : ACCURACY_MINIMUM_MATCHES;
      const shown = !judging && row.matches >= minimum;
      const subject = fromA ? row.a : row.b;
      const reference = fromA ? row.b : row.a;
      return {
        subject: { model_version: subject.modelVersion, role: subject.role },
        reference: { model_version: reference.modelVersion, role: reference.role },
        kind: judging ? 'judging' : 'record',
        matches: row.matches,
        identical: row.identical,
        minimum,
        figures: shown ? pairFigures(row, fromA) : null,
        competitions: pairs
          .filter(
            (other) => other.competition !== null && same(other.a, row.a) && same(other.b, row.b),
          )
          .map((other) => ({
            competition: other.competition as { id: string; name: string },
            matches: other.matches,
            identical: other.identical,
            figures:
              shown && other.matches >= ACCURACY_MINIMUM_MATCHES ? pairFigures(other, fromA) : null,
          }))
          .sort(
            (a, b) => b.matches - a.matches || a.competition.name.localeCompare(b.competition.name),
          ),
      };
    })
    .sort(
      (a, b) =>
        (a.kind === 'judging' ? 0 : 1) - (b.kind === 'judging' ? 0 : 1) ||
        b.matches - a.matches ||
        a.subject.model_version.localeCompare(b.subject.model_version),
    );
}

const NO_PAIRS: PairedRow = {
  matches: 0,
  identical: 0,
  publishedLogLoss: null,
  candidateLogLoss: null,
  publishedBrier: null,
  candidateBrier: null,
  difference: null,
  differenceSd: null,
};

/** A shadow version against the published one, from the pairs of every version. */
export function pairedOf(
  pairs: readonly VersionPairRow[],
  candidate: string,
  published: string | null,
): PairedRow {
  if (published === null) return NO_PAIRS;
  const shadow: VersionKey = { role: 'shadow', modelVersion: candidate };
  const site: VersionKey = { role: 'published', modelVersion: published };
  for (const row of pairs) {
    if (row.competition !== null) continue;
    const forward = same(row.a, shadow) && same(row.b, site);
    const backward = same(row.b, shadow) && same(row.a, site);
    if (!forward && !backward) continue;
    return {
      matches: row.matches,
      identical: row.identical,
      publishedLogLoss: forward ? row.bLogLoss : row.aLogLoss,
      candidateLogLoss: forward ? row.aLogLoss : row.bLogLoss,
      publishedBrier: forward ? row.bBrier : row.aBrier,
      candidateBrier: forward ? row.aBrier : row.bBrier,
      difference: forward ? row.difference : -row.difference,
      differenceSd: row.differenceSd,
    };
  }
  return NO_PAIRS;
}

export interface CandidateInput {
  modelVersion: string;
  inService: boolean | null;
  span: { first: Date | null; last: Date | null };
  own: ModelRecordRow | undefined;
  /** Being judged: its own record is counts only (T-1771). */
  withheld?: boolean;
  paired: Pick<PairedRow, 'matches' | 'identical'>;
  newDivisions: Pick<ModelRecordRow, 'matches'>;
}

/**
 * One shadow version: its own record, and the counts toward its promotion
 * conditions. Never the conditions' figures (D-336's one look, D-371).
 */
export function candidateRecord(input: CandidateInput): ConsoleModelCandidate {
  return {
    model_version: input.modelVersion,
    in_service: input.inService,
    first_forecast_at: input.span.first?.toISOString() ?? null,
    last_forecast_at: input.span.last?.toISOString() ?? null,
    own: input.withheld === true ? withheldRecord(modelRecord(input.own)) : modelRecord(input.own),
    paired: { matches: input.paired.matches, identical: input.paired.identical },
    new_divisions: { matches: input.newDivisions.matches },
  };
}

// --- The inputs' data (T-1752) -----------------------------------------------------

/**
 * How old an input's newest row may be before the page calls it delayed
 * (rule 4): results arrive after each round, our Elo is computed nightly,
 * and the match data follows each match day.
 */
const FRESH_DAYS: Record<ModelInputRow['key'], number> = {
  results: 10,
  cross_league: 21,
  own_elo: 3,
  expected_goals: 7,
  lineups: 7,
  absences: 7,
};

/** A share of the finished matches is whole from here on; below it the input is partial. */
const WHOLE_SHARE = 0.9;

/**
 * One input's state, counted and never estimated (rule 3): `not_supplied`
 * with nothing stored, `delayed` when its newest row is older than the input
 * is refreshed, `limited` when it covers only part of what it is a share of,
 * else `available`.
 */
export function inputState(row: ModelInputRow, now: Date): ConsoleModelInputState {
  const age = row.newestAt === null ? null : (now.getTime() - row.newestAt.getTime()) / DAY_MS;
  const partial = row.of !== null && row.of > 0 && row.count / row.of < WHOLE_SHARE;
  // The fit's window is a part of the whole store by design, not a gap in it;
  // what is partial about the results is the leagues whose newest one is late.
  const share =
    row.key === 'results' || row.key === 'cross_league' ? (row.lateGroups ?? 0) > 0 : partial;
  return {
    key: row.key,
    coverage:
      row.count === 0 || age === null
        ? 'not_supplied'
        : age > FRESH_DAYS[row.key]
          ? 'delayed'
          : share
            ? 'limited'
            : 'available',
    count: row.count,
    of: row.of,
    groups: row.groups,
    late_groups: row.lateGroups ?? null,
    newest_at: row.newestAt?.toISOString() ?? null,
  };
}

export interface ReportInput extends VersionsInput {
  service: 'answered' | 'unreachable';
  /** Whether the model service lists each shadow version; null when it did not answer. */
  inService: (modelVersion: string) => boolean | null;
  /** How many matches each shadow version scored that no published version forecast. */
  newDivisions: ReadonlyMap<string, number>;
  pairs: readonly VersionPairRow[];
  /** What the published version's record does not cover; null when not counted. */
  unscored: { finished: number; without: number } | null;
  inputs: readonly ConsoleModelInputState[];
  now: Date;
}

export function consoleModelReport(input: ReportInput): ConsoleModelReport {
  const versions = versionRecords(input);
  const site = versions.find((v) => v.state === 'published_now');
  const overall = input.records.filter((row) => row.competition === null);
  const lastEvaluated = overall.reduce<Date | null>(
    (last, row) =>
      row.lastEvaluatedAt !== null && (last === null || row.lastEvaluatedAt > last)
        ? row.lastEvaluatedAt
        : last,
    null,
  );
  return {
    service: input.service,
    published:
      input.published === null
        ? null
        : {
            model_version: input.published,
            since: site?.first_forecast_at ?? null,
            record: site?.record ?? modelRecord(undefined),
            unscored: input.unscored,
          },
    reference: ACCURACY_REFERENCE,
    minimum_matches: ACCURACY_MINIMUM_MATCHES,
    versions,
    comparisons: versionComparisons(input.pairs, input),
    // Every version being judged, whether the service named it or the store says so.
    candidates: versions
      .filter((v) => v.state === 'shadow_now')
      .map((v) => v.model_version)
      .concat(input.shadow.filter((id) => !versions.some((v) => v.model_version === id)))
      .map((modelVersion) => {
        const key: VersionKey = { role: 'shadow', modelVersion };
        const count = input.counts.find((row) => same(row, key));
        return candidateRecord({
          modelVersion,
          inService: input.inService(modelVersion),
          span: { first: count?.first ?? null, last: count?.last ?? null },
          own: overall.find((row) => same(row, key)),
          withheld: true,
          paired: pairedOf(input.pairs, modelVersion, input.published),
          newDivisions: { matches: input.newDivisions.get(modelVersion) ?? 0 },
        });
      }),
    inputs: [...input.inputs],
    last_updated_at: lastEvaluated?.toISOString() ?? null,
    generated_at: input.now.toISOString(),
  };
}
