import { Injectable } from '@nestjs/common';
import type { FeedItem, FeedSignal, FollowedEntity, FollowingFeed } from '@fmip/contracts';
import { FEED_RANKING_VERSION, FEED_SIGNALS } from '@fmip/contracts';
import { ProfileService } from '../profile/profile.service';
import {
  type FollowedMember,
  PostgresFollowingFeedStore,
  type Window,
} from './internal/following-feed-store';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** How far back and how far ahead the feed looks. Said in `showing`. */
const LOOK_BACK_DAYS = 7;
const LOOK_AHEAD_DAYS = 7;
const DISCUSSION_WINDOW_HOURS = 48;
const EXCERPT = 280;
const LIMIT = 50;

/**
 * The weight each signal carries in `feed-rank@1`. Small integers, so a
 * reader can add them up from the `because` list and get the `score`. A
 * favourite outranks a follow, a live match outranks anything, and a
 * discussion counts for its distinct members up to a ceiling -- more voices,
 * never more posts.
 */
const WEIGHT = {
  favourite: 2,
  live: 3,
  imminent: 2,
  discussed: (participants: number): number => (participants >= 5 ? 2 : participants >= 2 ? 1 : 0),
  fresh: 1,
} as const;

interface Followed {
  teams: Map<string, FollowedEntity>;
  competitions: Map<string, FollowedEntity>;
  members: Map<string, FollowedMember>;
}

/**
 * The Following feed (blueprint 12.1, T-333): what happened, and what is
 * about to, around the teams, competitions and contributors a member
 * follows -- matches, stories, the founder's analyses and followed
 * contributors' posts -- ranked from qualified signals and never from raw
 * volume, each item carrying the reasons it is there and where it is.
 */
@Injectable()
export class FollowingFeedService {
  constructor(
    private readonly store: PostgresFollowingFeedStore,
    private readonly profiles: ProfileService,
  ) {}

  async feed(userId: string, now = new Date()): Promise<FollowingFeed> {
    const [entities, members] = await Promise.all([
      this.profiles.listFollowing(userId),
      this.store.followedMembers(userId),
    ]);
    const followed: Followed = {
      teams: new Map(entities.filter((e) => e.entity_type === 'team').map((e) => [e.entity_id, e])),
      competitions: new Map(
        entities.filter((e) => e.entity_type === 'competition').map((e) => [e.entity_id, e]),
      ),
      members: new Map(members.map((m) => [m.id, m])),
    };
    const window: Window = {
      since: new Date(now.getTime() - LOOK_BACK_DAYS * DAY).toISOString(),
      until: new Date(now.getTime() + LOOK_AHEAD_DAYS * DAY).toISOString(),
    };
    const showing: FollowingFeed['showing'] = {
      since: window.since,
      until: window.until,
      kinds: ['fixture', 'story', 'founder_analysis', 'panel_post'],
      followed: {
        teams: followed.teams.size,
        competitions: followed.competitions.size,
        members: followed.members.size,
      },
    };
    const ranking: FollowingFeed['ranking'] = {
      version: FEED_RANKING_VERSION,
      signals: FEED_SIGNALS,
    };
    const nothingFollowed =
      followed.teams.size === 0 && followed.competitions.size === 0 && followed.members.size === 0;
    if (nothingFollowed) {
      return {
        generated_at: now.toISOString(),
        showing,
        ranking,
        items: [],
        reason: 'nothing_followed',
      };
    }

    const teams = [...followed.teams.keys()];
    const competitions = [...followed.competitions.keys()];
    const [fixtures, stories, analyses, posts] = await Promise.all([
      this.store.fixtures(teams, competitions, window),
      this.store.stories(teams, competitions, window),
      this.store.analyses(teams, competitions, window),
      this.store.posts([...followed.members.keys()], window),
    ]);

    const items: FeedItem[] = [];
    for (const f of fixtures) {
      const because = this.aboutMatch(followed, f.home_id, f.away_id, f.competition_id);
      if (f.status === 'live') because.push({ kind: 'live' });
      const kickoff = f.kickoff_at.getTime();
      if (kickoff > now.getTime() && kickoff - now.getTime() <= DAY) {
        because.push({ kind: 'imminent', kickoff_at: f.kickoff_at.toISOString() });
      }
      if (f.participants > 0) {
        because.push({
          kind: 'discussed',
          participants: f.participants,
          window_hours: DISCUSSION_WINDOW_HOURS,
        });
      }
      items.push({
        kind: 'fixture',
        fixture_id: f.id,
        kickoff_at: f.kickoff_at.toISOString(),
        status: f.status,
        competition: { id: f.competition_id, name: f.competition_name },
        home: { id: f.home_id, name: f.home_name },
        away: { id: f.away_id, name: f.away_name },
        score:
          f.score_home === null || f.score_away === null
            ? null
            : { home: f.score_home, away: f.score_away },
        at: f.kickoff_at.toISOString(),
        because,
        rank: rank(because),
      });
    }
    for (const s of stories) {
      const because: FeedSignal[] = [];
      for (const id of s.team_ids) this.follows(followed.teams.get(id), because);
      for (const id of s.competition_ids) this.follows(followed.competitions.get(id), because);
      if (because.length === 0) continue;
      const at = s.published_at ?? s.fetched_at;
      if (now.getTime() - at.getTime() <= DAY)
        because.push({ kind: 'fresh', at: at.toISOString() });
      items.push({
        kind: 'story',
        story_id: s.story_id,
        headline: s.headline,
        language: s.language,
        published_at: s.published_at?.toISOString() ?? null,
        source_name: s.source_name,
        url: s.url,
        at: at.toISOString(),
        because,
        rank: rank(because),
      });
    }
    for (const a of analyses) {
      const because = this.aboutMatch(followed, a.home_id, a.away_id, a.competition_id);
      if (now.getTime() - a.published_at.getTime() <= 2 * DAY) {
        because.push({ kind: 'fresh', at: a.published_at.toISOString() });
      }
      items.push({
        kind: 'founder_analysis',
        fixture_id: a.fixture_id,
        published_at: a.published_at.toISOString(),
        predicted_outcome: a.predicted_outcome,
        confidence: a.confidence,
        home: { id: a.home_id, name: a.home_name },
        away: { id: a.away_id, name: a.away_name },
        at: a.published_at.toISOString(),
        because,
        rank: rank(because),
      });
    }
    for (const p of posts) {
      const member = followed.members.get(p.author_id);
      if (member === undefined) continue;
      const because: FeedSignal[] = [
        { kind: 'follows', entity_type: 'member', entity_id: member.id, name: member.display_name },
      ];
      if (now.getTime() - p.created_at.getTime() <= DAY) {
        because.push({ kind: 'fresh', at: p.created_at.toISOString() });
      }
      items.push({
        kind: 'panel_post',
        post_id: p.post_id,
        fixture_id: p.fixture_id,
        author: { username: p.username, display_name: p.display_name },
        excerpt: p.body.length > EXCERPT ? `${p.body.slice(0, EXCERPT - 1)}…` : p.body,
        created_at: p.created_at.toISOString(),
        home: { id: p.home_id, name: p.home_name },
        away: { id: p.away_id, name: p.away_name },
        at: p.created_at.toISOString(),
        because,
        rank: rank(because),
      });
    }

    // Highest rank first; among equals, what is nearest to now -- a kick-off
    // in an hour and a story from an hour ago are both nearer than last week.
    items.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      const da = Math.abs(new Date(a.at).getTime() - now.getTime());
      const db = Math.abs(new Date(b.at).getTime() - now.getTime());
      return da - db;
    });
    const shown = items.slice(0, LIMIT);
    return {
      generated_at: now.toISOString(),
      showing,
      ranking,
      items: shown,
      reason: shown.length === 0 ? 'nothing_in_window' : null,
    };
  }

  private follows(entity: FollowedEntity | undefined, into: FeedSignal[]): void {
    if (entity === undefined) return;
    into.push({
      kind: 'follows',
      entity_type: entity.entity_type === 'team' ? 'team' : 'competition',
      entity_id: entity.entity_id,
      name: entity.name,
    });
    if (entity.favourite) into.push({ kind: 'favourite', name: entity.name });
  }

  private aboutMatch(
    followed: Followed,
    homeId: string,
    awayId: string,
    competitionId: string,
  ): FeedSignal[] {
    const because: FeedSignal[] = [];
    this.follows(followed.teams.get(homeId), because);
    this.follows(followed.teams.get(awayId), because);
    this.follows(followed.competitions.get(competitionId), because);
    return because;
  }
}

/** `feed-rank@1`: the signals' weights added up. `follows` is inclusion, not rank. */
export function rank(because: FeedSignal[]): number {
  let score = 0;
  for (const signal of because) {
    switch (signal.kind) {
      case 'follows':
        break;
      case 'favourite':
        score += WEIGHT.favourite;
        break;
      case 'live':
        score += WEIGHT.live;
        break;
      case 'imminent':
        score += WEIGHT.imminent;
        break;
      case 'discussed':
        score += WEIGHT.discussed(signal.participants);
        break;
      case 'fresh':
        score += WEIGHT.fresh;
        break;
    }
  }
  return score;
}
