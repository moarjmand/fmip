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
    | 'internal';
  message: string;
  /** On an `internal` error: the request id to quote when reporting it (T-071). */
  request_id?: string;
  fields?: Record<string, string>;
}
