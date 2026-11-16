/**
 * Posts to X and Instagram (T-1834, D-427): the kinds, the networks, a post's
 * states, the automation levels and the frozen card payload.
 *
 * The runtime values are exported on the console's entry point
 * (`@fmip/contracts/console`) only; the types are in the barrel. Not to be
 * confused with `social.ts`, which is the friends graph (blueprint 8.1).
 *
 * One post is one row per (fixture, kind, network). What it publishes is
 * frozen when it is drafted: its text, its card's payload, its inputs and the
 * gates as checked. A post is never edited in place; an edit is a new row.
 */

/**
 * Phase 1's three kinds. Each carries at most one prediction product (rule 6):
 * the forecast and the verdict name only the statistical model, the result
 * names none.
 */
export const SOCIAL_POST_KINDS = ['forecast_pre_match', 'model_verdict', 'result'] as const;
export type SocialPostKind = (typeof SOCIAL_POST_KINDS)[number];

export const SOCIAL_NETWORKS = ['x', 'instagram'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/**
 * Where a post stands.
 * - `pending_approval`: drafted, waiting for a console person (or, for an
 *   automatic kind, for the job's own approval).
 * - `approved`: may be published at the network's next free slot.
 * - `publishing`: claimed, its slot taken, the network being asked.
 * - `published`: the network answered with a reference. Final.
 * - `refused`: the network answered and posted nothing; tried again at the
 *   next slot while the post is still valid. The slot is given back.
 * - `unknown`: no answer. Never retried by the job; a person settles it as
 *   `published` or `refused` from Buffer. Keeps its slot.
 * - `rejected`: a person said no, with a reason. Final.
 * - `expired`: kick-off passed, the day ended, or a gate failed. Final.
 * - `superseded`: the forecast the site shows changed. Final; a new row is drafted.
 */
export const SOCIAL_POST_STATES = [
  'pending_approval',
  'approved',
  'publishing',
  'published',
  'refused',
  'unknown',
  'rejected',
  'expired',
  'superseded',
] as const;
export type SocialPostState = (typeof SOCIAL_POST_STATES)[number];

/** The states that end a post; any other is live, and one live row per (fixture, kind, network). */
export const SOCIAL_POST_FINAL_STATES = ['published', 'rejected', 'expired', 'superseded'] as const;

/** The states holding a slot of the network's day. */
export const SOCIAL_POST_SLOT_STATES = ['publishing', 'published', 'unknown'] as const;

/** `template`: a fixed template over our own data. `llm`: reserved (D-070), never automatic. */
export const SOCIAL_POST_ORIGINS = ['template', 'llm'] as const;
export type SocialPostOrigin = (typeof SOCIAL_POST_ORIGINS)[number];

export const SOCIAL_AUTOMATION_LEVELS = ['approval', 'automatic'] as const;
export type SocialAutomationLevel = (typeof SOCIAL_AUTOMATION_LEVELS)[number];

/** The actor name of the job's own approvals and lowerings, with no actor id. */
export const SOCIAL_AUTOMATION_ACTOR = 'automation';

/** Clean posts in a row that make a kind eligible for `automatic` (D-427). */
export const SOCIAL_ELIGIBLE_RUN = 14;

/** At most this many posts a network's day; never padded to reach it. */
export const SOCIAL_DAILY_CAP = 5;

/** The day and the slots are Europe/London's: the cap resets at midnight there. */
export const SOCIAL_TIME_ZONE = 'Europe/London';

/** The slots' local times, for a UK and European audience. Nothing between 23:00 and 07:00. */
export const SOCIAL_SLOT_TIMES = ['08:30', '12:00', '16:30', '19:00', '21:45'] as const;

/**
 * The topics that always send a post to a person (D-427 point 5): the
 * maintainer's five, with violence beside them; `racism` covers every
 * discrimination and `accident` sudden illness too.
 */
export const SOCIAL_SENSITIVE_TOPICS = [
  'politics',
  'accident',
  'death',
  'racism',
  'violence',
  'betting',
] as const;
export type SocialSensitiveTopic = (typeof SOCIAL_SENSITIVE_TOPICS)[number];

/** Why a post is sensitive: a topic a headline matched, or the headlines could not be read (fail closed). */
export type SocialSensitiveReason = SocialSensitiveTopic | 'headlines_unreadable';

/** The current template of each kind; stored on the post as `<kind>@<n>`. */
export const SOCIAL_TEMPLATE_VERSIONS: Readonly<Record<SocialPostKind, number>> = {
  forecast_pre_match: 1,
  model_verdict: 1,
  result: 1,
};

/** The gates checked at drafting and again at publishing (D-427 point 3). */
export const SOCIAL_GATES = [
  'fixture_status',
  'coverage',
  'freshness',
  'score_dispute',
  'forecast_shown',
  'evaluation_stored',
  'one_product',
] as const;
export type SocialGate = (typeof SOCIAL_GATES)[number];

/** The gates as checked, frozen on the post. */
export interface SocialGateCheck {
  checked_at: string;
  passed: boolean;
  failed: SocialGate[];
}

/** A team as a card names it. No crest, logo or photo: there is no image field anywhere in a payload. */
export interface SocialCardTeam {
  id: string;
  name: string;
  short_name: string | null;
  /** The three-letter code where the site has one; the card's badge falls back to two initials. */
  code: string | null;
}

interface SocialCardBase {
  fixture_id: string;
  competition: { id: string; name: string };
  /**
   * The round or stage as the match page's own display label ("Matchday 11",
   * "Round of 16"), never the provider's raw string (D-256, D-323); the
   * card's eyebrow, when known (T-1835).
   */
  round?: string | null;
  kick_off: string;
  home: SocialCardTeam;
  away: SocialCardTeam;
}

/** The statistical model, named with its version (rule 6: the only product on these cards). */
export interface SocialCardModel {
  name: 'The Stadiomind model';
  version: string;
  forecast_id: string;
  /** When the forecast was computed (ISO 8601); the card's source line says it (T-1835, rule 4). */
  computed_at: string;
}

export interface SocialForecastPayload extends SocialCardBase {
  kind: 'forecast_pre_match';
  model: SocialCardModel;
  /** Whole percentages, adding up to 100. */
  percent: { home: number; draw: number; away: number };
}

export type SocialOutcome = 'home' | 'draw' | 'away';

export interface SocialVerdictPayload extends SocialCardBase {
  kind: 'model_verdict';
  model: SocialCardModel;
  /**
   * The score after 90 minutes: the one the evaluation judged the forecast
   * on (D-317; `full_time` in the evaluation store), never the score after
   * extra time or the shoot-out, so the card cannot read "2-1 ... pick: Draw
   * ... right".
   */
  score: { home: number; away: number };
  /**
   * The match went past 90 minutes -- extra time, a shoot-out or both: the
   * card says "after 90 minutes". (Not the result card's flag of the same
   * name, which is extra time alone.)
   */
  after_extra_time: boolean;
  /** The outcome the model gave the most, and its whole percentage. */
  called: SocialOutcome;
  called_percent: number;
  /** The frozen forecast's three shares, as the forecast card drew them; the card's bar when known (T-1835). */
  percent?: { home: number; draw: number; away: number } | null;
  /** The stored evaluation's `correct`, never recomputed (D-209). */
  correct: boolean;
}

export interface SocialResultPayload extends SocialCardBase {
  kind: 'result';
  /** The final score: after extra time when it was played; never a shoot-out's kicks (as `KnockoutLeg.score`). */
  score: { home: number; away: number };
  /**
   * Extra time was played: our records hold an extra-time score (as
   * `KnockoutLeg.after_extra_time`). A tie that went straight from 90 minutes
   * to a shoot-out is `false` with `penalties` set.
   */
  after_extra_time: boolean;
  /** The shoot-out, when there was one, with or without extra time before it. */
  penalties: { home: number; away: number } | null;
  /** The half-time score, when known (T-1835). */
  half_time?: { home: number; away: number } | null;
  /**
   * The goals, in order, when the match's events supply all of them (T-1835).
   * Null or absent when they do not: the card then lists no scorers rather
   * than some of them (rule 3).
   */
  goals?: SocialCardGoal[] | null;
}

/** A goal as the result card lists it: the scorer's name and minute, never a photo. */
export interface SocialCardGoal {
  /** The side the goal counted for (an own goal counts for the other side). */
  side: 'home' | 'away';
  player: string;
  minute: number;
  /** Added time ("45+2"), when the minute is in it. */
  added: number | null;
  kind: 'goal' | 'penalty' | 'own_goal';
}

/** `GET /social-posts/:id/card`: a live post's frozen card payload (T-1835, D-427 point 11). */
export interface SocialCardResponse {
  id: string;
  /**
   * The post has been published: only then is its card kept for good. A post
   * still waiting may yet be rejected, expire or be superseded, after which its
   * card answers 404, so it is never stored anywhere shared.
   */
  published: boolean;
  /** Only the fields a card draws, by kind; nothing else of the stored payload. */
  payload: SocialCardPayload;
}

/** The card's frozen payload. */
export type SocialCardPayload = SocialForecastPayload | SocialVerdictPayload | SocialResultPayload;

/** A kind's automation level and its run of clean posts, as the console shows it. */
export interface SocialAutomation {
  kind: SocialPostKind;
  level: SocialAutomationLevel;
  clean_run: number;
  /** `clean_run >= SOCIAL_ELIGIBLE_RUN`: only the maintainer may then raise it. */
  eligible: boolean;
  level_changed_at: string | null;
  level_changed_by: string | null;
}
