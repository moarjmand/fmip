import type {
  AlertChannelOutcomes,
  FailureBucket,
  WatchdogEventKind,
  WatchdogFreshness,
  WatchdogLevel,
  WatchdogUnit,
} from '@fmip/contracts';

/**
 * The System page's arithmetic and words (T-804), kept out of the page so a
 * spec can hold them without a browser.
 *
 * The page is an operator's, in English like the condition keys and notes
 * the watchdog writes; nothing here is shown to a member.
 */

const HOUR_MS = 3_600_000;

/**
 * One count per UTC hour from `since` for `hours` hours, oldest first. The
 * report lists only the hours that had a failure; an hour it leaves out is a
 * zero, which is what it means (T-803: "hours with none are absent").
 */
export function hourlySeries(buckets: FailureBucket[], since: string, hours: number): number[] {
  const start = Date.parse(since);
  const series = new Array<number>(Math.max(0, hours)).fill(0);
  if (Number.isNaN(start)) return series;
  for (const bucket of buckets) {
    const index = Math.floor((Date.parse(bucket.hour) - start) / HOUR_MS);
    if (index >= 0 && index < series.length) series[index] = (series[index] ?? 0) + bucket.count;
  }
  return series;
}

/**
 * A bar per hour as SVG rectangles in a `width` x `height` box, the tallest
 * hour reaching the top. Time runs with the reading direction: in a
 * right-to-left locale the newest hour is on the left.
 */
export function sparkBars(
  series: number[],
  width: number,
  height: number,
  direction: 'ltr' | 'rtl' = 'ltr',
): { x: number; y: number; width: number; height: number; count: number }[] {
  const peak = Math.max(0, ...series);
  if (series.length === 0 || peak === 0) return [];
  const step = width / series.length;
  return series.flatMap((count, index) => {
    if (count === 0) return [];
    const barHeight = Math.max(1, (count / peak) * height);
    const slot = direction === 'rtl' ? series.length - 1 - index : index;
    return [
      {
        x: round(slot * step),
        y: round(height - barHeight),
        width: round(Math.max(1, step * 0.8)),
        height: round(barHeight),
        count,
      },
    ];
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A measured value in its unit, as a person reads it. */
export function formatMeasure(value: number | null, unit: WatchdogUnit): string {
  if (value === null) return 'nothing measured';
  if (unit === 'percent') return `${String(Math.round(value))} %`;
  if (unit === 'count') return String(Math.round(value));
  return formatDuration(value);
}

/** Seconds as "45 s", "16 min", "3 h 5 min", "2 d 4 h". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${String(s)} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${String(days)} d` : `${String(days)} d ${String(rest)} h`;
}

/** How long ago, from the report's own clock (not the browser's). */
export function ago(at: string, now: string): string {
  const seconds = (Date.parse(now) - Date.parse(at)) / 1000;
  if (Number.isNaN(seconds)) return 'at an unreadable time';
  return `${formatDuration(seconds)} ago`;
}

/** Every level in words: `unknown` is "cannot be evaluated", never "fine". */
export const LEVEL_WORDS: Record<WatchdogLevel, string> = {
  ok: 'OK',
  degraded: 'Degraded',
  failing: 'Failing',
  unknown: 'Cannot be evaluated',
};

/** The token colour a level is drawn in; `unknown` stays neutral. */
export const LEVEL_TONE: Record<WatchdogLevel, string> = {
  ok: 'text-success',
  degraded: 'text-warning',
  failing: 'text-danger',
  unknown: 'text-muted',
};

export const EVENT_WORDS: Record<WatchdogEventKind, string> = {
  raised: 'raised',
  escalated: 'got worse',
  eased: 'eased',
  recovered: 'recovered',
  unobservable: 'could no longer be evaluated',
  observable: 'could be evaluated again',
};

/**
 * What the watchdog's own freshness means, said plainly (rule 4): `null` when
 * the levels are current, else the sentence the page shows above them.
 */
export function freshnessSentence(
  freshness: WatchdogFreshness,
  checkedAt: string | null,
  now: string,
): string | null {
  if (freshness === 'current') return null;
  if (freshness === 'never_run' || checkedAt === null) {
    return 'The watchdog has never run on this deployment, so no condition has been evaluated. It runs in the process with INGESTION_SCHEDULE=on.';
  }
  return `The watchdog last ran ${ago(checkedAt, now)}: it has stopped, and the levels below are the last known, not the current ones.`;
}

/** A condition key in words; an unknown shape falls back to the key itself. */
export function conditionName(key: string): string {
  const [kind, target] = key.split(':', 2);
  switch (kind) {
    case 'ingest':
      return `Ingestion: ${target ?? '?'} job`;
    case 'live_feed':
      return 'Live matches moving';
    case 'request_budget':
      return 'Provider request budget';
    case 'jobs':
      return `Failed jobs: ${target ?? '?'} queue`;
    case 'model_service':
      return 'Model service';
    case 'elo_source':
      return "Club Elo (the model's long-term ratings)";
    case 'delivery':
      return `Delivery: ${target ?? '?'}`;
    case 'backup':
      return 'Backup';
    case 'restore_drill':
      return 'Restore drill (monthly)';
    case 'data_quality':
      return 'Live match data contradicting itself';
    default:
      return key;
  }
}

/**
 * What one channel did with one alert, in a line: "absent on this
 * deployment" when the channel does not exist, never a zero that reads like
 * a delivery that went nowhere.
 */
export function channelLine(
  state: 'configured' | 'absent',
  outcomes: AlertChannelOutcomes,
): string {
  if (state === 'absent' && outcomes.sent + outcomes.failed + outcomes.skipped === 0) {
    return 'not configured on this deployment';
  }
  const parts: string[] = [];
  if (outcomes.sent > 0) parts.push(`${String(outcomes.sent)} sent`);
  if (outcomes.failed > 0) parts.push(`${String(outcomes.failed)} failed`);
  if (outcomes.skipped > 0) parts.push(`${String(outcomes.skipped)} with no device or address`);
  if (outcomes.absent > 0) parts.push(`${String(outcomes.absent)} with no channel`);
  if (outcomes.pending > 0) parts.push(`${String(outcomes.pending)} not carried yet`);
  return parts.length === 0 ? 'nothing to carry' : parts.join(', ');
}
