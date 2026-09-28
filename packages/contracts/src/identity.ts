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
  /** Must be `true`: acceptance of the platform rules. */
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
    | 'internal';
  message: string;
  /** On an `internal` error: the request id to quote when reporting it (T-071). */
  request_id?: string;
  fields?: Record<string, string>;
}
