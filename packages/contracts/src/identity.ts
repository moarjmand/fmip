/**
 * `/auth/*` on `apps/api` (T-040).
 *
 * The session itself travels in an HttpOnly cookie, never in a body, so no
 * type here carries a token. The one-time tokens for e-mail verification and
 * password reset arrive by e-mail and are posted back once.
 */

/** The signed-in member, as the API describes them to the web app. */
export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  email: string;
  /** `false` until the verification link is used. Predictions require `true`. */
  email_verified: boolean;
  country_id: string;
  /** BCP 47 tag, e.g. `en`. */
  preferred_language: string;
  /** IANA zone, e.g. `Asia/Tehran`. */
  timezone: string;
  /** ISO 8601. */
  created_at: string;
}

export interface SessionResponse {
  user: AuthUser;
  /** Which platform rules apply to the member, and whether a newer version awaits them (T-931). */
  rules: PlatformRulesStanding;
}

/**
 * The platform rules a member accepts (13-policy.md, T-931, D-113). Each
 * version is published once and never changed: `platform-rules@1.0.0`,
 * `platform-rules@1.1.0`. The one in force is the highest version number.
 */
export interface PlatformRules {
  /** e.g. `platform-rules@1.1.0`. */
  version: string;
  /** ISO 8601. */
  published_at: string;
  /**
   * The text, in English as approved: paragraphs separated by a blank line; a
   * paragraph whose every line starts with `- ` is a list.
   */
  body: string;
}

/**
 * A member and the platform rules. A newer published version does not apply
 * to them until they accept it; until then the version they accepted does,
 * and nothing they wrote is hidden or held back meanwhile.
 */
export interface PlatformRulesStanding {
  /** The newest published version. */
  current: string;
  /** The version that applies to this member: the last one they accepted. */
  accepted: string;
  /** ISO 8601: when `accepted` was accepted. */
  accepted_at: string;
  /** `true` while `current` is newer than `accepted`: the member is asked to accept it. */
  pending: boolean;
}

/**
 * `POST /auth/rules/accept`. The version the member read; it must be the one
 * in force, so a version published while they were reading is not accepted
 * on their behalf (409). Accepting the version already accepted is a no-op.
 * Answers 200 with the member's `PlatformRulesStanding`.
 */
export interface AcceptPlatformRulesRequest {
  version: string;
}

/** `POST /auth/register`. Every field is required (blueprint 7.1). */
export interface RegisterRequest {
  /** 3 to 20 characters: lower-case letters, digits, underscore. */
  username: string;
  display_name: string;
  email: string;
  /** 10 to 128 characters. */
  password: string;
  country_id: string;
  preferred_language: string;
  timezone: string;
  /** Must be `true`: acceptance of the platform rules in force (recorded with its version, T-931). */
  accept_rules: boolean;
}

/** `POST /auth/login`. `identifier` is a username or an e-mail address. */
export interface LoginRequest {
  identifier: string;
  password: string;
}

/** `POST /auth/verify-email`. */
export interface VerifyEmailRequest {
  token: string;
}

/** `POST /auth/password/forgot`. Always answers 202, whether or not the address is known. */
export interface ForgotPasswordRequest {
  email: string;
}

/** `POST /auth/password/reset`. Succeeding revokes every session of the account. */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}

/**
 * `POST /auth/account/delete` (T-812, D-094). The member's password, and their
 * username typed again as the confirmation. Answers 204 and clears the session
 * cookie; every session of the account is gone with it.
 */
export interface DeleteAccountRequest {
  password: string;
  /** Must equal the member's username exactly. */
  confirm: string;
}

/**
 * The username a deleted account is left with (D-094): `deleted_` and twelve
 * hex digits. No live account can hold one (the database refuses it), so a
 * reader that meets it -- a message's author, a panel post's -- shows "a
 * deleted member" and links nowhere.
 */
export const DELETED_USERNAME_PATTERN = /^deleted_[0-9a-f]{12}$/;

export function isDeletedMember(username: string): boolean {
  return DELETED_USERNAME_PATTERN.test(username);
}

/**
 * The error body every `apps/api` endpoint uses. `fields` names the offending
 * request fields for validation and conflict errors.
 */
export interface ApiError {
  error:
    | 'validation'
    | 'conflict'
    | 'unauthenticated'
    | 'invalid_token'
    | 'not_found'
    | 'email_unverified'
    | 'locked'
    // T-213: the request was well formed and the caller has simply done this
    // too often. Its own kind rather than a `validation` error because the
    // answer is different: wait, rather than fix the input.
    | 'rate_limited'
    // T-904 (D-108): signed in, but not allowed. Always a 403. `unauthenticated`
    // is "who are you" and stays the 401; `email_unverified` stays its own code
    // because its answer is different (verify, then try again).
    | 'forbidden'
    | 'internal';
  message: string;
  /** On an `internal` error: the request id to quote when reporting it (T-071). */
  request_id?: string;
  fields?: Record<string, string>;
}

/** The roles a console refusal names (D-108). Each admits an administrator too. */
export type RefusedRole = 'administrator' | 'editor' | 'moderator' | 'operator';

/**
 * A 403's body: signed in, and not allowed (D-108). A refusal says only that,
 * and which role would be allowed; it never carries fields or data.
 */
export function forbidden(message: string): ApiError {
  return { error: 'forbidden', message };
}

/**
 * The one refusal body per role (T-904, D-108), so every controller gated on
 * a role answers the same sentence rather than its own. `operator` is the
 * featured-match panel's operator: a moderator or an administrator.
 */
export const ROLE_REFUSALS: Readonly<Record<RefusedRole, ApiError>> = {
  administrator: forbidden('This needs the administrator role.'),
  editor: forbidden('This needs the editor or administrator role.'),
  moderator: forbidden('This needs the moderator or administrator role.'),
  operator: forbidden('Operating a match panel needs the moderator or administrator role.'),
};
