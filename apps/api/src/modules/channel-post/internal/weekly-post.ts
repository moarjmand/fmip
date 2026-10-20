import type { AccuracyMetrics, PublicModelAccuracyResponse } from '@fmip/contracts';
import { type DailyPost, POST_LOCALE, dayLabel } from './daily-post';
import { MAX_MESSAGE_LENGTH, packMessages } from './pack';

/**
 * The statistical model's accuracy over one ISO week (T-1430, D-222), as
 * text. Pure.
 *
 * The figures are the public accuracy page's for that week (`GET
 * /model/accuracy?period=week`, T-1413) -- the numbers the site's weekly
 * card shows, read and never computed again: matches scored, how often the
 * most likely outcome happened, the ranked probability score beside a
 * uniform guess's on the same matches, and a `limited` sample said as such.
 * Published forecasts only, labelled as the model's (rule 6).
 */

/** `YYYY-MM-DD` plus `days`, in UTC. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday that starts the ISO week before the one `day` falls in. */
export function previousWeekStart(day: string): string {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  return addDays(day, -weekday - 7);
}

export function accuracyUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/${POST_LOCALE}/model-accuracy?period=week`;
}

function share(value: number): string {
  return `${(Math.round(value * 1000) / 10).toFixed(1)}%`;
}

/** How many matches the most likely outcome happened in: the share is exactly correct ÷ matches. */
function rightOf(m: AccuracyMetrics): number {
  return Math.round((m.accuracy ?? 0) * m.matches);
}

function overallText(m: AccuracyMetrics, minimum: number): string[] {
  const lines = [
    `Matches scored: ${m.matches}` +
      (m.coverage === 'limited' ? ` (a limited sample: fewer than ${minimum})` : ''),
  ];
  if (m.accuracy !== null) {
    lines.push(
      `Most likely outcome happened: ${rightOf(m)} of ${m.matches} (${share(m.accuracy)}; a uniform guess gets one in three)`,
    );
  }
  if (m.rps !== null) {
    lines.push(
      `Ranked probability score: ${m.rps.toFixed(3)}` +
        (m.uniform_rps === null
          ? ''
          : ` (a uniform guess scores ${m.uniform_rps.toFixed(3)} on the same matches; lower is better)`),
    );
  }
  return lines;
}

function competitionText(m: AccuracyMetrics): string {
  return (
    `${m.matches} ${m.matches === 1 ? 'match' : 'matches'}` +
    (m.accuracy === null ? '' : ` · most likely outcome ${rightOf(m)} of ${m.matches}`) +
    (m.rps === null ? '' : ` · RPS ${m.rps.toFixed(3)}`) +
    (m.uniform_rps === null ? '' : ` (uniform ${m.uniform_rps.toFixed(3)})`) +
    (m.coverage === 'limited' ? ' · limited sample' : '')
  );
}

function header(
  weekStart: string,
  versions: string[],
  origin: string,
  part: number,
  total: number,
): string {
  const title =
    `FMIP · The statistical model's accuracy · Week of ${dayLabel(weekStart)}` +
    (total > 1 ? ` (${part}/${total})` : '');
  const named = versions.length === 0 ? '' : ` (${versions.join(', ')})`;
  return (
    `${title}\n` +
    `How the statistical model's published forecasts${named} did on the matches played from ${dayLabel(weekStart)} to ${dayLabel(addDays(weekStart, 6))} (UTC), each match counted once, by its last forecast before kick-off.\n` +
    `Full figures: ${accuracyUrl(origin)}`
  );
}

/**
 * The week's post, or null when the public answer has no scored match in
 * the week that starts `weekStart` -- a week with nothing scored posts
 * nothing. `fixtures` and `forecasts` are both the week's scored matches.
 */
export function composeWeeklyPost(
  weekStart: string,
  accuracy: PublicModelAccuracyResponse,
  origin: string,
  limit = MAX_MESSAGE_LENGTH,
): DailyPost | null {
  const overall = accuracy.overall.points.find((p) => p.period_start === weekStart);
  if (overall === undefined || overall.matches === 0) return null;

  const competitions = accuracy.competitions.flatMap((series) => {
    const point = series.points.find((p) => p.period_start === weekStart);
    return series.competition === null || point === undefined || point.matches === 0
      ? []
      : [{ title: series.competition.name, blocks: [competitionText(point)] }];
  });
  const versions = [...accuracy.overall.model_versions].sort();
  return {
    day: weekStart,
    messages: packMessages(
      [
        {
          title: 'All competitions',
          blocks: [overallText(overall, accuracy.minimum_matches).join('\n')],
        },
        ...competitions,
      ],
      (part, total) => header(weekStart, versions, origin, part, total),
      limit,
    ),
    fixtures: overall.matches,
    forecasts: overall.matches,
    modelVersions: versions,
  };
}
