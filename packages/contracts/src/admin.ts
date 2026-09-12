import type { CoverageState } from './coverage';
import type { IngestionHealth } from './health';

/**
 * The minimal administration area (blueprint 16, T-070, D-046): what an
 * operator needs to see before the provider jobs exist — coverage per
 * season, freshness, ingest failures, member search — and the two
 * high-impact actions that write an audit record. Every endpoint is
 * `/admin/...` and needs the `admin` role.
 */

export interface CoverageStatusRow {
  season: { id: string; label: string; is_current: boolean };
  competition: { id: string; name: string };
  module: string;
  state: CoverageState;
  provider: string | null;
  note: string | null;
}

/** Live-data freshness per current season, from the fixtures we hold. */
export interface FreshnessRow {
  season: { id: string; label: string };
  competition: { id: string; name: string };
  fixtures: number;
  live: number;
  /** Live fixtures unchanged for longer than the stale threshold (T-083). */
  live_behind: number;
  /** ISO 8601, the newest change to any fixture of the season; null with none. */
  last_change_at: string | null;
}

/** The rule objects in force, by version. Read-only: a change is a versioned code change (D-035, D-036). */
export interface RatingConfig {
  formula: { version: string } & Record<string, unknown>;
  points: { version: string } & Record<string, unknown>;
  eligibility: { version: string } & Record<string, unknown>;
  leaderboard: { version: string } & Record<string, unknown>;
}

/** `GET /admin/overview`. */
export interface AdminOverview {
  checked_at: string;
  coverage: CoverageStatusRow[];
  freshness: FreshnessRow[];
  ingestion: IngestionHealth;
  rating: RatingConfig;
}

export type AccountStatus = 'active' | 'suspended' | 'deleted';

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  email: string;
  status: AccountStatus;
  email_verified: boolean;
  roles: string[];
  created_at: string;
}

/** `GET /admin/users?q=`. */
export interface AdminUsersResponse {
  query: string;
  users: AdminUser[];
}

/** `POST /admin/users/:id/status`. */
export interface SetUserStatusRequest {
  status: Exclude<AccountStatus, 'deleted'>;
  reason: string;
}

/** `PUT /admin/coverage/:seasonId/:module`. */
export interface SetCoverageRequest {
  state: CoverageState;
  provider?: string | null;
  note?: string | null;
  reason: string;
}

/** One audit_log row (rule 10). */
export interface AuditRecord {
  id: string;
  actor: { id: string; username: string };
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  previous: unknown;
  next: unknown;
  created_at: string;
}

/** `GET /admin/audit?limit=`, newest first. */
export interface AuditResponse {
  records: AuditRecord[];
}
