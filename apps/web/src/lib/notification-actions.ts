'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import type { MessageKey } from '@/i18n/messages';
import { failureSentence } from '@/lib/action-failure';

/**
 * A sentence this file says itself, in the reader's language (T-1305).
 *
 * Loaded on demand rather than imported: the settings form, a client
 * component, imports this module for its actions, and a static import of the
 * catalogues here would be a path from a client module to all of them
 * (`client-catalogues.spec.ts`). These run only on the server, where the
 * import is there at once.
 */
async function say(locale: string, key: MessageKey): Promise<string> {
  const { t } = await import('@/i18n/messages');
  return t(isLocale(locale) ? locale : DEFAULT_LOCALE, key);
}

/**
 * Reading notifications, and changing what arrives (T-272).
 *
 * Every one of these is a member acting on their own inbox, so there is nothing
 * to authorise here beyond having a session -- which the API checks. The
 * browser's job is to send the request and show whatever came back.
 */

async function send(
  locale: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
) {
  const result = await apiRequest(path, { method, cookie: await sessionCookieHeader(), body });
  if (!result.ok) {
    if (result.status === 0) {
      return {
        ok: false as const,
        message: await failureSentence(result, locale),
      };
    }
    return {
      ok: false as const,
      message: await failureSentence(result, locale),
    };
  }
  return { ok: true as const };
}

export async function readAllAction(locale: string): Promise<ActionState> {
  const outcome = await send(locale, '/me/notifications/read', 'POST');
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/notifications`);
  return { ok: true };
}

export async function readOneAction(locale: string, id: string): Promise<ActionState> {
  const outcome = await send(locale, `/me/notifications/${encodeURIComponent(id)}/read`, 'POST');
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/notifications`);
  return { ok: true };
}

export async function setNotificationPreferenceAction(
  locale: string,
  kind: string,
  inProduct: boolean,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const outcome = await send(
    locale,
    `/me/notification-settings/${encodeURIComponent(kind)}`,
    'PUT',
    {
      in_product: inProduct,
    },
  );
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/settings/notifications`);
  return { ok: true };
}

/**
 * Silence a team, a competition or a category (T-331). The scope is bound by
 * the form that offers it; the target is what the member picked.
 */
export async function muteAction(
  locale: string,
  scope: 'team' | 'competition' | 'category',
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const target = String(formData.get('target') ?? '').trim();
  if (target === '') return { ok: false, message: await say(locale, 'alerts.chooseFirst') };
  const outcome = await send(
    locale,
    `/me/notification-mutes/${scope}/${encodeURIComponent(target)}`,
    'PUT',
  );
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/settings/notifications`);
  return { ok: true, message: await say(locale, 'alerts.silenced') };
}

export async function unmuteAction(
  locale: string,
  scope: string,
  target: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const outcome = await send(
    locale,
    `/me/notification-mutes/${encodeURIComponent(scope)}/${encodeURIComponent(target)}`,
    'DELETE',
  );
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/settings/notifications`);
  return { ok: true };
}

export async function setQuietHoursAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const starts = String(formData.get('starts_at') ?? '');
  const ends = String(formData.get('ends_at') ?? '');
  // Cleared by submitting the form with both fields empty, rather than by a
  // second button that would be a second thing to explain.
  const outcome =
    starts === '' && ends === ''
      ? await send(locale, '/me/quiet-hours', 'DELETE')
      : await send(locale, '/me/quiet-hours', 'PUT', { starts_at: starts, ends_at: ends });
  if (!outcome.ok) return outcome;
  revalidatePath(`/${locale}/settings/notifications`);
  return {
    ok: true,
    message: await say(locale, starts === '' ? 'alerts.quietCleared' : 'alerts.quietSaved'),
  };
}
