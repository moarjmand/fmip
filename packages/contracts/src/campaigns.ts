/**
 * Campaigns (T-332, D-075): an audience is a saved query, a send is a row.
 *
 * The audience's vocabulary is small and closed on purpose -- what a member
 * follows, where they are, what language they read, whether they verified
 * their address, when they joined -- because every condition here is one a
 * member can see about themselves. Nothing is inferred and nothing is a
 * score. A campaign is the inbox's `campaign` kind: a member who turned that
 * kind off is not reached, and the report says so.
 */
export const AUDIENCE_FOLLOW_TYPES = ['team', 'competition'] as const;
export type AudienceFollowType = (typeof AUDIENCE_FOLLOW_TYPES)[number];

/** Every condition present must hold; an empty filter is every active member. */
export interface AudienceFilter {
  follows?: { type: AudienceFollowType; id: string } | null;
  country_id?: string | null;
  language?: string | null;
  verified_only?: boolean;
  /** ISO 8601 date: members who joined on or after it. */
  joined_after?: string | null;
}

export interface Audience {
  id: string;
  name: string;
  filter: AudienceFilter;
  /** Username of the administrator who saved it. */
  created_by: string | null;
  reason: string;
  created_at: string;
  /** How many active members the filter reaches now; a campaign reaches whoever it is when it is sent. */
  size: number;
}

/** What one send added up to; `finished_at` null while the pass is still running. */
export interface CampaignDispatch {
  started_by: string | null;
  started_at: string;
  audience_size: number;
  reason: string;
  finished_at: string | null;
  reached: number;
  delayed: number;
  muted: number;
  duplicate: number;
  failed: number;
}

export interface Campaign {
  id: string;
  audience_id: string;
  audience_name: string;
  title: string;
  body: string;
  /** The in-app path the notification opens, locale-less (`/match/…`). */
  path: string;
  created_by: string | null;
  reason: string;
  created_at: string;
  /** Null until it is sent; a campaign is sent once. */
  dispatch: CampaignDispatch | null;
}

/** `POST /admin/audiences`. */
export interface CreateAudienceRequest {
  name: string;
  filter: AudienceFilter;
  reason: string;
}

/** `POST /admin/campaigns`. */
export interface CreateCampaignRequest {
  audience_id: string;
  title: string;
  body: string;
  path: string;
  reason: string;
}

/** `POST /admin/campaigns/:id/send`. */
export interface SendCampaignRequest {
  reason: string;
}

export interface AudiencesResponse {
  audiences: Audience[];
}

export interface CampaignsResponse {
  campaigns: Campaign[];
}
