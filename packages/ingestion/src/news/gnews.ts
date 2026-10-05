/**
 * GNews (gnews.io, API v4) -> normalised news items (T-1367, D-185).
 *
 * GNews is a news search API, not a publisher: each article it returns names
 * the publisher who wrote it (`source.name`, `source.url`) and links to that
 * publisher's page. So an item here carries the **original** publisher beside
 * the words, and the job files it under that publisher, never under "GNews".
 *
 * **Only what D-061 permits is read**: title, description (the publisher's
 * summary), the original's URL, the publication time and the publisher. The
 * article's `content` -- on the free plan a truncated body -- is never read,
 * so no code path could store or show it. The photo (`image`) is read only
 * when asked for, which the job does only for a source whose licence covers
 * photos (D-177); GNews' photos live on every publisher's own host, so today
 * it is never asked.
 *
 * **Nothing is guessed (rule 3).** An article with no title or no usable link
 * is skipped and counted; a missing description is `null`; a missing time is
 * `null`. The language is the article's own `lang` when it carries one, else
 * the language the request filtered on -- the provider's answer to that
 * filter, not a guess.
 *
 * Like `readFeed`, a pure parser plus a thin reader over the shared
 * `Transport`, so the job never reaches for `fetch` and a test never reaches
 * for the network. The key goes into the request URL, which only the
 * transport sees: no message this module produces contains it.
 */
import type { AdapterError, AdapterResult, Transport } from '../adapters/_contract';
import type { NormalisedNewsItem } from '../normalised';
import { isoDate, textOf } from './feed';

export const GNEWS_ENDPOINT = 'https://gnews.io/api/v4/search';

/** The free plan's ceiling on articles per request; asking for more is refused. */
export const GNEWS_MAX_ARTICLES = 10;

/**
 * Association football in English. GNews' query syntax takes `OR`, `NOT` and
 * parentheses; American football is the one sense of the word that keeps
 * arriving otherwise. Matched in the title and the description only, so an
 * article that mentions football once in its body is not football news.
 */
export const GNEWS_FOOTBALL_QUERY = '(football OR soccer) NOT NFL';

export interface GNewsQuery {
  apiKey: string;
  /** ISO 639-1, as GNews takes it. */
  language: string;
  query?: string;
  max?: number;
}

export interface GNewsOptions {
  /** Read each article's photo URL (D-177). Off unless the source's licence covers photos. */
  images?: boolean;
}

/** The original publisher, as GNews names it. */
export interface GNewsPublisher {
  name: string;
  /** The publisher's site, as an origin (`https://host`). */
  homepage: string;
}

export interface GNewsItem extends NormalisedNewsItem {
  publisher: GNewsPublisher;
}

export interface ParsedGNews {
  items: GNewsItem[];
  /** Articles that lacked a title, a link or a publisher we could name. Counted, not invented. */
  skipped: number;
}

/** The request URL. Holds the key: give it to the transport and nowhere else. */
export function gnewsUrl(q: GNewsQuery): string {
  const params = new URLSearchParams({
    q: q.query ?? GNEWS_FOOTBALL_QUERY,
    lang: q.language,
    max: String(Math.min(q.max ?? GNEWS_MAX_ARTICLES, GNEWS_MAX_ARTICLES)),
    in: 'title,description',
    sortby: 'publishedAt',
    apikey: q.apiKey,
  });
  return `${GNEWS_ENDPOINT}?${params.toString()}`;
}

/** An absolute http(s) URL as a string, or `null`. */
function httpUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function stringOf(raw: unknown): string | null {
  return typeof raw === 'string' ? textOf(raw) : null;
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/**
 * One article, or `null` when it is not one we can show: no title, no link,
 * or no publisher to name (the link's own host is the publisher's site when
 * GNews gives no `source.url`, but a name is never made up).
 */
function articleOf(raw: unknown, language: string, options: GNewsOptions): GNewsItem | null {
  const article = record(raw);
  if (article === null) return null;
  const headline = stringOf(article.title);
  const url = httpUrl(article.url);
  if (headline === null || url === null) return null;
  const source = record(article.source);
  const name = source === null ? null : stringOf(source.name);
  if (name === null) return null;
  const site = (source === null ? null : httpUrl(source.url)) ?? url;
  const lang = stringOf(article.lang);
  const image = options.images === true ? httpUrl(article.image) : null;
  return {
    externalId: url.toString(),
    url: url.toString(),
    headline,
    summary: stringOf(article.description),
    byline: null,
    publishedAt: typeof article.publishedAt === 'string' ? isoDate(article.publishedAt) : null,
    language: lang ?? language,
    categories: [],
    imageUrl: image === null ? null : image.toString(),
    publisher: { name, homepage: site.origin.toLowerCase() },
  };
}

/** The answer's body as articles, or `null` when it is not a GNews answer at all. */
export function parseGNews(
  body: unknown,
  language: string,
  options: GNewsOptions = {},
): ParsedGNews | null {
  let value = body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const answer = record(value);
  if (answer === null || !Array.isArray(answer.articles)) return null;
  const items: GNewsItem[] = [];
  let skipped = 0;
  for (const raw of answer.articles) {
    const item = articleOf(raw, language, options);
    if (item === null) skipped += 1;
    else items.push(item);
  }
  return { items, skipped };
}

/** GNews' own words for a refusal (`{"errors": [...]}` or `{"errors": {...}}`), when it gave any. */
function refusalOf(body: unknown): string | null {
  let value = body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const errors = record(value)?.errors;
  const list = Array.isArray(errors)
    ? errors
    : record(errors) !== null
      ? Object.values(errors as object)
      : [];
  const words = list.filter((e): e is string => typeof e === 'string' && e.trim() !== '');
  return words.length === 0 ? null : words.join('; ').slice(0, 300);
}

function failure(status: number, body: unknown): AdapterError {
  const kind: AdapterError['kind'] =
    status === 429 ? 'quota' : status >= 500 ? 'transport' : 'http';
  const said = refusalOf(body);
  return { kind, message: `GNews answered ${status}${said === null ? '' : `: ${said}`}`, status };
}

/** One request to GNews through the shared transport. */
export async function readGNews(
  transport: Transport,
  q: GNewsQuery,
  options: GNewsOptions = {},
): Promise<AdapterResult<ParsedGNews>> {
  const response = await transport.request(gnewsUrl(q), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (response.status !== 200) {
    return { ok: false, error: failure(response.status, response.body), requests: 1 };
  }
  const parsed = parseGNews(response.body, q.language, options);
  if (parsed === null) {
    return {
      ok: false,
      error: { kind: 'malformed', message: 'GNews answered something that is not its JSON' },
      requests: 1,
    };
  }
  return { ok: true, data: parsed, requests: 1, fetchedAt: response.receivedAt };
}

/** Query parameters that only say where a reader came from, never which page. */
const TRACKING =
  /^(utm_[a-z_]+|at_[a-z_]+|ito|ocid|cmpid|cmp|fbclid|gclid|mc_[a-z]+|rss|ref|src)$/i;

/**
 * The identity of an article's page for deduplication: host without `www.`,
 * the path without a trailing slash, the query without tracking parameters
 * (sorted), no fragment, no scheme. A publisher's feed and GNews often link
 * the same page with different decorations; this is the page. `null` for
 * something that is not an http(s) URL.
 */
export function articleUrlKey(raw: string): string | null {
  const url = httpUrl(raw);
  if (url === null) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  const kept = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING.test(name))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
    .map(([name, value]) => `${name}=${value}`);
  return `${host}${path}${kept.length === 0 ? '' : `?${kept.join('&')}`}`;
}

/** A site's host for comparing publishers: lower case, without `www.`; `null` when not a URL. */
export function siteHost(raw: string): string | null {
  const url = httpUrl(raw);
  return url === null ? null : url.hostname.toLowerCase().replace(/^www\./, '');
}
