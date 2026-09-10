'use server';

import type {
  FollowRequest,
  FollowingResponse,
  LoginRequest,
  OwnProfile,
  RegisterRequest,
  SessionResponse,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
} from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ApiResult, apiRequest } from './api';
import { applyApiSetCookie, sessionCookieHeader } from './session';

/**
 * What a form gets back. `null` before the first submit; `ok: true` for an
 * action that stays on the page; field errors come straight from the API's
 * `ApiError.fields`, so the web app never re-implements a validation rule.
 */
export type ActionState =
  | null
  | { ok: true; message?: string }
  | { ok: false; message: string; fields?: Record<string, string> };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function failure<T>(result: Extract<ApiResult<T>, { ok: false }>): ActionState {
  if (result.status === 0) {
    return {
      ok: false,
      message: 'The service is unreachable right now. Please try again shortly.',
    };
  }
  return {
    ok: false,
    message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
    ...(result.error?.fields ? { fields: result.error.fields } : {}),
  };
}

export async function registerAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body: RegisterRequest = {
    username: text(formData, 'username'),
    display_name: text(formData, 'display_name'),
    email: text(formData, 'email'),
    password: text(formData, 'password'),
    country_id: text(formData, 'country_id'),
    preferred_language: text(formData, 'preferred_language'),
    timezone: text(formData, 'timezone'),
    accept_rules: formData.get('accept_rules') === 'on',
  };

  const result = await apiRequest<SessionResponse>('/auth/register', { method: 'POST', body });
  if (!result.ok) return failure(result);

  await applyApiSetCookie(result.setCookie);
  redirect(`/${locale}/u/${encodeURIComponent(result.data.user.username)}`);
}

export async function loginAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body: LoginRequest = {
    identifier: text(formData, 'identifier'),
    password: text(formData, 'password'),
  };

  const result = await apiRequest<SessionResponse>('/auth/login', { method: 'POST', body });
  if (!result.ok) return failure(result);

  await applyApiSetCookie(result.setCookie);
  redirect(`/${locale}/u/${encodeURIComponent(result.data.user.username)}`);
}

export async function logoutAction(locale: string): Promise<void> {
  const result = await apiRequest<null>('/auth/logout', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
  });
  // Clear our copy whatever the API said: a cookie for a dead session is
  // only a way to look signed in without being so.
  await applyApiSetCookie(result.setCookie ?? 'fmip_session=; Max-Age=0');
  redirect(`/${locale}`);
}

export async function forgotPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<{ accepted: true }>('/auth/password/forgot', {
    method: 'POST',
    body: { email: text(formData, 'email') },
  });
  if (!result.ok) return failure(result);

  return {
    ok: true,
    message: 'If that address belongs to an account, a reset link is on its way.',
  };
}

export async function resetPasswordAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<{ reset: true }>('/auth/password/reset', {
    method: 'POST',
    body: { token: text(formData, 'token'), password: text(formData, 'password') },
  });
  if (!result.ok) return failure(result);

  redirect(`/${locale}/login?reset=1`);
}

export async function updateProfileAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const bio = text(formData, 'bio');
  const avatar = text(formData, 'avatar_url');
  const body: UpdateProfileRequest = {
    display_name: text(formData, 'display_name'),
    bio: bio.trim() === '' ? null : bio,
    avatar_url: avatar.trim() === '' ? null : avatar,
  };

  const result = await apiRequest<OwnProfile>('/me/profile', {
    method: 'PATCH',
    body,
    cookie: await sessionCookieHeader(),
  });
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/u/${result.data.profile.username}`);
  return { ok: true, message: 'Profile saved.' };
}

export async function updatePrivacyAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body: UpdatePrivacyRequest = {
    profile_visibility: text(
      formData,
      'profile_visibility',
    ) as UpdatePrivacyRequest['profile_visibility'],
    prediction_history_visibility: text(
      formData,
      'prediction_history_visibility',
    ) as UpdatePrivacyRequest['prediction_history_visibility'],
  };

  const result = await apiRequest<OwnProfile>('/me/privacy', {
    method: 'PATCH',
    body,
    cookie: await sessionCookieHeader(),
  });
  if (!result.ok) return failure(result);

  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: 'Privacy settings saved.' };
}

// --- following (T-042) -------------------------------------------------------

/** Follow (or set the favourite flag on) one entity, from a button or a picker form. */
export async function followAction(locale: string, formData: FormData): Promise<void> {
  const type = text(formData, 'entity_type');
  const id = text(formData, 'entity_id');
  const favouriteField = formData.get('favourite');
  const body: FollowRequest =
    favouriteField === null ? {} : { favourite: favouriteField === 'true' };

  if (id !== '') {
    await apiRequest<FollowingResponse>(
      `/me/following/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { method: 'PUT', body, cookie: await sessionCookieHeader() },
    );
  }
  revalidatePath(`/${locale}/settings`);
}

export async function unfollowAction(locale: string, formData: FormData): Promise<void> {
  const type = text(formData, 'entity_type');
  const id = text(formData, 'entity_id');

  await apiRequest<FollowingResponse>(
    `/me/following/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    { method: 'DELETE', cookie: await sessionCookieHeader() },
  );
  revalidatePath(`/${locale}/settings`);
}
