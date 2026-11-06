import { describe, expect, it } from 'vitest';
import {
  type CandidateInput,
  type VersionsInput,
  calibrationBands,
  candidateRecord,
  competitionRecords,
  consoleModelReport,
  inputState,
  modelRecord,
  normalEstimate,
  pairedOf,
  versionComparisons,
  versionRecords,
  wilsonEstimate,
} from './internal/console-model';
import type {
  ModelInputRow,
  ModelRecordRow,
  PairedRow,
  VersionCountsRow,
  VersionPairRow,
  VersionRecordRow,
} from './internal/evaluation-store';

/**
 * The console's model page (T-1729, D-355): the intervals are the model
 * watch's, competitions rank best first with the thin ones after, and a
 * candidate's comparison is a count, whatever it has reached (T-1720, D-371).
 */

const row = (overrides: Partial<ModelRecordRow> = {}): ModelRecordRow => ({
  competition: null,
  matches: 400,
  logLoss: 0.95,
  logLossSd: 0.4,
  brier: 0.56,
  brierSd: 0.3,
  rps: 0.2,
  rpsSd: 0.15,
  uniformRps: 0.2361,
  limited: 198,
  medianLeadHours: 0.4512,
  correct: 232,
  firstKickoffAt: new Date('2026-10-10T12:00:00Z'),
  lastKickoffAt: new Date('2026-11-01T20:00:00Z'),
  lastEvaluatedAt: new Date('2026-11-02T01:00:00Z'),
  ...overrides,
});

const paired = (overrides: Partial<PairedRow> = {}): PairedRow => ({
  matches: 254,
  identical: 247,
  publishedLogLoss: 0.95,
  candidateLogLoss: 0.94998,
  publishedBrier: 0.56,
  candidateBrier: 0.55999,
  difference: -0.00002,
  differenceSd: 0.0009,
  ...overrides,
});

const candidate = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  modelVersion: 'dixon-coles-elo@0.7.0',
  inService: true,
  span: { first: new Date('2026-10-22T08:00:00Z'), last: new Date('2026-11-02T08:00:00Z') },
  own: row({ matches: 659 }),
  paired: paired(),
  newDivisions: { matches: 72 },
  ...overrides,
});

describe('the intervals', () => {
  it('gives a mean its normal interval, mean ± 1.96 sd/√n', () => {
    expect(normalEstimate(0.95, 0.4, 400)).toEqual({ mean: 0.95, low: 0.9108, high: 0.9892 });
  });

  it('gives a share its Wilson interval, inside 0..1 on a small band', () => {
    const all = wilsonEstimate(5, 5);
    expect(all.mean).toBe(1);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.5655, 4);
    expect(wilsonEstimate(157, 253)).toMatchObject({ mean: 0.6206, low: 0.5594, high: 0.6781 });
  });

  it('draws no bounds below two matches', () => {
    expect(normalEstimate(1.2, null, 1)).toEqual({ mean: 1.2, low: null, high: null });
    expect(wilsonEstimate(1, 1)).toEqual({ mean: 1, low: null, high: null });
  });
});

describe('a record', () => {
  it('states its sample, its coverage and its window', () => {
    const record = modelRecord(row());
    expect(record.matches).toBe(400);
    expect(record.coverage).toBe('available');
    expect(record.accuracy?.mean).toBe(0.58);
    expect(record.rps).toEqual({ mean: 0.2, low: 0.1853, high: 0.2147 });
    expect(record.uniform_rps).toBe(0.2361);
    expect(record.limited).toBe(198);
    expect(record.median_lead_hours).toBe(0.45);
    expect(record.first_kickoff_at).toBe('2026-10-10T12:00:00.000Z');
    expect(modelRecord(row({ matches: 12 })).coverage).toBe('limited');
  });

  it('says nothing was evaluated rather than a zero', () => {
    expect(modelRecord(undefined)).toMatchObject({
      matches: 0,
      coverage: 'not_supplied',
      log_loss: null,
      rps: null,
      uniform_rps: null,
      accuracy: null,
    });
  });
});

describe('the competitions', () => {
  it('ranks best first by log loss, the thin ones after by name', () => {
    const named = (name: string, logLoss: number, matches: number) =>
      row({ competition: { id: name, name }, logLoss, matches });
    const ordered = competitionRecords([
      row(),
      named('Scottish Premiership', 1.1184, 75),
      named('Saudi Pro League', 0.9, 12),
      named('Serie A', 0.93, 160),
      named('Eredivisie', 1.0765, 102),
      named('A-League', 0.8, 5),
    ]).map((c) => c.competition.name);
    expect(ordered).toEqual([
      'Serie A',
      'Eredivisie',
      'Scottish Premiership',
      'A-League',
      'Saudi Pro League',
    ]);
  });
});

describe('the calibration', () => {
  it('orders home, draw, away and each by band, with the share seen and its interval', () => {
    const bands = calibrationBands([
      { outcome: 'away', band: 4, forecasts: 253, said: 0.441, seen: 157 },
      { outcome: 'draw', band: 2, forecasts: 1239, said: 0.25, seen: 214 },
      { outcome: 'home', band: 4, forecasts: 364, said: 0.449, seen: 194 },
    ]);
    expect(bands.map((b) => `${b.outcome}${b.band}`)).toEqual(['home4', 'draw2', 'away4']);
    expect(bands[2]?.seen.mean).toBeCloseTo(0.6206, 4);
  });
});

describe('a candidate', () => {
  it('gives its own record and the counts toward its conditions, never their figures', () => {
    const record = candidateRecord(candidate());
    expect(record.paired).toEqual({ matches: 254, identical: 247 });
    expect(record.new_divisions).toEqual({ matches: 72 });
    expect(record.own.matches).toBe(659);
  });

  it('keeps to the counts once they are reached: the one look is the weekly watch (D-336)', () => {
    const record = candidateRecord(
      candidate({
        paired: paired({ matches: 352, identical: 273 }),
        newDivisions: { matches: 120 },
      }),
    );
    expect(record.paired).toEqual({ matches: 352, identical: 273 });
    expect(record.new_divisions).toEqual({ matches: 120 });
    expect(JSON.stringify(record.paired)).not.toContain('log_loss');
  });

  it('says the service was silent rather than that it runs nothing', () => {
    expect(candidateRecord(candidate({ inService: null })).in_service).toBeNull();
  });
});

// --- Every version (T-1752, D-371) ---------------------------------------------------

const V1 = 'dixon-coles-elo@0.1.0';
const V6 = 'dixon-coles-elo@0.6.0';
const V7 = 'dixon-coles-elo@0.7.0';

const count = (
  role: 'published' | 'shadow',
  modelVersion: string,
  first: string,
  last: string,
): VersionCountsRow => ({
  role,
  modelVersion,
  first: new Date(first),
  last: new Date(last),
  forecasts: 900,
  evaluated: 700,
  awaiting: 150,
  afterKickoff: 40,
  unavailable: 10,
});

const versionRow = (
  role: 'published' | 'shadow',
  modelVersion: string,
  overrides: Partial<ModelRecordRow> = {},
): VersionRecordRow => ({ role, modelVersion, ...row(overrides) });

const pair = (
  a: [role: 'published' | 'shadow', modelVersion: string],
  b: [role: 'published' | 'shadow', modelVersion: string],
  overrides: Partial<VersionPairRow> = {},
): VersionPairRow => ({
  a: { role: a[0], modelVersion: a[1] },
  b: { role: b[0], modelVersion: b[1] },
  competition: null,
  matches: 254,
  identical: 247,
  aLogLoss: 0.94998,
  bLogLoss: 0.95,
  aBrier: 0.55999,
  bBrier: 0.56,
  aRps: 0.2,
  bRps: 0.2001,
  aCorrect: 150,
  bCorrect: 149,
  difference: -0.00002,
  differenceSd: 0.0009,
  ...overrides,
});

const versions = (overrides: Partial<VersionsInput> = {}): VersionsInput => ({
  published: V6,
  shadow: [V7],
  counts: [
    count('published', V1, '2026-09-01T08:00:00Z', '2026-10-08T08:00:00Z'),
    count('shadow', V6, '2026-09-01T08:00:01Z', '2026-10-08T08:00:00Z'),
    count('published', V6, '2026-10-08T09:00:00Z', '2026-11-06T08:00:00Z'),
    count('shadow', V7, '2026-10-22T08:00:00Z', '2026-11-06T08:00:00Z'),
  ],
  records: [
    versionRow('published', V1, { matches: 210 }),
    versionRow('shadow', V6, { matches: 120 }),
    versionRow('published', V6, { matches: 517 }),
    versionRow('published', V6, {
      matches: 160,
      competition: { id: 'serie-a', name: 'Serie A' },
    }),
    versionRow('shadow', V7, { matches: 659 }),
  ],
  calibration: [
    {
      role: 'published',
      modelVersion: V6,
      outcome: 'home',
      band: 4,
      forecasts: 364,
      said: 0.449,
      seen: 194,
    },
    {
      role: 'shadow',
      modelVersion: V7,
      outcome: 'home',
      band: 4,
      forecasts: 400,
      said: 0.45,
      seen: 210,
    },
  ],
  trends: [
    {
      role: 'published',
      model_version: V6,
      competition: null,
      total: {
        forecasts: 0,
        matches: 0,
        coverage: 'not_supplied',
        log_loss: null,
        brier: null,
        rps: null,
        accuracy: null,
        uniform_rps: null,
      },
      points: [
        {
          period: '2026-W43',
          period_start: '2026-10-19',
          forecasts: 300,
          matches: 180,
          coverage: 'available',
          log_loss: 0.96,
          brier: 0.57,
          rps: 0.2,
          accuracy: 0.57,
          uniform_rps: 0.24,
        },
      ],
    },
  ],
  ...overrides,
});

describe('every version', () => {
  it('lists the one on the site, then those in shadow now, then the earlier ones newest first', () => {
    const listed = versionRecords(versions());
    expect(listed.map((v) => `${v.role} ${v.model_version} ${v.state}`)).toEqual([
      `published ${V6} published_now`,
      `shadow ${V7} shadow_now`,
      `published ${V1} earlier`,
      `shadow ${V6} earlier`,
    ]);
  });

  it('gives each its own record, counts, calibration, trend and competitions', () => {
    const [site, candidate, first] = versionRecords(versions());
    expect(site?.record.matches).toBe(517);
    expect(site?.counts).toEqual({
      forecasts: 900,
      evaluated: 700,
      awaiting: 150,
      after_kickoff: 40,
      unavailable: 10,
    });
    expect(site?.calibration).toHaveLength(1);
    expect(site?.trend.map((p) => p.period)).toEqual(['2026-W43']);
    expect(site?.competitions.map((c) => c.competition.name)).toEqual(['Serie A']);
    expect(candidate?.calibration[0]?.forecasts).toBe(400);
    expect(candidate?.trend).toEqual([]);
    expect(first?.record.matches).toBe(210);
  });

  it('gives a version in shadow now its competitions as counts, by name, without a figure', () => {
    const [, candidate] = versionRecords(
      versions({
        records: [
          versionRow('shadow', V7, { matches: 659 }),
          versionRow('shadow', V7, { matches: 40, competition: { id: 'sa', name: 'Serie A' } }),
          versionRow('shadow', V7, { matches: 16, competition: { id: 'ar', name: 'Argentina' } }),
        ],
      }),
    );
    expect(candidate?.record.log_loss).not.toBeNull();
    expect(candidate?.competitions.map((c) => [c.competition.name, c.record.matches])).toEqual([
      ['Argentina', 16],
      ['Serie A', 40],
    ]);
    for (const c of candidate?.competitions ?? []) {
      expect(c.record).toMatchObject({ log_loss: null, brier: null, rps: null, accuracy: null });
    }
  });

  it('keeps a candidate being judged when the service is silent and its last forecast is old', () => {
    // The service named nothing; 0.7.0 last forecast eight days ago, after 0.6.0 started.
    const silent = versions({
      shadow: [],
      counts: [
        count('published', V6, '2026-10-09T20:15:00Z', '2026-11-06T08:00:00Z'),
        count('shadow', V7, '2026-10-21T19:45:00Z', '2026-10-29T08:00:00Z'),
        count('shadow', 'dixon-coles-elo@0.5.0', '2026-10-01T12:30:00Z', '2026-10-09T19:00:00Z'),
      ],
    });
    const listed = versionRecords(silent);
    expect(listed.map((v) => `${v.model_version} ${v.state}`)).toEqual([
      `${V6} published_now`,
      `${V7} shadow_now`,
      'dixon-coles-elo@0.5.0 earlier',
    ]);
    const [judging] = versionComparisons(
      [pair(['shadow', V7], ['published', V6], { matches: 352 })],
      silent,
    );
    expect(judging).toMatchObject({ kind: 'judging', figures: null });
    const report = consoleModelReport({
      ...silent,
      service: 'unreachable',
      inService: () => null,
      newDivisions: new Map([[V7, 93]]),
      pairs: [pair(['shadow', V7], ['published', V6], { matches: 352 })],
      unscored: null,
      inputs: [],
      now: new Date('2026-11-06T12:00:00Z'),
    });
    expect(report.candidates.map((c) => c.model_version)).toEqual([V7]);
    expect(report.candidates[0]?.paired).toEqual({ matches: 352, identical: 247 });
  });

  it('says a version that stored forecasts and scored none has no record', () => {
    // With no published version on record, a shadow version is still being judged.
    const listed = versionRecords(
      versions({
        counts: [count('shadow', 'x@1', '2026-11-05T08:00:00Z', '2026-11-06T08:00:00Z')],
      }),
    );
    expect(listed[0]?.record).toMatchObject({ matches: 0, coverage: 'not_supplied' });
    expect(listed[0]?.state).toBe('shadow_now');
  });
});

describe('two versions on the same matches', () => {
  it('keeps a version in shadow now to its counts, overall and per competition', () => {
    const [judging] = versionComparisons(
      [
        pair(['shadow', V7], ['published', V6]),
        pair(['shadow', V7], ['published', V6], {
          competition: { id: 'serie-a', name: 'Serie A' },
          matches: 60,
        }),
      ],
      versions(),
    );
    expect(judging).toMatchObject({
      subject: { model_version: V7, role: 'shadow' },
      reference: { model_version: V6, role: 'published' },
      kind: 'judging',
      matches: 254,
      identical: 247,
      minimum: 300,
      figures: null,
    });
    expect(judging?.competitions).toEqual([
      {
        competition: { id: 'serie-a', name: 'Serie A' },
        matches: 60,
        identical: 247,
        figures: null,
      },
    ]);
  });

  it('gives no figure of a version in shadow now even past 300: that look is the weekly watch', () => {
    const [judging] = versionComparisons(
      [
        pair(['shadow', V7], ['published', V6], { matches: 352, identical: 273 }),
        pair(['shadow', V7], ['published', V6], {
          competition: { id: 'serie-a', name: 'Serie A' },
          matches: 60,
          identical: 60,
        }),
      ],
      versions(),
    );
    expect(judging).toMatchObject({ kind: 'judging', matches: 352, identical: 273, figures: null });
    expect(judging?.competitions[0]).toMatchObject({ matches: 60, identical: 60, figures: null });
  });

  it('turns a record pair round when the store names the subject second', () => {
    // Both earlier: the shadow side was the candidate of its day, here named second.
    const [record] = versionComparisons(
      [
        pair(['published', 'z@9'], ['shadow', V6], {
          matches: 120,
          aLogLoss: 0.95,
          bLogLoss: 0.94,
          aCorrect: 60,
          bCorrect: 66,
          difference: 0.01,
        }),
        pair(['published', 'z@9'], ['shadow', V6], {
          competition: { id: 'serie-a', name: 'Serie A' },
          matches: 60,
        }),
        pair(['published', 'z@9'], ['shadow', V6], {
          competition: { id: 'a-league', name: 'A-League' },
          matches: 12,
        }),
      ],
      versions(),
    );
    expect(record?.subject).toEqual({ model_version: V6, role: 'shadow' });
    expect(record?.figures?.subject.log_loss).toBe(0.94);
    expect(record?.figures?.subject.accuracy).toBe(0.55);
    expect(record?.figures?.reference.accuracy).toBe(0.5);
    expect(record?.figures?.difference.mean).toBe(-0.01);
    expect(record?.figures?.difference.high).toBeCloseTo(
      -0.01 + (1.96 * 0.0009) / Math.sqrt(120),
      6,
    );
    // Per competition from 30 shared matches; below it the count alone.
    expect(record?.competitions.map((c) => [c.competition.name, c.figures !== null])).toEqual([
      ['Serie A', true],
      ['A-League', false],
    ]);
  });

  it('names the newer of two earlier versions as the subject, whatever its role', () => {
    // 0.6.0 took over from the stopped shadow version 0.5.0: the pair is about 0.6.0.
    const [record] = versionComparisons(
      [
        pair(['shadow', 'dixon-coles-elo@0.5.0'], ['published', V6], {
          matches: 170,
          difference: 0.0032,
        }),
      ],
      versions({
        shadow: [],
        counts: [
          count('shadow', 'dixon-coles-elo@0.5.0', '2026-10-01T12:30:17Z', '2026-10-09T19:00:00Z'),
          count('published', V6, '2026-10-09T20:15:00Z', '2026-11-06T08:00:00Z'),
        ],
      }),
    );
    expect(record?.subject).toEqual({ model_version: V6, role: 'published' });
    expect(record?.reference.model_version).toBe('dixon-coles-elo@0.5.0');
    expect(record?.figures?.difference.mean).toBe(-0.0032);
  });

  it('shows the record of two earlier versions from 30 matches, the candidate of its day as the subject', () => {
    const [record, thin] = versionComparisons(
      [
        pair(['shadow', V6], ['published', V1], { matches: 120, identical: 0 }),
        pair(['published', V6], ['published', V1], { matches: 9, identical: 0 }),
      ],
      versions(),
    );
    expect(record).toMatchObject({
      subject: { model_version: V6, role: 'shadow' },
      reference: { model_version: V1, role: 'published' },
      kind: 'record',
      minimum: 30,
    });
    expect(record?.figures).not.toBeNull();
    // Both published: the one that started later is the subject; too few to show.
    expect(thin).toMatchObject({
      subject: { model_version: V6, role: 'published' },
      matches: 9,
      figures: null,
    });
  });

  it('reads the pairs of a candidate with the published version from either side', () => {
    const forward = pairedOf([pair(['shadow', V7], ['published', V6])], V7, V6);
    expect(forward).toMatchObject({
      matches: 254,
      candidateLogLoss: 0.94998,
      difference: -0.00002,
    });
    const backward = pairedOf(
      [
        pair(['published', 'z@9'], ['shadow', V7], {
          aLogLoss: 0.95,
          bLogLoss: 0.94,
          difference: 0.01,
        }),
      ],
      V7,
      'z@9',
    );
    expect(backward).toMatchObject({
      publishedLogLoss: 0.95,
      candidateLogLoss: 0.94,
      difference: -0.01,
    });
    expect(pairedOf([], V7, V6).matches).toBe(0);
    expect(pairedOf([pair(['shadow', V7], ['published', V6])], V7, null).matches).toBe(0);
  });
});

describe('the whole answer', () => {
  it('names the published version, lists every version and keeps the D-336 counts', () => {
    const report = consoleModelReport({
      ...versions(),
      service: 'answered',
      inService: () => true,
      newDivisions: new Map([[V7, 72]]),
      pairs: [pair(['shadow', V7], ['published', V6])],
      unscored: { finished: 814, without: 100 },
      inputs: [],
      now: new Date('2026-11-06T12:00:00Z'),
    });
    expect(report.published).toMatchObject({
      model_version: V6,
      since: '2026-10-08T09:00:00.000Z',
    });
    expect(report.published?.record.matches).toBe(517);
    expect(report.published?.unscored).toEqual({ finished: 814, without: 100 });
    expect(report.versions).toHaveLength(4);
    expect(report.comparisons).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      model_version: V7,
      in_service: true,
      first_forecast_at: '2026-10-22T08:00:00.000Z',
      paired: { matches: 254, identical: 247 },
      new_divisions: { matches: 72 },
    });
    expect(report.candidates[0]?.own.matches).toBe(659);
    expect(report.last_updated_at).toBe('2026-11-02T01:00:00.000Z');
  });

  it('says nothing is published rather than inventing a version', () => {
    const report = consoleModelReport({
      ...versions({ published: null, shadow: [], counts: [], records: [], calibration: [] }),
      service: 'unreachable',
      inService: () => null,
      newDivisions: new Map(),
      pairs: [],
      unscored: null,
      inputs: [],
      now: new Date('2026-11-06T12:00:00Z'),
    });
    expect(report).toMatchObject({
      service: 'unreachable',
      published: null,
      versions: [],
      comparisons: [],
      candidates: [],
      last_updated_at: null,
    });
  });
});

describe("the inputs' data", () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const input = (overrides: Partial<ModelInputRow>): ModelInputRow => ({
    key: 'results',
    count: 31936,
    of: 56361,
    groups: 27,
    newestAt: new Date('2026-11-05T12:00:00Z'),
    ...overrides,
  });

  it('calls the fit window available: a part of the store by design, not a gap', () => {
    expect(inputState(input({ lateGroups: 0 }), now)).toEqual({
      key: 'results',
      coverage: 'available',
      count: 31936,
      of: 56361,
      groups: 27,
      late_groups: 0,
      newest_at: '2026-11-05T12:00:00.000Z',
    });
  });

  it('says limited when some leagues in season have no result of the last ten days', () => {
    expect(inputState(input({ lateGroups: 14 }), now)).toMatchObject({
      coverage: 'limited',
      late_groups: 14,
    });
  });

  it('says delayed when the newest row is older than the input is refreshed', () => {
    expect(
      inputState(
        input({ key: 'own_elo', of: null, newestAt: new Date('2026-11-01T12:00:00Z') }),
        now,
      ).coverage,
    ).toBe('delayed');
  });

  it('says limited when only part of the finished matches carry it', () => {
    expect(inputState(input({ key: 'expected_goals', count: 607, of: 1000 }), now).coverage).toBe(
      'limited',
    );
    expect(inputState(input({ key: 'lineups', count: 1333, of: 1467 }), now).coverage).toBe(
      'available',
    );
  });

  it('says not supplied with nothing stored, never a zero that reads as a count', () => {
    expect(
      inputState(input({ key: 'absences', count: 0, of: null, newestAt: null }), now),
    ).toMatchObject({
      coverage: 'not_supplied',
      newest_at: null,
    });
  });
});
