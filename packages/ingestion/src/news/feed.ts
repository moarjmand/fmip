/**
 * A publisher's feed → normalised news items (T-142, D-061).
 *
 * RSS 2.0 and Atom, read by hand. A feed is a handful of elements inside
 * `<item>` or `<entry>`, and a dependency would hide the one thing that
 * matters here: what is taken from the feed is exactly what D-061 permits --
 * headline, the publisher's own summary, byline, time, and the link to the
 * original -- and nothing else exists to take. There is no body in
 * `NormalisedNewsItem`, so there is no code path that could store one.
 *
 * **Nothing is guessed (rule 3).** A missing summary is `null`, a missing time
 * is `null` rather than the fetch time, a missing language is `null` rather
 * than the site's. An item with no headline or no link is not an item; it is
 * skipped and counted, because a headline is the one thing a front page cannot
 * show as blank.
 *
 * The reader is a pure function over text plus a thin `readFeed` over the
 * shared `Transport`, the same seam every adapter uses, so the ingestion job
 * never reaches for `fetch` and a test never reaches for the network.
 */
import type { AdapterError, AdapterResult, Transport } from '../adapters/_contract';
import type { NormalisedNewsItem } from '../normalised';

export interface ParsedFeed {
  kind: 'rss' | 'atom';
  /** The feed's own title, for the operator's view; `null` when absent. */
  title: string | null;
  /** BCP 47 the feed declares for itself; `null` when it does not. */
  language: string | null;
  items: NormalisedNewsItem[];
  /** Entries the feed carried that lacked a headline or a link. Counted, not invented. */
  skipped: number;
}

export interface FeedProblem {
  kind: 'malformed';
  message: string;
}

/**
 * XML's five, plus the HTML named entities publishers' feeds actually use in
 * headlines and summaries. A name not here is left as it came, visibly,
 * rather than dropped: `&unknown;` in a headline is a publisher's mistake
 * a reader can see, and an empty gap is not.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  deg: '°',
  times: '×',
};

/** XML character references and the handful of named entities feeds actually use. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? whole;
  });
}

/**
 * CDATA unwrapped, entities decoded, tags removed, whitespace collapsed.
 *
 * Decoding comes before stripping on purpose: an Atom `<summary type="html">`
 * carries its markup entity-escaped (`&lt;p&gt;`), so a tag has to be decoded
 * before it can be seen and removed. A second decode afterwards covers text
 * that was escaped twice, which feeds do; it is idempotent on plain text.
 */
export function textOf(raw: string | null): string | null {
  if (raw === null) return null;
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Block-level tags become a space, so "<p>one</p><p>two</p>" reads "one two";
  // inline ones become nothing, so "<b>2</b>." stays "2." and not "2 .".
  const stripped = decodeEntities(unwrapped)
    .replace(/<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th|section|article)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  const text = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/**
 * The raw inner text of the first `<name>` element in `xml`, including any
 * CDATA or markup inside it. Namespaced names are matched by local name, so
 * `content:encoded` and `dc:creator` are found as `encoded` and `creator`.
 */
export function firstElement(xml: string, name: string): string | null {
  const open = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${name}(?:\\s[^>]*)?>`, 'i');
  const start = open.exec(xml);
  if (start === null) return null;
  const from = start.index + start[0].length;
  const close = new RegExp(`</(?:[a-zA-Z0-9_-]+:)?${name}\\s*>`, 'i');
  close.lastIndex = from;
  const rest = xml.slice(from);
  const end = close.exec(rest);
  return end === null ? null : rest.slice(0, end.index);
}

/** The value of `attr` on the first `<name ...>` tag, decoded. */
export function firstAttribute(xml: string, name: string, attr: string): string | null {
  const tag = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${name}\\s[^>]*>`, 'i').exec(xml);
  if (tag === null) return null;
  const value = new RegExp(`\\s${attr}\\s*=\\s*"([^"]*)"|\\s${attr}\\s*=\\s*'([^']*)'`, 'i').exec(
    tag[0],
  );
  if (value === null) return null;
  return decodeEntities(value[1] ?? value[2] ?? '');
}

/** Every `<name>…</name>` block, in document order. */
function blocks(xml: string, name: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?${name}\\s*>`,
    'gi',
  );
  for (const match of xml.matchAll(pattern)) found.push(match[1] ?? '');
  return found;
}

/** A date the feed gave, as ISO 8601, or `null` when it is not one. Never "now". */
export function isoDate(raw: string | null): string | null {
  const text = textOf(raw);
  if (text === null) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Atom's `<link rel="alternate" href>` -- or the first `<link>` with an href when none says so. */
function atomLink(entry: string): string | null {
  const tags = entry.match(/<(?:[a-zA-Z0-9_-]+:)?link\s[^>]*>/gi) ?? [];
  let fallback: string | null = null;
  for (const tag of tags) {
    const href = firstAttribute(tag, 'link', 'href');
    if (href === null) continue;
    const rel = firstAttribute(tag, 'link', 'rel');
    if (rel === null || rel === 'alternate') return href;
    if (fallback === null) fallback = href;
  }
  return fallback;
}

function rssItem(item: string, feedLanguage: string | null): NormalisedNewsItem | null {
  const headline = textOf(firstElement(item, 'title'));
  const url = textOf(firstElement(item, 'link'));
  if (headline === null || url === null) return null;
  const guid = textOf(firstElement(item, 'guid'));
  return {
    externalId: guid ?? url,
    url,
    headline,
    summary: textOf(firstElement(item, 'description')),
    byline: textOf(firstElement(item, 'creator')) ?? textOf(firstElement(item, 'author')),
    publishedAt: isoDate(firstElement(item, 'pubDate')),
    language: feedLanguage,
  };
}

function atomEntry(
  entry: string,
  feedLanguage: string | null,
  entryLanguage: string | null,
): NormalisedNewsItem | null {
  const headline = textOf(firstElement(entry, 'title'));
  const url = atomLink(entry);
  if (headline === null || url === null) return null;
  const author = firstElement(entry, 'author');
  const id = textOf(firstElement(entry, 'id'));
  return {
    externalId: id ?? url,
    url,
    headline,
    summary: textOf(firstElement(entry, 'summary')),
    byline: author === null ? null : textOf(firstElement(author, 'name')),
    publishedAt:
      isoDate(firstElement(entry, 'published')) ?? isoDate(firstElement(entry, 'updated')),
    language: entryLanguage ?? feedLanguage,
  };
}

/**
 * Every `<name ...>` opening tag with the block it opens, so an attribute on
 * the element itself (`<entry xml:lang="ca">`) is read from the tag and not
 * searched for inside the block, where the first `xml:lang` found could be a
 * child's.
 */
function taggedBlocks(xml: string, name: string): { tag: string; inner: string }[] {
  const found: { tag: string; inner: string }[] = [];
  const pattern = new RegExp(
    `(<(?:[a-zA-Z0-9_-]+:)?${name}(?:\\s[^>]*)?>)([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?${name}\\s*>`,
    'gi',
  );
  for (const match of xml.matchAll(pattern))
    found.push({ tag: match[1] ?? '', inner: match[2] ?? '' });
  return found;
}

/**
 * The feed as items. `malformed` when the text is not a feed at all; a feed
 * with no items is a feed with no items, which is a fact and not an error.
 */
export function parseFeed(xml: string): ParsedFeed | FeedProblem {
  const text = xml.trimStart();
  if (text === '' || !text.startsWith('<')) {
    return { kind: 'malformed', message: 'not XML' };
  }
  const isAtom =
    /<feed[\s>]/i.test(text) && /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(text);
  const isRss = /<rss[\s>]/i.test(text) || /<channel[\s>]/i.test(text);
  if (!isAtom && !isRss) {
    return { kind: 'malformed', message: 'neither an RSS channel nor an Atom feed' };
  }

  if (isAtom) {
    const head = text.replace(/<entry[\s>][\s\S]*$/i, '');
    const language = firstAttribute(text, 'feed', 'xml:lang');
    const items: NormalisedNewsItem[] = [];
    let skipped = 0;
    for (const { tag, inner } of taggedBlocks(text, 'entry')) {
      const item = atomEntry(inner, language, firstAttribute(tag, 'entry', 'xml:lang'));
      if (item === null) skipped += 1;
      else items.push(item);
    }
    return { kind: 'atom', title: textOf(firstElement(head, 'title')), language, items, skipped };
  }

  const channel = firstElement(text, 'channel') ?? text;
  const head = channel.replace(/<item[\s>][\s\S]*$/i, '');
  const language = textOf(firstElement(head, 'language'));
  const items: NormalisedNewsItem[] = [];
  let skipped = 0;
  for (const item of blocks(channel, 'item')) {
    const parsed = rssItem(item, language);
    if (parsed === null) skipped += 1;
    else items.push(parsed);
  }
  return { kind: 'rss', title: textOf(firstElement(head, 'title')), language, items, skipped };
}

/** What a feed request that did not yield a feed means, in the adapter's terms. */
function failure(status: number, message: string): AdapterError {
  const kind: AdapterError['kind'] =
    status === 429 ? 'quota' : status >= 500 || status === 599 ? 'transport' : 'http';
  return { kind, message, status };
}

/**
 * Fetch and parse one feed through the shared transport.
 *
 * A body that arrived as JSON is not a feed: the transport parses JSON bodies
 * for the football adapters, and a feed URL that answers JSON is answering
 * with something else, which is reported as `malformed` rather than read as
 * empty.
 */
export async function readFeed(
  transport: Transport,
  url: string,
): Promise<AdapterResult<ParsedFeed>> {
  const response = await transport.request(url, {
    method: 'GET',
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
  });
  if (response.status !== 200) {
    return {
      ok: false,
      error: failure(response.status, `feed answered ${response.status}`),
      requests: 1,
    };
  }
  if (typeof response.body !== 'string') {
    return {
      ok: false,
      error: { kind: 'malformed', message: 'the feed URL answered something that is not XML' },
      requests: 1,
    };
  }
  const parsed = parseFeed(response.body);
  if ('kind' in parsed && parsed.kind === 'malformed') {
    return { ok: false, error: { kind: 'malformed', message: parsed.message }, requests: 1 };
  }
  return { ok: true, data: parsed as ParsedFeed, requests: 1, fetchedAt: response.receivedAt };
}
