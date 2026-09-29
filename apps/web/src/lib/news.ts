import type {
  NewsEntity,
  NewsSection,
  NewsSectionReason,
  StoryLabelOrigin,
  StoryType,
  StoryVersion,
} from '@fmip/contracts';
import { isNewsSection, isStoryType } from '@fmip/contracts';
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
  /** T-1003 (D-124): a story type, a person by id, and calendar days (`YYYY-MM-DD`). */
  type: StoryType | null;
  player: string | null;
  from: string | null;
  to: string | null;
  before: string | null;
}

/** The filters a reader can set, in the order the query string carries them. */
const FILTER_NAMES = [
  'country',
  'competition',
  'team',
  'language',
  'type',
  'player',
  'from',
  'to',
  'before',
] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  const type = first(params, 'type');
  const day = (name: string): string | null => {
    const v = first(params, name);
    return v !== null && DAY.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())
      ? v
      : null;
  };
  return {
    section: isNewsSection(section) ? section : 'latest',
    country: id('country'),
    competition: id('competition'),
    team: id('team'),
    language: language !== null && LANGUAGE.test(language) ? language : null,
    type: type !== null && isStoryType(type) ? type : null,
    player: id('player'),
    from: day('from'),
    to: day('to'),
    before: before !== null && !Number.isNaN(new Date(before).getTime()) ? before : null,
  };
}

/**
 * The query string for `GET /news`. `tz` is the viewer's zone, so `from` and
 * `to` are their calendar days (D-124); it is sent only with a date.
 */
export function apiQuery(q: NewsPageQuery, timeZone = 'UTC'): string {
  const p = new URLSearchParams({ section: q.section });
  for (const name of FILTER_NAMES) {
    const v = q[name];
    if (v !== null) p.set(name, v);
  }
  if (q.from !== null || q.to !== null) p.set('tz', timeZone);
  return `?${p.toString()}`;
}

/** Whether any filter narrows the list (paging is not a filter). */
export function isFiltered(q: NewsPageQuery): boolean {
  return FILTER_NAMES.some((name) => name !== 'before' && q[name] !== null);
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
  for (const name of FILTER_NAMES) {
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
  discussion_and_saves: 'news.reason.discussionAndSaves',
  nothing_trending: 'news.reason.nothingTrending',
  nothing_selected: 'news.reason.nothingSelected',
  needs_session: 'news.reason.needsSession',
  nothing_followed: 'news.reason.nothingFollowed',
  no_match: 'news.reason.noMatch',
  nothing_yet: 'news.reason.nothingYet',
  persons_unlinked: 'news.reason.personsUnlinked',
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

/** Each story type's name (T-1001); total, so a new type fails the build until it has one. */
export const STORY_TYPE_KEY: Record<StoryType, MessageKey> = {
  breaking_news: 'story.type.breakingNews',
  transfer: 'story.type.transfer',
  injury: 'story.type.injury',
  suspension: 'story.type.suspension',
  tactical_analysis: 'story.type.tacticalAnalysis',
  match_preview: 'story.type.matchPreview',
  match_report: 'story.type.matchReport',
  interview: 'story.type.interview',
  opinion: 'story.type.opinion',
  data_analysis: 'story.type.dataAnalysis',
  explainer: 'story.type.explainer',
};

/** Whose word a type is (D-123); total, so a new origin fails the build until it has a sentence. */
export const LABEL_ORIGIN_KEY: Record<StoryLabelOrigin, MessageKey> = {
  publisher: 'story.type.origin.publisher',
  editor: 'story.type.origin.editor',
};
