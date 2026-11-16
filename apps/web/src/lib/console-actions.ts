'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dayToIso, isoToDay, jalaliMonthLength, jalaliToDay } from '@fmip/contracts/console';
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
  /** The new request's id, after `createRequest` (T-1731: its pictures follow it). */
  id?: string;
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
    done: 'فرستاده شد. هر وقت نگهدارنده پاسخ‌ها را اجرا کند، جواب عامل همین‌جا می‌آید.',
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
  const result = await consoleCall<{ id: string }>('requests', {
    method: 'POST',
    body: {
      title: field(form, 'title'),
      body: field(form, 'body'),
      priority: field(form, 'priority') === 'high' ? 'high' : 'normal',
    },
  });
  if (!result.ok) return failed(result.error?.message, 'درخواست ثبت نشد.');
  requestsChanged();
  return { error: null, done: 'درخواست ثبت شد.', id: result.data.id };
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

// --- Pictures on a request (T-1731, D-357) -----------------------------------
// The upload itself is a route handler (`app/console/request-images/`), since
// an action's body is capped at 1 MB and has no progress; these are the rest.

const picturePath = (requestId: string, imageId: string): string =>
  `requests/${encodeURIComponent(requestId)}/images/${encodeURIComponent(imageId)}`;

/** Removes a picture from an open request, by any console user. */
export async function removeRequestImage(
  requestId: string,
  imageId: string,
): Promise<ConsoleFormState> {
  const result = await consoleCall(picturePath(requestId, imageId), { method: 'DELETE' });
  if (!result.ok) return failed(result.error?.message, 'تصویر حذف نشد.');
  requestsChanged();
  return { error: null, done: 'تصویر حذف شد.' };
}

/** A picture's caption; empty clears it. */
export async function captionRequestImage(
  requestId: string,
  imageId: string,
  caption: string,
): Promise<ConsoleFormState> {
  const result = await consoleCall(picturePath(requestId, imageId), {
    method: 'PATCH',
    body: { caption },
  });
  if (!result.ok) return failed(result.error?.message, 'توضیح ذخیره نشد.');
  requestsChanged();
  return { error: null, done: 'ذخیره شد.' };
}

/** After the pictures are uploaded: the page drawn again with them. */
export async function refreshRequests(): Promise<void> {
  requestsChanged();
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

// --- The calendar and its reminders (T-1788, D-391) ---------------------------

const calendarChanged = () => revalidatePath('/console', 'layout');

/** The page's own query the editor came from, kept so a save returns to the same month and view. */
function calendarBack(form: FormData, day: string | null): string {
  const back = field(form, 'back');
  const params = new URLSearchParams(/^\?[\w=&%.-]*$/.test(back) ? back.slice(1) : '');
  params.delete('event');
  params.delete('new');
  params.delete('sub');
  if (day !== null) params.set('day', day);
  const query = params.toString();
  return `/calendar${query === '' ? '' : `?${query}`}`;
}

/** The event's day: Solar Hijri day, month and year from three fields, or the Gregorian date field. */
function eventDate(form: FormData): string | null | 'missing-day' {
  if (field(form, 'calendar') !== 'j') {
    const iso = field(form, 'date');
    return isoToDay(iso) === null ? null : iso;
  }
  const [y, m, d] = ['jy', 'jm', 'jd'].map((name) => Number(field(form, name)));
  if (![y, m, d].every((n) => Number.isInteger(n)) || y! < 1300 || y! > 1500 || m! < 1 || m! > 12)
    return null;
  if (d! < 1 || d! > jalaliMonthLength(y!, m!)) return 'missing-day';
  return dayToIso(jalaliToDay(y!, m!, d!));
}

/** Adds an event, or changes one when the form carries its id; back to the calendar on that day. */
export async function saveEvent(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const date = eventDate(form);
  if (date === null) return { error: 'تاریخ درست نیست.', done: null };
  if (date === 'missing-day') return { error: 'این ماه چنین روزی ندارد.', done: null };
  const remind = field(form, 'remind_minutes');
  const id = field(form, 'id');
  const body = {
    title: field(form, 'title'),
    date,
    time: field(form, 'time') || null,
    repeat: field(form, 'repeat') || 'none',
    basis: field(form, 'basis') || 'j',
    repeat_until: field(form, 'repeat') === 'none' ? null : field(form, 'repeat_until') || null,
    remind_minutes: remind === '' ? null : Number(remind),
    note: field(form, 'note'),
    color: field(form, 'color') || 'blue',
    subscription_key: field(form, 'subscription_key') || null,
  };
  const result = await consoleCall(
    id === '' ? 'calendar/events' : `calendar/events/${encodeURIComponent(id)}`,
    { method: id === '' ? 'POST' : 'PATCH', body },
  );
  if (!result.ok) return failed(result.error?.message, 'رویداد ذخیره نشد.');
  calendarChanged();
  redirect(await consoleUrl(calendarBack(form, date)));
}

export async function deleteEvent(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const result = await consoleCall(`calendar/events/${encodeURIComponent(field(form, 'id'))}`, {
    method: 'DELETE',
  });
  if (!result.ok) return failed(result.error?.message, 'رویداد حذف نشد.');
  calendarChanged();
  redirect(await consoleUrl(calendarBack(form, null)));
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it, for this person's reminders. */
export async function registerReminderDevice(subscription: {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}): Promise<{ ok: boolean; error: string | null }> {
  const result = await consoleCall('calendar/push', {
    method: 'POST',
    body: { endpoint: subscription.endpoint, keys: subscription.keys },
  });
  calendarChanged();
  return result.ok
    ? { ok: true, error: null }
    : { ok: false, error: apiErrorWords(result.error?.message, 'یادآور روی این مرورگر روشن نشد.') };
}

export async function removeReminderDevice(endpoint: string): Promise<{ ok: boolean }> {
  const result = await consoleCall('calendar/push', { method: 'DELETE', body: { endpoint } });
  calendarChanged();
  return { ok: result.ok || result.status === 404 };
}

/**
 * New teammate requests by browser notification, on or off for the signed-in
 * person (T-1832, D-425); it reaches the browsers switched on for reminders.
 */
export async function setRequestAlerts(
  on: boolean,
): Promise<{ ok: boolean; error: string | null }> {
  const result = await consoleCall('calendar/push/requests', { method: 'POST', body: { on } });
  calendarChanged();
  return result.ok
    ? { ok: true, error: null }
    : {
        ok: false,
        error: apiErrorWords(result.error?.message, 'تغییر اعلان درخواست‌ها ذخیره نشد.'),
      };
}

// --- The social posts (T-1836, D-427) ----------------------------------------

const socialChanged = () => revalidatePath('/console', 'layout');
const POST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const socialPost = (id: string, tail: string) => `social/posts/${encodeURIComponent(id)}/${tail}`;

/** The networks' posts ticked on a queue item (one post a network). */
const tickedPosts = (form: FormData): string[] =>
  form
    .getAll('id')
    .filter((v): v is string => typeof v === 'string' && POST_ID.test(v))
    .slice(0, 4);

/**
 * Approves each ticked post of a queue item, one call each: the API checks
 * every post's gates as they stand now and names the one that fails.
 */
export async function approveSocial(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const ids = tickedPosts(form);
  if (ids.length === 0) return { error: 'دست‌کم یک شبکه را انتخاب کنید.', done: null };
  for (const id of ids) {
    const result = await consoleCall(socialPost(id, 'approve'), { method: 'POST', body: {} });
    if (!result.ok) {
      socialChanged();
      return failed(result.error?.message, 'تأیید ثبت نشد.');
    }
  }
  socialChanged();
  return { error: null, done: 'تأیید شد؛ در یکی از نوبت‌های انتشار بعدی می‌رود.' };
}

/** Rejects each ticked post with one reason: the chosen kind of reason and the person's note. */
export async function rejectSocial(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const ids = tickedPosts(form);
  if (ids.length === 0) return { error: 'دست‌کم یک شبکه را انتخاب کنید.', done: null };
  const note = field(form, 'note').trim();
  if (note === '') return { error: 'توضیح رد را بنویسید.', done: null };
  const kind = field(form, 'why').trim();
  const reason = kind === '' ? note : `${kind}: ${note}`;
  for (const id of ids) {
    const result = await consoleCall(socialPost(id, 'reject'), {
      method: 'POST',
      body: { reason },
    });
    if (!result.ok) {
      socialChanged();
      return failed(result.error?.message, 'رد ثبت نشد.');
    }
  }
  socialChanged();
  return { error: null, done: 'رد شد.' };
}

/** A caption's words, with a reason: the post becomes a new one waiting for approval. */
export async function editSocial(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const result = await consoleCall(socialPost(field(form, 'id'), 'edit'), {
    method: 'POST',
    body: { body: field(form, 'body'), reason: field(form, 'reason') },
  });
  if (!result.ok) return failed(result.error?.message, 'ویرایش ذخیره نشد.');
  socialChanged();
  return { error: null, done: 'ذخیره شد؛ نسخه‌ی تازه منتظر تأیید است.' };
}

/** A post the network never answered for: published (with its reference) or not, from Buffer's page. */
export async function settleSocial(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const result = await consoleCall(socialPost(field(form, 'id'), 'settle'), {
    method: 'POST',
    body: {
      state: field(form, 'state'),
      reference: field(form, 'reference'),
      reason: field(form, 'reason'),
    },
  });
  if (!result.ok) return failed(result.error?.message, 'وضعیت ثبت نشد.');
  socialChanged();
  return { error: null, done: 'ثبت شد.' };
}

/** The kill switch: either account stops or resumes publishing, with a reason. */
export async function setSocialSwitch(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const stop = field(form, 'stop') === 'true';
  const result = await consoleCall('social/switch', {
    method: 'POST',
    body: { stop, reason: field(form, 'reason') },
  });
  if (!result.ok) return failed(result.error?.message, 'کلید توقف تغییر نکرد.');
  socialChanged();
  return { error: null, done: stop ? 'ارسال متوقف شد.' : 'ارسال از سر گرفته شد.' };
}

/** A kind's automation level: the owner's only, which the API holds whatever this page shows. */
export async function setSocialLevel(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const result = await consoleCall(`social/levels/${encodeURIComponent(field(form, 'kind'))}`, {
    method: 'POST',
    body: { level: field(form, 'level'), reason: field(form, 'reason') },
  });
  if (!result.ok) return failed(result.error?.message, 'سطح تغییر نکرد.');
  socialChanged();
  return { error: null, done: 'سطح تغییر کرد.' };
}

/**
 * The publisher's key, posted once and never sent back: the answer says only
 * that it was saved, and the field is empty again after the form returns.
 */
export async function setSocialKey(_: ConsoleFormState, form: FormData): Promise<ConsoleFormState> {
  const result = await consoleCall('social/key', {
    method: 'POST',
    body: { key: field(form, 'key') },
  });
  if (!result.ok) return failed(result.error?.message, 'کلید ذخیره نشد.');
  socialChanged();
  return { error: null, done: 'کلید رمزشده ذخیره شد.' };
}

export async function clearSocialKey(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const result = await consoleCall('social/key/clear', {
    method: 'POST',
    body: { reason: field(form, 'reason') },
  });
  if (!result.ok) return failed(result.error?.message, 'کلید پاک نشد.');
  socialChanged();
  return { error: null, done: 'کلید پاک شد؛ تا کلید تازه وارد نشود چیزی منتشر نمی‌شود.' };
}

export async function testReminder(): Promise<{ devices: number; delivered: number } | null> {
  const result = await consoleCall<{ devices: number; delivered: number }>('calendar/push/test', {
    method: 'POST',
  });
  return result.ok ? result.data : null;
}

// --- The pre-launch checklist (T-1840, D-428) ---------------------------------

const checklistChanged = () => revalidatePath('/console', 'layout');

/** What a checklist control hears back: nothing, or the error in Persian. */
export interface ChecklistResult {
  ok: boolean;
  error: string | null;
}

const checklistItem = (id: string) => `checklist/items/${encodeURIComponent(id)}`;

async function checklistCall(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  fallback: string,
): Promise<ChecklistResult> {
  const result = await consoleCall(path, { method, body });
  checklistChanged();
  return result.ok
    ? { ok: true, error: null }
    : { ok: false, error: apiErrorWords(result.error?.message, fallback) };
}

/** A new item at the end of a section, from the section's own form. */
export async function addChecklistItem(
  _: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  const result = await checklistCall(
    'checklist/items',
    'POST',
    { section_id: field(form, 'section_id'), title: field(form, 'title') },
    'مورد اضافه نشد.',
  );
  return result.ok ? { error: null, done: 'اضافه شد.' } : { error: result.error, done: null };
}

/** A change to an item's status, assignee, text or section. */
export async function updateChecklistItem(
  id: string,
  patch: {
    status?: string;
    assignee?: string | null;
    title?: string;
    section_id?: string;
  },
): Promise<ChecklistResult> {
  return checklistCall(checklistItem(id), 'PATCH', patch, 'تغییر ذخیره نشد.');
}

export async function moveChecklistItem(
  id: string,
  direction: 'up' | 'down',
): Promise<ChecklistResult> {
  return checklistCall(`${checklistItem(id)}/move`, 'POST', { direction }, 'جابه‌جایی انجام نشد.');
}

export async function addChecklistNote(id: string, body: string): Promise<ChecklistResult> {
  return checklistCall(`${checklistItem(id)}/notes`, 'POST', { body }, 'یادداشت ذخیره نشد.');
}

/** Removes an item; the reason goes to its history and the console's audit trail. */
export async function removeChecklistItem(id: string, reason: string): Promise<ChecklistResult> {
  return checklistCall(checklistItem(id), 'DELETE', { reason }, 'مورد حذف نشد.');
}

// --- The business model canvas (T-1855, D-440) ----------------------------------

/** What a canvas control hears back: the card's id, or the error in Persian (the console's messages stay Persian). */
export interface CanvasResult {
  ok: boolean;
  error: string | null;
  id: string | null;
}

/** A card's fields as the editor sends them; a field left out is not changed. */
export interface CanvasCardFields {
  block?: string;
  tag?: string;
  text_fa?: string;
  text_en?: string;
  note_fa?: string;
  note_en?: string;
  source?: string;
}

const canvasCard = (id: string) => `canvas/cards/${encodeURIComponent(id)}`;

async function canvasCall(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  fallback: string,
): Promise<CanvasResult> {
  const result = await consoleCall<{ id: string }>(path, { method, body });
  revalidatePath('/console', 'layout');
  return result.ok
    ? { ok: true, error: null, id: result.data.id }
    : { ok: false, error: apiErrorWords(result.error?.message, fallback), id: null };
}

/** A new card, last in its block. */
export async function createCanvasCard(input: CanvasCardFields): Promise<CanvasResult> {
  return canvasCall('canvas/cards', 'POST', input, 'کارت اضافه نشد.');
}

/** A change to a card's block, tag, texts, notes or source. */
export async function updateCanvasCard(id: string, patch: CanvasCardFields): Promise<CanvasResult> {
  return canvasCall(canvasCard(id), 'PATCH', patch, 'تغییر کارت ذخیره نشد.');
}

export async function moveCanvasCard(id: string, direction: 'up' | 'down'): Promise<CanvasResult> {
  return canvasCall(`${canvasCard(id)}/move`, 'POST', { direction }, 'جابه‌جایی انجام نشد.');
}

/** Into the bin; `restoreCanvasCard` is its undo. */
export async function removeCanvasCard(id: string): Promise<CanvasResult> {
  return canvasCall(`${canvasCard(id)}/remove`, 'POST', {}, 'کارت حذف نشد.');
}

export async function restoreCanvasCard(id: string): Promise<CanvasResult> {
  return canvasCall(`${canvasCard(id)}/restore`, 'POST', {}, 'کارت بازگردانده نشد.');
}
