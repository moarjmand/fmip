import type {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from '@fmip/contracts';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password';
import { isWellFormedToken } from './tokens';

/**
 * Request validation, by hand and per field, producing the `fields` map the
 * `ApiError` contract promises. Normalisation happens here too (lower-cased
 * username and e-mail) so the service and the database see one spelling.
 */

export type Validated<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> };

export const USERNAME = /^[a-z0-9_]{3,20}$/;
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMEZONES = new Set<string>(Intl.supportedValuesOf('timeZone'));
// The runtime's list omits the aliases people actually type.
TIMEZONES.add('UTC');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Password rules: length, and not trivially derived from the account's own
 * identifiers. Anything cleverer (breach lists) is a later, networked check.
 */
export function passwordProblem(
  password: string | undefined,
  identifiers: readonly string[] = [],
): string | undefined {
  if (password === undefined) return 'required';
  if (password.length < PASSWORD_MIN_LENGTH) return `at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `at most ${PASSWORD_MAX_LENGTH} characters`;

  const lowered = password.toLowerCase();
  for (const identifier of identifiers) {
    const needle = identifier.toLowerCase();
    if (needle.length >= 3 && lowered.includes(needle))
      return 'must not contain your username or e-mail';
  }

  return undefined;
}

export function validateRegister(body: unknown): Validated<RegisterRequest> {
  const fields: Record<string, string> = {};
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be a JSON object' } };

  const username = str(body.username)?.trim().toLowerCase();
  if (username === undefined || !USERNAME.test(username)) {
    fields.username = '3 to 20 characters: lower-case letters, digits, underscore';
  }

  const displayName = str(body.display_name)?.trim();
  if (displayName === undefined || displayName.length < 1 || displayName.length > 50) {
    fields.display_name = '1 to 50 characters';
  }

  const email = str(body.email)?.trim().toLowerCase();
  if (email === undefined || email.length > 254 || !EMAIL.test(email)) {
    fields.email = 'must be an e-mail address';
  }

  const password = str(body.password);
  const localPart = email?.split('@')[0];
  const problem = passwordProblem(
    password,
    [username, localPart].filter((v): v is string => v !== undefined),
  );
  if (problem !== undefined) fields.password = problem;

  const countryId = str(body.country_id);
  if (countryId === undefined || !UUID.test(countryId)) fields.country_id = 'must be a country id';

  const language = str(body.preferred_language)?.trim();
  if (language === undefined || !LANGUAGE_TAG.test(language)) {
    fields.preferred_language = 'must be a language tag such as en';
  }

  const timezone = str(body.timezone)?.trim();
  if (timezone === undefined || !TIMEZONES.has(timezone)) {
    fields.timezone = 'must be an IANA time zone such as Asia/Tehran';
  }

  if (body.accept_rules !== true) fields.accept_rules = 'the platform rules must be accepted';

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      username: username as string,
      display_name: displayName as string,
      email: email as string,
      password: password as string,
      country_id: countryId as string,
      preferred_language: language as string,
      timezone: timezone as string,
      accept_rules: true,
    },
  };
}

export function validateLogin(body: unknown): Validated<LoginRequest> {
  const fields: Record<string, string> = {};
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be a JSON object' } };

  const identifier = str(body.identifier)?.trim().toLowerCase();
  if (identifier === undefined || identifier === '' || identifier.length > 254) {
    fields.identifier = 'required';
  }

  const password = str(body.password);
  if (password === undefined || password === '' || password.length > PASSWORD_MAX_LENGTH) {
    fields.password = 'required';
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { identifier: identifier as string, password: password as string } };
}

export function validateToken(body: unknown): Validated<VerifyEmailRequest> {
  if (!isRecord(body) || !isWellFormedToken(body.token)) {
    return { ok: false, fields: { token: 'required' } };
  }
  return { ok: true, value: { token: body.token } };
}

export function validateForgotPassword(body: unknown): Validated<ForgotPasswordRequest> {
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be a JSON object' } };

  const email = str(body.email)?.trim().toLowerCase();
  if (email === undefined || email.length > 254 || !EMAIL.test(email)) {
    return { ok: false, fields: { email: 'must be an e-mail address' } };
  }
  return { ok: true, value: { email } };
}

export function validateResetPassword(body: unknown): Validated<ResetPasswordRequest> {
  const fields: Record<string, string> = {};
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be a JSON object' } };

  if (!isWellFormedToken(body.token)) fields.token = 'required';

  const password = str(body.password);
  const problem = passwordProblem(password);
  if (problem !== undefined) fields.password = problem;

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { token: body.token as string, password: password as string } };
}
