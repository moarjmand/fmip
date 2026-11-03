'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CONSOLE_CHAT_EVERY_MINUTES } from '@fmip/contracts';
import { apiErrorWords } from '@/app/console/words';
import { applyConsoleCookie, consoleCall } from './console-api';
import { consoleUrl } from './console-base';

/**
 * The agents console's forms (D-340), as server actions: each posts to the
 * API with the console's cookie and comes back to the page with what
 * happened. Next refuses an action whose origin is not the page's host, and
 * the cookie is `SameSite=Strict`, so another site cannot post them.
 */

export interface ConsoleFormState {
  error: string | null;
  done: string | null;
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** The API's message in Persian, or the form's own Persian when it is not one the console knows (D-352). */
const failed = (message: string | undefined, fallback: string): ConsoleFormState => ({
  error: apiErrorWords(message, fallback),
  done: null,
});

export async function signIn(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const result = await consoleCall('session', {
    method: 'POST',
    body: { username: field(form, 'username'), password: field(form, 'password') },
  });
  if (!result.ok) return failed(result.error?.message, 'ورود ممکن نشد. دوباره امتحان کنید.');
  await applyConsoleCookie(result.setCookie);
  redirect(await consoleUrl('/'));
}

export async function signOut(): Promise<void> {
  const result = await consoleCall('session', { method: 'DELETE' });
  await applyConsoleCookie(result.setCookie);
  redirect(await consoleUrl('/login'));
}

export async function acceptInvitation(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  if (field(form, 'password') !== field(form, 'confirm')) {
    return { error: 'دو رمز یکی نیستند.', done: null };
  }
  const result = await consoleCall('invitations/accept', {
    method: 'POST',
    body: {
      token: field(form, 'token'),
      username: field(form, 'username'),
      password: field(form, 'password'),
    },
  });
  if (!result.ok) return failed(result.error?.message, 'حساب باز نشد.');
  await applyConsoleCookie(result.setCookie);
  redirect(await consoleUrl('/'));
}

/** A command to the computer: pause, resume, run, model, schedule, or an answer on a decision. */
export async function queueCommand(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const payload: Record<string, string> = {};
  for (const key of ['model', 'schedule', 'answer', 'note']) {
    const value = field(form, key);
    if (value !== '') payload[key] = value;
  }
  const result = await consoleCall('commands', {
    method: 'POST',
    body: {
      kind: field(form, 'kind'),
      target: field(form, 'target'),
      payload,
      reason: field(form, 'reason'),
    },
  });
  if (!result.ok) return failed(result.error?.message, 'دستور ثبت نشد.');
  revalidatePath('/console', 'layout');
  return { error: null, done: 'ثبت شد. رایانه در همگام‌سازی بعدی آن را انجام می‌دهد.' };
}

/**
 * A message to an agent (T-1722, D-350). The API checks the agent against
 * the roster, the length and the hourly ceiling; the maintainer's computer
 * answers within about ten minutes.
 */
export async function postMessage(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const agent = field(form, 'agent');
  const result = await consoleCall(`agents/${encodeURIComponent(agent)}/messages`, {
    method: 'POST',
    body: { body: field(form, 'body') },
  });
  if (!result.ok) return failed(result.error?.message, 'پیام فرستاده نشد.');
  revalidatePath('/console', 'layout');
  return {
    error: null,
    done: `فرستاده شد. عامل حدود ${new Intl.NumberFormat('fa-IR').format(CONSOLE_CHAT_EVERY_MINUTES)} دقیقه‌ی دیگر جواب می‌دهد.`,
  };
}

// --- Teammate requests (T-1728, D-354) ---------------------------------------

const requestPath = (form: FormData, tail = ''): string =>
  `requests/${encodeURIComponent(field(form, 'id'))}${tail}`;

const requestsChanged = () => revalidatePath('/console', 'layout');

/** A new request: title, details and priority. */
export async function createRequest(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const result = await consoleCall('requests', {
    method: 'POST',
    body: {
      title: field(form, 'title'),
      body: field(form, 'body'),
      priority: field(form, 'priority') === 'high' ? 'high' : 'normal',
    },
  });
  if (!result.ok) return failed(result.error?.message, 'درخواست ثبت نشد.');
  requestsChanged();
  return { error: null, done: 'درخواست ثبت شد.' };
}

/** Title, details and priority of an open request, by any console user. */
export async function editRequest(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const result = await consoleCall(requestPath(form), {
    method: 'PATCH',
    body: {
      title: field(form, 'title'),
      body: field(form, 'body'),
      priority: field(form, 'priority') === 'high' ? 'high' : 'normal',
    },
  });
  if (!result.ok) return failed(result.error?.message, 'تغییر ذخیره نشد.');
  requestsChanged();
  return { error: null, done: 'ذخیره شد.' };
}

/** Cancel or reopen (`action`), mark to run or withdraw (`execute`): one button each. */
export async function requestAction(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const action = field(form, 'action');
  const result =
    action === 'cancel' || action === 'reopen'
      ? await consoleCall(requestPath(form, '/status'), { method: 'POST', body: { action } })
      : await consoleCall(requestPath(form, '/execute'), {
          method: 'POST',
          body: { execute: action === 'execute' },
        });
  if (!result.ok) return failed(result.error?.message, 'انجام نشد.');
  requestsChanged();
  return { error: null, done: null };
}

/** Any console user answers the open question: agree, disagree, or another view with text. */
export async function decideRequest(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const result = await consoleCall(requestPath(form, '/decision'), {
    method: 'POST',
    body: { choice: field(form, 'choice'), text: field(form, 'text') },
  });
  if (!result.ok) return failed(result.error?.message, 'تصمیم ثبت نشد.');
  requestsChanged();
  return { error: null, done: 'تصمیم ثبت شد.' };
}

export async function addCard(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const labels = field(form, 'labels')
    .split(/[,،]/)
    .map((label) => label.trim())
    .filter((label) => label !== '');
  const result = await consoleCall('board', {
    method: 'POST',
    body: {
      title: field(form, 'title'),
      body: field(form, 'body'),
      column: field(form, 'column'),
      labels,
    },
  });
  if (!result.ok) return failed(result.error?.message, 'کارت اضافه نشد.');
  revalidatePath('/console/board');
  return { error: null, done: 'کارت اضافه شد.' };
}

export async function moveCard(form: FormData): Promise<void> {
  await consoleCall(`board/${encodeURIComponent(field(form, 'id'))}`, {
    method: 'PATCH',
    body: { column: field(form, 'column') },
  });
  revalidatePath('/console/board');
}

export async function archiveCard(form: FormData): Promise<void> {
  await consoleCall(`board/${encodeURIComponent(field(form, 'id'))}`, { method: 'DELETE' });
  revalidatePath('/console/board');
}
