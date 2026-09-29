import type { CloudflareRangesSeen } from './conditions';

/**
 * Cloudflare's address ranges as committed in `deploy/cloudflare-ranges.caddy`
 * (T-930, D-112): the only addresses Caddy lets reach the origin. The watchdog
 * compares this list with the one Cloudflare publishes, once a week.
 *
 * A copy, because the API image does not carry `deploy/`; `cloudflare-ranges
 * .spec.ts` reads the Caddy file and fails while the two disagree, so the copy
 * is exactly what Caddy enforces on the commit that built this image.
 */
export const COMMITTED_CLOUDFLARE_RANGES: readonly string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Where Cloudflare publishes its ranges, one per line. */
export const CLOUDFLARE_RANGE_LISTS = [
  'https://www.cloudflare.com/ips-v4',
  'https://www.cloudflare.com/ips-v6',
] as const;

const CIDR = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)\/\d{1,3}$/;

/**
 * One published list's body as ranges: one per non-empty line, lower-cased.
 * Anything that is not a range (an HTML error page, a captcha) throws, so a
 * wrong answer is an unreadable list and never a "difference".
 */
export function parseRangeList(body: string, source: string): string[] {
  const ranges = body
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '');
  if (ranges.length === 0) throw new Error(`${source} answered an empty list`);
  const bad = ranges.find((range) => !CIDR.test(range));
  if (bad !== undefined) {
    throw new Error(`${source} answered something that is not a list of ranges`);
  }
  return ranges;
}

/** The ranges in each list and not in the other. */
export function compareRanges(
  committed: readonly string[],
  published: readonly string[],
): { notCommitted: string[]; noLongerPublished: string[] } {
  const ours = new Set(committed.map((r) => r.toLowerCase()));
  const theirs = new Set(published.map((r) => r.toLowerCase()));
  return {
    notCommitted: [...theirs].filter((r) => !ours.has(r)),
    noLongerPublished: [...ours].filter((r) => !theirs.has(r)),
  };
}

const HOUR_MS = 60 * 60 * 1000;
/** A comparison that answered is repeated after a week (the task's cadence). */
export const RANGES_RECHECK_MS = 7 * 24 * HOUR_MS;
/** One that could not read Cloudflare's lists is tried again after an hour. */
export const RANGES_RETRY_MS = HOUR_MS;
const FETCH_TIMEOUT_MS = 15_000;

/** Reads one published list's body. A port so the tests need no network. */
export type RangeListReader = (url: string) => Promise<string>;

const readOverHttp: RangeListReader = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.text();
};

/**
 * The weekly comparison (T-930). The watchdog asks every minute; this answers
 * from its last comparison and only reads Cloudflare's lists again when that
 * comparison is a week old, or an hour old when it failed. It lives in the
 * process that runs the watchdog, so a restart (every deploy) compares once
 * more, which is what a deploy that changed the list wants anyway.
 */
export class WeeklyRangesCheck {
  private last: CloudflareRangesSeen | null = null;
  private pending: Promise<CloudflareRangesSeen> | null = null;

  constructor(
    private readonly read: RangeListReader = readOverHttp,
    private readonly committed: readonly string[] = COMMITTED_CLOUDFLARE_RANGES,
  ) {}

  async seen(now: Date, setting: string | undefined): Promise<CloudflareRangesSeen> {
    const value = (setting ?? '').trim().toLowerCase();
    if (value === '' || value === 'off') return { configured: false };
    if (value !== 'on') {
      return { unreadable: 'CLOUDFLARE_RANGES_CHECK must be on or off', at: now };
    }
    if (this.last !== null && 'at' in this.last) {
      const wait = 'unreadable' in this.last ? RANGES_RETRY_MS : RANGES_RECHECK_MS;
      if (now.getTime() - this.last.at.getTime() < wait) return this.last;
    }
    this.pending ??= this.compare(now).finally(() => {
      this.pending = null;
    });
    this.last = await this.pending;
    return this.last;
  }

  private async compare(now: Date): Promise<CloudflareRangesSeen> {
    try {
      const lists = await Promise.all(
        CLOUDFLARE_RANGE_LISTS.map(async (url) => parseRangeList(await this.read(url), url)),
      );
      return { ...compareRanges(this.committed, lists.flat()), at: now };
    } catch (error: unknown) {
      return { unreadable: error instanceof Error ? error.message : String(error), at: now };
    }
  }
}
