import type { ScoreLine } from './scores';

/**
 * The Following feed (blueprint 12.1, T-333): what is happening around the
 * teams, competitions and contributors a member follows, **ranked from
 * qualified signals and never from raw volume**, and saying what it is
 * showing. Raw views rank whatever was already seen; a feed ranked by them
 * shows a member what other people looked at rather than what they follow.
 */
export const FEED_RANKING_VERSION = 'feed-rank@1' as const;

/**
 * The signals the ranking is computed from, each a fact the page can name.
 * There is no `views` and no `posts`: distinct members in a discussion is a
 * qualified signal, the number of posts is volume.
 */
export const FEED_SIGNALS = [
  'follows',
  'favourite',
  'live',
  'imminent',
  'discussed',
  'fresh',
] as const;
export type FeedSignalKind = (typeof FEED_SIGNALS)[number];

export type FeedSignal =
  /** What the member follows that this item is about. Every item has at least one. */
  | {
      kind: 'follows';
      entity_type: 'team' | 'competition' | 'member';
      entity_id: string;
      name: string;
    }
  /** The followed thing is one of the member's favourites (T-042). */
  | { kind: 'favourite'; name: string }
  | { kind: 'live' }
  /** Kicks off within a day. */
  | { kind: 'imminent'; kickoff_at: string }
  /** Distinct members in the match's public discussion inside 48 hours -- members, not posts. */
  | { kind: 'discussed'; participants: number; window_hours: number }
  /** Published inside a day. */
  | { kind: 'fresh'; at: string };

export interface FeedFixture {
  kind: 'fixture';
  fixture_id: string;
  kickoff_at: string;
  status: string;
  competition: { id: string; name: string };
  home: { id: string; name: string };
  away: { id: string; name: string };
  /** The current score, or `null` before kick-off or when none was supplied (rule 3). */
  score: ScoreLine | null;
}

export interface FeedStory {
  kind: 'story';
  story_id: string;
  headline: string;
  language: string;
  /** The publisher's time, or `null` when they gave none. */
  published_at: string | null;
  source_name: string;
  /** The original: where a reader is sent (D-061). */
  url: string;
}

export interface FeedFounderAnalysis {
  kind: 'founder_analysis';
  fixture_id: string;
  published_at: string;
  predicted_outcome: 'home' | 'draw' | 'away';
  confidence: number;
  home: { id: string; name: string };
  away: { id: string; name: string };
}

export interface FeedPanelPost {
  kind: 'panel_post';
  post_id: string;
  fixture_id: string;
  author: { username: string; display_name: string };
  /** The first 280 characters; the panel has the rest. */
  excerpt: string;
  created_at: string;
  home: { id: string; name: string };
  away: { id: string; name: string };
}

export type FeedItemBody = FeedFixture | FeedStory | FeedFounderAnalysis | FeedPanelPost;

export type FeedItem = FeedItemBody & {
  /** The moment the item is about: kick-off, publication, or the post. */
  at: string;
  /** Why it is here and why it is where it is. Rendered, not hidden. */
  because: FeedSignal[];
  /** The rank the signals add up to, so two readers can compare two feeds. Not a match score. */
  rank: number;
};

export type FollowingFeedReason =
  /** The member follows nothing yet. */
  | 'nothing_followed'
  /** Nothing happened around what they follow inside the window. */
  | 'nothing_in_window';

/** `GET /me/feed`. */
export interface FollowingFeed {
  generated_at: string;
  /** What the feed is computed from: the window, the kinds, and the ranking rule by name. */
  showing: {
    since: string;
    until: string;
    kinds: FeedItemBody['kind'][];
    followed: { teams: number; competitions: number; members: number };
  };
  ranking: { version: typeof FEED_RANKING_VERSION; signals: readonly FeedSignalKind[] };
  items: FeedItem[];
  reason: FollowingFeedReason | null;
}
