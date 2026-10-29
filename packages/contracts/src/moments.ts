import type { ScoreCard } from './scores';

/**
 * Today's moments that matter (T-1641, D-299): the site's top bar, up to
 * `MOMENTS_LIMIT` matches picked by what is happening on the pitch and what
 * the published statistical model expected before kick-off.
 */
export type MomentKind =
  | 'followed' // a match of a team the viewer follows, when no other kind applies
  | 'against_forecast' // live, minute >= 60, the leading side had a pre-kick-off published chance <= 0.35
  | 'level_late' // live, minute >= 75, score level
  | 'favourite_held' // live, after half time (minute >= 46), the side the model gave >= 0.65 is not winning
  | 'big_one' // today's big match, not started yet (the same match the home page calls the big one)
  | 'starting_soon' // an important match kicking off within 30 minutes
  | 'closest_call' // the most even published forecast among matches kicking off in the next 12 hours (lowest max(p))
  | 'upset' // finished in the last 12 hours, the winner had a pre-kick-off chance <= 0.30
  | 'coming_up'; // fallback on a quiet day: next big matches of the top competitions within 72 hours

/** Every kind, in the order a fixture's kind is picked and moments are ranked (D-299). */
export const MOMENT_KINDS: readonly MomentKind[] = [
  'followed',
  'against_forecast',
  'level_late',
  'favourite_held',
  'big_one',
  'starting_soon',
  'closest_call',
  'upset',
  'coming_up',
];

/** At most this many moments in an answer. */
export const MOMENTS_LIMIT = 8;

export interface MomentForecast {
  home: number;
  draw: number;
  away: number;
  model_version: string;
  computed_at: string;
}

export interface Moment {
  kind: MomentKind;
  followed: boolean; // the viewer follows one of the two teams
  fixture: ScoreCard; // same shape /scores returns (crests and logo attached, localised names with ?locale=)
  forecast: MomentForecast | null; // the LATEST published forecast computed BEFORE kick-off; null when none (never invent one)
  side: 'home' | 'away' | null; // the side the moment is about (leader for against_forecast and upset, favourite for favourite_held), null otherwise
  minutes_left: number | null; // level_late only: max(0, 90 - minute)
}

export interface MomentsResponse {
  generated_at: string; // ISO
  timezone: string; // the zone "today" was computed in
  live_count: number; // matches in play now, all competitions
  today_count: number; // matches today in the zone, all competitions
  moments: Moment[]; // at most 8, ranked
}
