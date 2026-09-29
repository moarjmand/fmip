'use server';

import type { FirstRunResponse } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isLocale, isPseudoLocale } from '@/i18n/locales';
import { apiRequest, fetchMe } from './api';
import {
  type GuestChoices,
  MAX_GUEST_TEAMS,
  type Step,
  afterFirstRun,
  applyPlan,
  hasChoices,
  isTimeZone,
  nextStep,
  stepHref,
} from './first-run';
import { clearGuestChoices, readGuestChoices, writeGuestChoices } from './first-run-cookie';
import { offeredNow } from './language-hold';
import { sessionCookieHeader } from './session';
import { SESSION_COOKIE, parseSessionSetCookie } from './set-cookie';

/**
 * The first-run flow's writes (T-620). A member's answer goes to the account
 * at once, through the endpoints Settings uses; a guest's goes to the
 * browser's cookie and reaches the account at sign-up. Either way the
 * reader moves to the next step, and a failed save never traps them in the
 * flow: every step is skippable, so the next step is where they go.
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

async function member(): Promise<string | null> {
  const cookie = await sessionCookieHeader();
  return (await fetchMe(cookie)) === null ? null : (cookie ?? null);
}

async function guestUpdate(patch: (choices: GuestChoices) => GuestChoices): Promise<void> {
  await writeGuestChoices(patch(await readGuestChoices()));
}

/** Saves one step's answer and moves on; after the last step, the flow is over. */
export async function saveFirstRunStepAction(
  locale: string,
  step: Step,
  next: string | undefined,
  formData: FormData,
): Promise<void> {
  const cookie = await member();
  let target = locale;

  switch (step) {
    case 'language': {
      const language = text(formData, 'language');
      // Only a language the step offered (T-306, T-1163): one that is not
      // finished, or is held back, is not stored and not moved to.
      if (isLocale(language) && !isPseudoLocale(language) && (await offeredNow())(language)) {
        target = language;
        if (cookie !== null) {
          await apiRequest('/me/preferences', {
            method: 'PATCH',
            body: { preferred_language: language },
            cookie,
          });
        } else {
          await guestUpdate((c) => ({ ...c, language }));
        }
      }
      break;
    }
    case 'territory': {
      const code = text(formData, 'code').toUpperCase();
      // The empty choice is "not now": nothing is stored, nothing cleared.
      if (/^[A-Z]{2}$/.test(code)) {
        if (cookie !== null) {
          await apiRequest('/me/territory', { method: 'PUT', body: { code }, cookie });
        } else {
          await guestUpdate((c) => ({ ...c, territory: code }));
        }
      }
      break;
    }
    case 'timezone': {
      const timezone = text(formData, 'timezone');
      if (isTimeZone(timezone)) {
        if (cookie !== null) {
          await apiRequest('/me/preferences', { method: 'PATCH', body: { timezone }, cookie });
        } else {
          await guestUpdate((c) => ({ ...c, timezone }));
        }
      }
      break;
    }
    case 'teams': {
      // `shown` is every team the form listed; a listed team left unticked is
      // unpinned, and a team the form did not list is left as it was.
      const shown = new Set(formData.getAll('shown').filter((v) => typeof v === 'string'));
      const picked = new Set(
        formData.getAll('team').filter((v): v is string => typeof v === 'string' && shown.has(v)),
      );
      const was = new Set(formData.getAll('was').filter((v) => typeof v === 'string'));
      if (cookie !== null) {
        for (const id of shown) {
          if (picked.has(id) === was.has(id)) continue;
          await apiRequest(`/me/following/team/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: { favourite: picked.has(id) },
            cookie,
          });
        }
      } else {
        await guestUpdate((c) => {
          const kept = (c.teams ?? []).filter((id) => !shown.has(id));
          const teams = [...kept, ...picked].slice(0, MAX_GUEST_TEAMS);
          return { ...c, teams: teams.length > 0 ? teams : undefined };
        });
      }
      break;
    }
  }

  const following = nextStep(step);
  if (following === null) {
    await endFirstRun(cookie);
    redirect(afterFirstRun(target, next));
  }
  redirect(stepHref(target, following, next));
}

async function endFirstRun(cookie: string | null): Promise<void> {
  if (cookie !== null) {
    await apiRequest<FirstRunResponse>('/me/first-run', { method: 'PUT', cookie });
  } else {
    await guestUpdate((c) => ({ ...c, done: true }));
  }
}

/** "Finish" from any step: what was saved stays, the rest is skipped, and it is not offered again. */
export async function finishFirstRunAction(
  locale: string,
  next: string | undefined,
): Promise<void> {
  await endFirstRun(await member());
  redirect(afterFirstRun(locale, next));
}

/**
 * "Not now" on the homepage's offer. For a member it ends the flow (the
 * offer is made once); for a guest it only hides the offer in this browser --
 * the account they may create later is still offered the flow once.
 */
export async function dismissFirstRunAction(locale: string): Promise<void> {
  const cookie = await member();
  if (cookie !== null) await endFirstRun(cookie);
  else await guestUpdate((c) => ({ ...c, dismissed: true }));
  revalidatePath(`/${locale}`);
}

/**
 * At sign-up or sign-in, right after the session cookie is set: the guest's
 * choices, applied to the account through the API (see `applyPlan`), and the
 * browser's copy cleared. Best effort by design -- a choice the API refuses
 * is not worth failing a registration over, and every one of them can be
 * made again in the flow or in Settings. Returns whether the account's flow
 * is now done, so the caller knows whether to offer it.
 */
export async function applyGuestChoices(
  setCookie: string | null,
  moment: 'sign_up' | 'sign_in',
): Promise<boolean> {
  const session = parseSessionSetCookie(setCookie);
  if (session === null || session.value === '') return false;
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.value)}`;

  const choices = await readGuestChoices();
  const current = await apiRequest<FirstRunResponse>('/me/first-run', { cookie });
  const state = current.ok ? current.data.first_run : ({ state: 'pending' } as const);
  if (hasChoices(choices)) {
    for (const call of applyPlan(choices, moment, state)) {
      await apiRequest(call.path, { method: call.method, body: call.body, cookie });
    }
    await clearGuestChoices();
  }
  return state.state === 'done' || choices.done === true;
}
