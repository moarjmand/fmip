import type { NewsEntity, NewsSection, NewsSectionReason, StoryVersion } from '@fmip/contracts';
import { isNewsSection } from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

type Params = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * The feeds are read hourly (T-142); a page whose newest read is older than
 * this says so rather than presenting the list as current (rule 4).
 */
export const NEWS_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export interface NewsPageQuery {
  section: NewsSection;
  country: string | null;
  competition: string | null;
  team: string | null;
  language: string | null;
  before: string | null;
}

function first(params: Params, name: string): string | null {
  const v = params[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() !== '' ? s.trim() : null;
}

/**
 * The page's query. A malformed filter is dropped here rather than sent on:
 * the API would refuse it with a 400, and a mistyped id in a URL should show
 * a reader the section, not an error page.
 */
export function readNewsQuery(params: Params): NewsPageQuery {
  const section = first(params, 'section') ?? 'latest';
  const id = (name: string): string | null => {
    const v = first(params, name);
    return v !== null && UUID.test(v) ? v.toLowerCase() : null;
  };
  const language = first(params, 'language');
  const before = first(params, 'before');
  return {
    section: isNewsSection(section) ? section : 'latest',
    country: id('country'),
    competition: id('competition'),
    team: id('team'),
    language: language !== null && LANGUAGE.test(language) ? language : null,
    before: before !== null && !Number.isNaN(new Date(before).getTime()) ? before : null,
  };
}

/** The query string for `GET /news`, without the leading `?` when empty. */
export function apiQuery(q: NewsPageQuery): string {
  const p = new URLSearchParams({ section: q.section });
  for (const name of ['country', 'competition', 'team', 'language', 'before'] as const) {
    const v = q[name];
    if (v !== null) p.set(name, v);
  }
  return `?${p.toString()}`;
}

/** The page's own URL for a variant of the query; `before` never carries over unless asked for. */
export function pageHref(
  locale: string,
  q: NewsPageQuery,
  over: Partial<NewsPageQuery> = {},
): string {
  const next: NewsPageQuery = { ...q, before: null, ...over };
  const p = new URLSearchParams();
  if (next.section !== 'latest') p.set('section', next.section);
  for (const name of ['country', 'competition', 'team', 'language', 'before'] as const) {
    const v = next[name];
    if (v !== null) p.set(name, v);
  }
  const s = p.toString();
  return `/${locale}/news${s === '' ? '' : `?${s}`}`;
}

export const SECTION_KEY: Record<NewsSection, MessageKey> = {
  latest: 'news.section.latest',
  trending: 'news.section.trending',
  debate: 'news.section.debate',
  following: 'news.section.following',
};

/** Each reason the API can give, as the sentence the page shows (rule 3). */
export const REASON_KEY: Record<NewsSectionReason, MessageKey> = {
  discussion_only: 'news.reason.discussionOnly',
  nothing_trending: 'news.reason.nothingTrending',
  nothing_selected: 'news.reason.nothingSelected',
  needs_session: 'news.reason.needsSession',
  nothing_followed: 'news.reason.nothingFollowed',
  no_match: 'news.reason.noMatch',
  nothing_yet: 'news.reason.nothingYet',
};

/** Where an entity chip goes: the entity's own page, by id (rule 1). */
export function entityHref(locale: string, entity: NewsEntity): string {
  switch (entity.entity_type) {
    case 'team':
      return `/${locale}/team/${entity.entity_id}`;
    case 'competition':
      return `/${locale}/competition/${entity.entity_id}`;
    case 'person':
      return `/${locale}/player/${entity.entity_id}`;
    case 'fixture':
      return `/${locale}/match/${entity.entity_id}`;
  }
}

/** The story page's query: which of the original's languages to show, if asked. */
export function readStoryQuery(params: Params): { language: string | null } {
  const language = first(params, 'language');
  return { language: language !== null && LANGUAGE.test(language) ? language : null };
}

/** The story page for a card, in a language when one is asked for. */
export function storyHref(locale: string, storyId: string, language: string | null = null): string {
  const base = `/${locale}/news/story/${storyId}`;
  return language === null ? base : `${base}?language=${encodeURIComponent(language)}`;
}

/** Whose words a language version carries, as the three states the page names (T-304). */
export type VersionStatus = 'publisher' | 'translated' | 'reviewed';

export function versionStatus(
  version: Pick<StoryVersion, 'origin' | 'review_state'>,
): VersionStatus {
  if (version.origin === 'publisher') return 'publisher';
  return version.review_state === 'reviewed' ? 'reviewed' : 'translated';
}

/** Total over the states, so a fourth state fails the build until it has a sentence. */
export const VERSION_STATUS_KEY: Record<VersionStatus, MessageKey> = {
  publisher: 'story.version.publisher',
  translated: 'story.version.translated',
  reviewed: 'story.version.reviewed',
};

/** Whether the newest feed read is too old to present the list as current (rule 4). */
export function feedsStale(lastUpdatedAt: string | null, now = new Date()): boolean {
  if (lastUpdatedAt === null) return true;
  return now.getTime() - new Date(lastUpdatedAt).getTime() > NEWS_STALE_AFTER_MS;
}
