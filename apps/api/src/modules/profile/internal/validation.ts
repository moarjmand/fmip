import {
  type FollowRequest,
  PRIVACY_VISIBILITIES,
  type PrivacyVisibility,
  type UpdatePrivacyRequest,
  type UpdateProfileRequest,
} from '@fmip/contracts';

export type Validated<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> };

export const BIO_MAX_LENGTH = 500;
const HTTP_URL = /^https?:\/\/[^\s]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Partial update: absent fields are left alone, `null` clears, anything else must validate. */
export function validateUpdateProfile(body: unknown): Validated<UpdateProfileRequest> {
  const fields: Record<string, string> = {};
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be a JSON object' } };

  const value: UpdateProfileRequest = {};

  if ('display_name' in body) {
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : undefined;
    if (name === undefined || name.length < 1 || name.length > 50) {
      fields.display_name = '1 to 50 characters';
    } else {
      value.display_name = name;
    }
  }

  if ('bio' in body) {
    if (body.bio === null) {
      value.bio = null;
    } else if (typeof body.bio !== 'string' || body.bio.length > BIO_MAX_LENGTH) {
      fields.bio = `at most ${BIO_MAX_LENGTH} characters`;
    } else {
      value.bio = body.bio.trim() === '' ? null : body.bio.trim();
    }
  }

  if ('avatar_url' in body) {
    if (body.avatar_url === null) {
      value.avatar_url = null;
    } else if (
      typeof body.avatar_url !== 'string' ||
      body.avatar_url.length > 2000 ||
      !HTTP_URL.test(body.avatar_url)
    ) {
      fields.avatar_url = 'must be an http(s) URL';
    } else {
      value.avatar_url = body.avatar_url;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (Object.keys(value).length === 0) return { ok: false, fields: { body: 'nothing to update' } };
  return { ok: true, value };
}

function visibility(value: unknown): PrivacyVisibility | undefined {
  return typeof value === 'string' && (PRIVACY_VISIBILITIES as readonly string[]).includes(value)
    ? (value as PrivacyVisibility)
    : undefined;
}

export function validateUpdatePrivacy(body: unknown): Validated<UpdatePrivacyRequest> {
  const fields: Record<string, string> = {};
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be a JSON object' } };

  const value: UpdatePrivacyRequest = {};
  const allowed = PRIVACY_VISIBILITIES.join(', ');

  for (const key of ['profile_visibility', 'prediction_history_visibility'] as const) {
    if (!(key in body)) continue;
    const v = visibility(body[key]);
    if (v === undefined) fields[key] = `must be one of ${allowed}`;
    else value[key] = v;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (Object.keys(value).length === 0) return { ok: false, fields: { body: 'nothing to update' } };
  return { ok: true, value };
}

/** `PUT /me/following/:type/:id` body: an optional favourite flag, nothing else. */
export function validateFollow(body: unknown): Validated<FollowRequest> {
  if (body === undefined || body === null || body === '') return { ok: true, value: {} };
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be a JSON object' } };

  if ('favourite' in body && typeof body.favourite !== 'boolean') {
    return { ok: false, fields: { favourite: 'must be true or false' } };
  }

  return {
    ok: true,
    value: typeof body.favourite === 'boolean' ? { favourite: body.favourite } : {},
  };
}
