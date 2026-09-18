import type {
  FeedItem,
  FeedItemBody,
  FeedSignal,
  FeedSignalKind,
  FollowingFeedReason,
} from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

/** Each kind of item, named in words. Total, so a fifth kind fails the build until it has one. */
export const KIND_KEY: Record<FeedItemBody['kind'], MessageKey> = {
  fixture: 'feed.kind.fixture',
  story: 'feed.kind.story',
  founder_analysis: 'feed.kind.founderAnalysis',
  panel_post: 'feed.kind.panelPost',
};

/**
 * Each signal the ranking is computed from, as the words the page shows
 * beside an item (T-333: the feed says why). `discussed` is a plural and is
 * rendered with its count; the others are labels the value follows.
 */
export const SIGNAL_KEY: Record<FeedSignalKind, MessageKey> = {
  follows: 'feed.signal.follows',
  favourite: 'feed.signal.favourite',
  live: 'feed.signal.live',
  imminent: 'feed.signal.imminent',
  discussed: 'feed.signal.discussed',
  fresh: 'feed.signal.fresh',
};

export const REASON_KEY: Record<FollowingFeedReason, MessageKey> = {
  nothing_followed: 'feed.reason.nothingFollowed',
  nothing_in_window: 'feed.reason.nothingInWindow',
};

/** The value a signal carries, when it has one to show beside its label. */
export function signalValue(signal: FeedSignal): string | null {
  switch (signal.kind) {
    case 'follows':
      return signal.name;
    case 'favourite':
      return signal.name;
    case 'discussed':
      return null;
    case 'live':
    case 'imminent':
    case 'fresh':
      return null;
  }
}

/** Where an item goes: the thing it is about, by id (rule 1). */
export function feedItemHref(locale: string, item: FeedItem): string {
  switch (item.kind) {
    case 'fixture':
      return `/${locale}/match/${item.fixture_id}`;
    case 'story':
      return `/${locale}/news/story/${item.story_id}`;
    case 'founder_analysis':
      return `/${locale}/match/${item.fixture_id}`;
    case 'panel_post':
      return `/${locale}/match/${item.fixture_id}`;
  }
}

/** The line that names an item: the two teams, the headline, or the author. */
export function feedItemTitle(item: FeedItem): string {
  switch (item.kind) {
    case 'fixture':
      return `${item.home.name} – ${item.away.name}`;
    case 'story':
      return item.headline;
    case 'founder_analysis':
      return `${item.home.name} – ${item.away.name}`;
    case 'panel_post':
      return `${item.author.display_name} on ${item.home.name} – ${item.away.name}`;
  }
}

/** A stable key for a list of items that can hold two kinds about one match. */
export function feedItemKey(item: FeedItem): string {
  switch (item.kind) {
    case 'fixture':
      return `fixture:${item.fixture_id}`;
    case 'story':
      return `story:${item.story_id}`;
    case 'founder_analysis':
      return `analysis:${item.fixture_id}`;
    case 'panel_post':
      return `post:${item.post_id}`;
  }
}
