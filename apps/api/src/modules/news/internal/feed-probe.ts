import { isIP } from 'node:net';
import { NEWS_FEED_PREVIEW_ITEMS, type NewsFeedPreview, type RobotsVerdict } from '@fmip/contracts';
import { type Transport, readFeed } from '@fmip/ingestion';
import { NEWS_USER_AGENT, robotsAllows } from './robots';

/** How much of a publisher's summary the preview shows. */
const SUMMARY_CHARS = 300;

/**
 * Why a feed address cannot be used, or `null` when it can (T-1015). Only
 * http and https, with a host that is a name or a public address: the API
 * fetches it, so an address on the server's own network (loopback, private,
 * link-local) is refused rather than fetched. A name that resolves to such an
 * address is not caught here; the console is administrators' only.
 */
export function feedUrlProblem(given: string): string | null {
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return 'is not an address';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return 'must be an http or https address';
  if (url.username !== '' || url.password !== '') return 'must not carry a user name or password';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'must be a public address';
  }
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return 'must be a public address';
    }
  }
  if (family === 6 && (host === '::1' || host === '::' || /^(fc|fd|fe8|fe9|fea|feb)/.test(host))) {
    return 'must be a public address';
  }
  return null;
}

function cut(text: string | null): string | null {
  if (text === null) return null;
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS - 1)}…` : text;
}

/**
 * The feed read once, as the hourly job would read it (T-1015): the
 * publisher's robots.txt first (D-061, `robots.ts`), and the feed only if it
 * allows our agent, through the same reader (`readFeed`) and transport the
 * job uses. Nothing is written. A robots.txt that answers anything but 200
 * allows everything, as the job treats it; one that cannot be asked at all is
 * `unreachable`, and the feed is not fetched.
 */
export async function probeFeed(transport: Transport, feedUrl: string): Promise<NewsFeedPreview> {
  const feed = new URL(feedUrl);
  const robotsUrl = `${feed.origin}/robots.txt`;
  const checked_at = new Date().toISOString();
  let verdict: RobotsVerdict;
  let status: number | null = null;
  try {
    const robots = await transport.request(robotsUrl, { headers: { accept: 'text/plain' } });
    status = robots.status;
    verdict =
      robots.status !== 200 || typeof robots.body !== 'string'
        ? 'absent'
        : robotsAllows(robots.body, `${feed.pathname}${feed.search}`, NEWS_USER_AGENT)
          ? 'allowed'
          : 'disallowed';
  } catch {
    verdict = 'unreachable';
  }
  const robots = { url: robotsUrl, verdict, status };
  if (verdict === 'disallowed' || verdict === 'unreachable') {
    return { feed_url: feedUrl, checked_at, robots, feed: null };
  }
  try {
    const result = await readFeed(transport, feedUrl);
    if (!result.ok) {
      return {
        feed_url: feedUrl,
        checked_at,
        robots,
        feed: { ok: false, error: `${result.error.kind}: ${result.error.message}` },
      };
    }
    const parsed = result.data;
    return {
      feed_url: feedUrl,
      checked_at,
      robots,
      feed: {
        ok: true,
        kind: parsed.kind,
        title: parsed.title,
        language: parsed.language,
        items: parsed.items.length,
        skipped: parsed.skipped,
        sample: parsed.items.slice(0, NEWS_FEED_PREVIEW_ITEMS).map((item) => ({
          headline: item.headline,
          url: item.url,
          published_at: item.publishedAt,
          summary: cut(item.summary),
          language: item.language,
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      feed_url: feedUrl,
      checked_at,
      robots,
      feed: { ok: false, error: `transport: ${message}` },
    };
  }
}

/** Why a checked feed cannot be saved, or `null` when it can. */
export function previewRefusal(preview: NewsFeedPreview, kind: string): string | null {
  if (preview.robots.verdict === 'disallowed') {
    return `robots.txt at ${preview.robots.url} disallows this feed for ${NEWS_USER_AGENT}.`;
  }
  if (preview.robots.verdict === 'unreachable') {
    return `robots.txt at ${preview.robots.url} could not be read, so the feed was not checked.`;
  }
  if (preview.feed === null || !preview.feed.ok) {
    return `The feed could not be read: ${preview.feed?.ok === false ? preview.feed.error : 'not fetched'}.`;
  }
  if (preview.feed.kind !== kind) {
    return `The feed is ${preview.feed.kind}, not ${kind}.`;
  }
  return null;
}
