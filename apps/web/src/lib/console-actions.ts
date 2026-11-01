'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { applyConsoleCookie, consoleCall } from './console-api';

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

const failed = (message: string | undefined, fallback: string): ConsoleFormState => ({
  error: message ?? fallback,
  done: null,
});

export async function signIn(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const result = await consoleCall('session', {
    method: 'POST',
    body: { username: field(form, 'username'), password: field(form, 'password') },
  });
  if (!result.ok) return failed(result.error?.message, 'ورود ممکن نشد. دوباره امتحان کنید.');
  await applyConsoleCookie(result.setCookie);
  redirect('/');
}

export async function signOut(): Promise<void> {
  const result = await consoleCall('session', { method: 'DELETE' });
  await applyConsoleCookie(result.setCookie);
  redirect('/login');
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
  redirect('/');
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
