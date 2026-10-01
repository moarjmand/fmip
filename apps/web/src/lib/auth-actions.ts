'use server';

import type {
  DeleteAccountRequest,
  FollowRequest,
  FollowingResponse,
  LoginRequest,
  OwnProfile,
  RegisterRequest,
  SessionResponse,
  SetViewingTerritoryRequest,
  UpdatePrivacyRequest,
  ViewingTerritoryResponse,
  UpdateProfileRequest,
} from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ApiResult, apiRequest } from './api';
import { stepHref } from './first-run';
import { applyGuestChoices } from './first-run-actions';
import { afterRegistration, readInviter } from './invite';
import { applyApiSetCookie, readerAddress, sessionCookieHeader } from './session';
import { reconcileThemeAtSignIn } from './theme-cookie';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type MessageKey, interpolate, t } from '@/i18n/messages';

/**
 * What a form gets back. `null` before the first submit; `ok: true` for an
 * action that stays on the page; field errors come straight from the API's
 * `ApiError.fields`, so the web app never re-implements a validation rule.
 */
export type ActionState =
  | null
  | { ok: true; message?: string }
  | {
      ok: false;
      message: string;
      fields?: Record<string, string>;
      /** T-907 (D-108): the API answered `forbidden` -- not a form to fix. */
      refused?: true;
    };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** A sentence in the reader's language (T-1306); an unknown locale reads English. */
function say(locale: string, key: MessageKey, params: Record<string, string> = {}): string {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return interpolate(t(resolved, key), params);
}

/**
 * A refusal, in the reader's language where the words are ours. The API's own
 * `error.message` and field errors are passed through as it wrote them.
 */
function failure<T>(locale: string, result: Extract<ApiResult<T>, { ok: false }>): ActionState {
  if (result.status === 0) {
    return { ok: false, message: say(locale, 'auth.unreachable') };
  }
  return {
    ok: false,
    message: result.error?.message ?? say(locale, 'auth.failed', { status: String(result.status) }),
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

  const result = await apiRequest<SessionResponse>('/auth/register', {
    method: 'POST',
    body,
    clientIp: await readerAddress(),
  });
  if (!result.ok) return failure(locale, result);

  await applyApiSetCookie(result.setCookie);
  // A guest's first-run choices become the account's (T-620).
  const firstRunDone = await applyGuestChoices(result.setCookie, 'sign_up');
  // So is the theme this browser chose (T-602).
  await reconcileThemeAtSignIn(result.setCookie);
  // Through a member's invite link, the new member lands on the inviter's
  // profile and its friend-request control; nothing is sent for them (T-522).
  const inviter = readInviter(text(formData, 'invited_by') || undefined);
  const destination = afterRegistration(locale, result.data.user.username, inviter);
  // A new member is offered the first run once, and then goes where they were going.
  redirect(firstRunDone ? destination : stepHref(locale, 'language', destination));
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

  const result = await apiRequest<SessionResponse>('/auth/login', {
    method: 'POST',
    body,
    clientIp: await readerAddress(),
  });
  if (!result.ok) return failure(locale, result);

  await applyApiSetCookie(result.setCookie);
  // Choices made as a guest reach an account that never did the first run (T-620).
  await applyGuestChoices(result.setCookie, 'sign_in');
  // The account's theme reaches this browser, or this browser's an account that never chose (T-602).
  await reconcileThemeAtSignIn(result.setCookie);
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

/**
 * Settings -> Delete my account (T-812, D-094). The password and the username
 * typed again go to the API, which decides both; a wrong one comes back as a
 * field error on that field. On success every session is already gone, so our
 * copy of the cookie is cleared and the member lands on the page that says so.
 */
export async function deleteAccountAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body: DeleteAccountRequest = {
    password: text(formData, 'password'),
    confirm: text(formData, 'confirm'),
  };
  const result = await apiRequest<null>('/auth/account/delete', {
    method: 'POST',
    body,
    cookie: await sessionCookieHeader(),
    // The password check is held to the sign-in ceilings, per address too (T-811).
    clientIp: await readerAddress(),
  });
  if (!result.ok) return failure(locale, result);

  await applyApiSetCookie(result.setCookie ?? 'fmip_session=; Max-Age=0');
  redirect(`/${locale}/account-deleted`);
}

export async function forgotPasswordAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<{ accepted: true }>('/auth/password/forgot', {
    method: 'POST',
    body: { email: text(formData, 'email') },
    clientIp: await readerAddress(),
  });
  if (!result.ok) return failure(locale, result);

  return {
    ok: true,
    message: say(locale, 'auth.forgot.sent'),
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
    clientIp: await readerAddress(),
  });
  if (!result.ok) return failure(locale, result);

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
  if (!result.ok) return failure(locale, result);

  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/u/${result.data.profile.username}`);
  return { ok: true, message: say(locale, 'settingsPage.profileSaved') };
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
  if (!result.ok) return failure(locale, result);

  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: say(locale, 'settingsPage.privacySaved') };
}

// --- the viewing territory (T-312) --------------------------------------------

/**
 * Chosen by the member on the settings page. An empty choice clears it, after
 * which the surfaces ask again; nothing here guesses from the browser.
 */
export async function setTerritoryAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = text(formData, 'code');
  const result = await apiRequest<ViewingTerritoryResponse>('/me/territory', {
    method: 'PUT',
    body: { code: code === '' ? null : code } satisfies SetViewingTerritoryRequest,
    cookie: await sessionCookieHeader(),
  });
  if (!result.ok) return failure(locale, result);

  revalidatePath(`/${locale}/settings`);
  const chosen = result.data.viewing_territory;
  return {
    ok: true,
    message:
      chosen.state === 'chosen'
        ? say(locale, 'settingsPage.territory.set', { territory: chosen.territory.name })
        : say(locale, 'settingsPage.territory.cleared'),
  };
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
  // The Following page offers these buttons too when nothing is followed (T-622).
  revalidatePath(`/${locale}/following`);
  // The match centre offers one for the match itself (T-945).
  if (type === 'fixture') revalidatePath(`/${locale}/match/${id}`);
}

export async function unfollowAction(locale: string, formData: FormData): Promise<void> {
  const type = text(formData, 'entity_type');
  const id = text(formData, 'entity_id');

  await apiRequest<FollowingResponse>(
    `/me/following/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    { method: 'DELETE', cookie: await sessionCookieHeader() },
  );
  revalidatePath(`/${locale}/settings`);
  if (type === 'fixture') revalidatePath(`/${locale}/match/${id}`);
}
