import type {
  AccuracyPoint,
  ConsoleModelCalibrationBand,
  ConsoleModelCompetition,
  ConsoleModelEstimate,
  ConsoleModelRecord,
  ConsoleModelReport,
} from '@fmip/contracts';

/**
 * A stand-in `GET /console/model` answer for the console's model page specs
 * and its local screenshots (T-1729), shaped on the model scientist's weekly
 * report of 2026-11-02: 0.6.0 on 1,831 matches (log loss 0.9538, Brier
 * 0.5639, 58.2% correct), its five off-calibration bands, the Scottish
 * Premiership and the Eredivisie as the weak competitions, and 0.7.0 at 254
 * of 300 paired matches (97.2% identical) and 72 of 100 new-division ones.
 * The intervals are computed here as the API computes them; the band and
 * competition counts the report does not give are made up to add up.
 */

const Z = 1.96;
const r = (v: number, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

const normal = (mean: number, sd: number, n: number): ConsoleModelEstimate => ({
  mean,
  low: r(mean - (Z * sd) / Math.sqrt(n)),
  high: r(mean + (Z * sd) / Math.sqrt(n)),
});

const wilson = (share: number, n: number): ConsoleModelEstimate => {
  const z2 = Z * Z;
  const centre = (share + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((share * (1 - share)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { mean: r(share, 4), low: r(centre - half, 4), high: r(centre + half, 4) };
};

export const record = (
  matches: number,
  logLoss: number,
  brier: number,
  accuracy: number,
  first = '2026-10-10T14:00:00.000Z',
  last = '2026-11-01T20:00:00.000Z',
): ConsoleModelRecord => ({
  matches,
  coverage: matches === 0 ? 'not_supplied' : matches < 30 ? 'limited' : 'available',
  log_loss: normal(logLoss, 0.47, matches),
  brier: normal(brier, 0.29, matches),
  accuracy: wilson(accuracy, matches),
  first_kickoff_at: first,
  last_kickoff_at: last,
});

const band = (
  outcome: 'home' | 'draw' | 'away',
  b: number,
  forecasts: number,
  said: number,
  seen: number,
): ConsoleModelCalibrationBand => ({
  outcome,
  band: b,
  forecasts,
  said,
  seen: wilson(seen, forecasts),
});

const week = (start: string, label: string, matches: number, logLoss: number): AccuracyPoint => ({
  period: label,
  period_start: start,
  forecasts: matches + Math.round(matches * 0.4),
  matches,
  coverage: 'available',
  log_loss: logLoss,
  brier: r(logLoss * 0.59, 4),
  rps: r(logLoss * 0.205, 4),
  accuracy: r(1.55 - logLoss, 4),
  uniform_rps: 0.2349,
});

let id = 0;
const competition = (
  name: string,
  matches: number,
  logLoss: number,
  accuracy: number,
): ConsoleModelCompetition => ({
  competition: { id: `00000000-0000-4000-8000-${String((id += 1)).padStart(12, '0')}`, name },
  record: record(matches, logLoss, r(logLoss * 0.59, 4), accuracy),
});

export const MODEL_REPORT: ConsoleModelReport = {
  service: 'answered',
  published: {
    model_version: 'dixon-coles-elo@0.6.0',
    since: '2026-10-09T09:12:00.000Z',
    record: record(1831, 0.9538, 0.5639, 0.582),
  },
  reference: { uniform_log_loss: 1.098612, uniform_brier: 0.666667, uniform_accuracy: 0.333333 },
  minimum_matches: 30,
  calibration: [
    band('home', 0, 15, 0.085, 0.067),
    band('home', 1, 95, 0.16, 0.147),
    band('home', 2, 380, 0.255, 0.24),
    band('home', 3, 375, 0.351, 0.416),
    band('home', 4, 364, 0.449, 0.533),
    band('home', 5, 322, 0.546, 0.565),
    band('home', 6, 200, 0.645, 0.66),
    band('home', 7, 80, 0.738, 0.775),
    band('draw', 1, 72, 0.17, 0.139),
    band('draw', 2, 1239, 0.25, 0.173),
    band('draw', 3, 520, 0.318, 0.233),
    band('away', 0, 40, 0.08, 0.05),
    band('away', 1, 390, 0.155, 0.128),
    band('away', 2, 430, 0.25, 0.249),
    band('away', 3, 336, 0.345, 0.274),
    band('away', 4, 253, 0.441, 0.621),
    band('away', 5, 250, 0.545, 0.58),
    band('away', 6, 100, 0.642, 0.65),
    band('away', 7, 32, 0.735, 0.75),
  ],
  trend: [
    week('2026-10-05', '2026-W41', 231, 0.962),
    week('2026-10-12', '2026-W42', 610, 0.96),
    week('2026-10-19', '2026-W43', 470, 1.009),
    week('2026-10-26', '2026-W44', 520, 0.8933),
  ],
  competitions: [
    competition('Champions League', 144, 0.861, 0.639),
    competition('Primeira Liga', 90, 0.902, 0.611),
    competition('Europa League', 120, 0.912, 0.6),
    competition('Serie A', 150, 0.931, 0.593),
    competition('La Liga', 150, 0.948, 0.587),
    competition('Conference League', 52, 0.951, 0.577),
    competition('Ligue 1', 140, 0.969, 0.571),
    competition('Belgian Pro League', 92, 0.981, 0.565),
    competition('Süper Lig', 95, 0.99, 0.558),
    competition('Championship', 168, 1.012, 0.512),
    competition('Persian Gulf Pro League', 80, 1.031, 0.45),
    competition('Bundesliga', 135, 1.042, 0.519),
    competition('Premier League', 150, 1.0545, 0.513),
    competition('Eredivisie', 102, 1.0765, 0.49),
    competition('Scottish Premiership', 75, 1.1184, 0.413),
    {
      competition: { id: '00000000-0000-4000-8000-000000000990', name: 'FA Cup' },
      record: record(26, 0.97, 0.57, 0.54),
    },
    {
      competition: { id: '00000000-0000-4000-8000-000000000991', name: 'Copa del Rey' },
      record: record(12, 1.02, 0.6, 0.5),
    },
  ],
  candidates: [
    {
      model_version: 'dixon-coles-elo@0.7.0',
      in_service: true,
      first_forecast_at: '2026-10-22T07:40:00.000Z',
      last_forecast_at: '2026-11-03T06:10:00.000Z',
      own: record(659, 0.918, 0.5405, 0.627, '2026-10-22T16:00:00.000Z'),
      paired: { matches: 254, identical: 247, figures: null },
      new_divisions: { matches: 72, log_loss: null },
    },
  ],
  last_updated_at: '2026-11-03T01:05:00.000Z',
  generated_at: '2026-11-03T08:00:00.000Z',
};

/** The same, once 0.7.0's paired count is reached: the figures appear, never a verdict. */
export const MODEL_REPORT_REACHED: ConsoleModelReport = {
  ...MODEL_REPORT,
  candidates: [
    {
      ...MODEL_REPORT.candidates[0]!,
      paired: {
        matches: 312,
        identical: 303,
        figures: {
          published_log_loss: 0.9512,
          candidate_log_loss: 0.95118,
          published_brier: 0.5621,
          candidate_brier: 0.56209,
          difference: { mean: -0.00002, low: -0.00012, high: 0.00008 },
        },
      },
      new_divisions: { matches: 104, log_loss: normal(0.9702, 0.5, 104) },
    },
  ],
};

/** Nothing published yet: every section says so instead of a figure. */
export const MODEL_REPORT_EMPTY: ConsoleModelReport = {
  ...MODEL_REPORT,
  service: 'unreachable',
  published: null,
  calibration: [],
  trend: [],
  competitions: [],
  candidates: [],
  last_updated_at: null,
};

/** A version just promoted: a few matches, one week, no competition at the minimum. */
export const MODEL_REPORT_THIN: ConsoleModelReport = {
  ...MODEL_REPORT,
  published: {
    model_version: 'dixon-coles-elo@0.9.0',
    since: '2026-11-02T09:00:00.000Z',
    record: record(14, 0.99, 0.58, 0.5, '2026-11-02T14:00:00.000Z', '2026-11-02T20:00:00.000Z'),
  },
  calibration: [band('draw', 2, 14, 0.26, 0.21)],
  trend: [week('2026-11-02', '2026-W45', 14, 0.99)],
  competitions: [
    {
      competition: { id: '00000000-0000-4000-8000-000000000992', name: 'Premier League' },
      record: record(14, 0.99, 0.58, 0.5),
    },
  ],
};
