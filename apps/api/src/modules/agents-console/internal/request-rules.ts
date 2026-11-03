import {
  type ConsoleDecisionChoice,
  type ConsoleRequestCreate,
  type ConsoleRequestEdit,
  type ConsoleRequestPriority,
  type ConsoleRequestStatus,
} from '@fmip/contracts';
import {
  CONSOLE_DECISION_CHOICES,
  CONSOLE_DECISION_TEXT_MAX,
  CONSOLE_REQUEST_BODY_MAX,
  CONSOLE_REQUEST_PRIORITIES,
  CONSOLE_REQUEST_QUESTION_MAX,
  CONSOLE_REQUEST_RESULT_MAX,
  CONSOLE_REQUEST_STATUSES,
  CONSOLE_REQUEST_TITLE_MAX,
} from '@fmip/contracts/console';
import { cleanText } from './console-rules';

/**
 * Teammate requests (T-1728, D-354), the pure part: what a person may write,
 * and which status a request may move to from which. A request is data from a
 * console user: nothing here, and nothing on the server, acts on its text.
 * Claude acts on one only when the maintainer says so in his own chat.
 */

/** The `rate_limit` row of a console person's changes to the requests. */
export const REQUEST_CEILING = 'console_request';
export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Open: everything but the two closed statuses. */
export const OPEN_STATUSES: readonly ConsoleRequestStatus[] = [
  'new',
  'in_progress',
  'waiting_decision',
  'decided',
];
export const isOpen = (status: ConsoleRequestStatus): boolean => OPEN_STATUSES.includes(status);

/** The statuses Claude writes with a result (`request-result`). */
export const RESULT_STATUSES = ['in_progress', 'done', 'cancelled'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const chars = (text: string): number => [...text].length;

/** Text as stored, trimmed; `null` when it is not text. */
const textOf = (value: unknown): string | null =>
  typeof value === 'string' ? cleanText(value).trim() : null;

function title(value: unknown): Checked<string> {
  const text = textOf(value);
  if (text === null || text === '') return { ok: false, reason: 'Give the request a title.' };
  if (chars(text) > CONSOLE_REQUEST_TITLE_MAX)
    return { ok: false, reason: `A title is at most ${CONSOLE_REQUEST_TITLE_MAX} characters.` };
  return { ok: true, value: text };
}

function details(value: unknown): Checked<string> {
  const text = textOf(value);
  if (text === null) return { ok: false, reason: 'The details are text.' };
  if (chars(text) > CONSOLE_REQUEST_BODY_MAX)
    return { ok: false, reason: `The details are at most ${CONSOLE_REQUEST_BODY_MAX} characters.` };
  return { ok: true, value: text };
}

function priority(value: unknown): Checked<ConsoleRequestPriority> {
  if (!(CONSOLE_REQUEST_PRIORITIES as readonly unknown[]).includes(value))
    return { ok: false, reason: 'A priority is normal or high.' };
  return { ok: true, value: value as ConsoleRequestPriority };
}

/** A new request as a person wrote it: a title, details if any, a priority (normal by default). */
export function checkRequestCreate(body: unknown): Checked<Required<ConsoleRequestCreate>> {
  if (!isObject(body)) return { ok: false, reason: 'Give the request a title.' };
  const t = title(body.title);
  if (!t.ok) return t;
  const b = body.body === undefined ? { ok: true as const, value: '' } : details(body.body);
  if (!b.ok) return b;
  const p =
    body.priority === undefined
      ? { ok: true as const, value: 'normal' as const }
      : priority(body.priority);
  if (!p.ok) return p;
  return { ok: true, value: { title: t.value, body: b.value, priority: p.value } };
}

/** An edit: any of title, details and priority, at least one. */
export function checkRequestEdit(body: unknown): Checked<ConsoleRequestEdit> {
  if (!isObject(body)) return { ok: false, reason: 'Say what to change.' };
  const edit: ConsoleRequestEdit = {};
  if (body.title !== undefined) {
    const t = title(body.title);
    if (!t.ok) return t;
    edit.title = t.value;
  }
  if (body.body !== undefined) {
    const b = details(body.body);
    if (!b.ok) return b;
    edit.body = b.value;
  }
  if (body.priority !== undefined) {
    const p = priority(body.priority);
    if (!p.ok) return p;
    edit.priority = p.value;
  }
  if (Object.keys(edit).length === 0) return { ok: false, reason: 'Say what to change.' };
  return { ok: true, value: edit };
}

export function checkStatusAction(body: unknown): Checked<'cancel' | 'reopen'> {
  const action = isObject(body) ? body.action : undefined;
  if (action !== 'cancel' && action !== 'reopen')
    return { ok: false, reason: 'The action is cancel or reopen.' };
  return { ok: true, value: action };
}

export function checkExecute(body: unknown): Checked<boolean> {
  const on = isObject(body) ? body.execute : undefined;
  if (typeof on !== 'boolean') return { ok: false, reason: 'execute is true or false.' };
  return { ok: true, value: on };
}

/** A decision: a choice, and its text (needed with `other`). */
export function checkDecision(
  body: unknown,
): Checked<{ choice: ConsoleDecisionChoice; text: string | null }> {
  if (!isObject(body)) return { ok: false, reason: 'Choose agree, disagree or another view.' };
  if (!(CONSOLE_DECISION_CHOICES as readonly unknown[]).includes(body.choice))
    return { ok: false, reason: 'Choose agree, disagree or another view.' };
  const choice = body.choice as ConsoleDecisionChoice;
  const text = body.text === undefined || body.text === null ? '' : textOf(body.text);
  if (text === null) return { ok: false, reason: 'The decision text is text.' };
  if (chars(text) > CONSOLE_DECISION_TEXT_MAX)
    return {
      ok: false,
      reason: `The decision text is at most ${CONSOLE_DECISION_TEXT_MAX} characters.`,
    };
  if (choice === 'other' && text === '')
    return { ok: false, reason: 'Write your view when you choose another view.' };
  return { ok: true, value: { choice, text: text === '' ? null : text } };
}

/** `?status=` of the list: one of the statuses, or none for all. */
export function checkStatusFilter(value: unknown): Checked<ConsoleRequestStatus | null> {
  if (value === undefined || value === '' || value === 'all') return { ok: true, value: null };
  if (!(CONSOLE_REQUEST_STATUSES as readonly unknown[]).includes(value))
    return { ok: false, reason: 'Not a status a request has.' };
  return { ok: true, value: value as ConsoleRequestStatus };
}

/** Claude's text from standard input (a result or a question), checked rather than cut. */
export function agentText(raw: string, max: number, what: string): Checked<string> {
  const text = cleanText(raw).trim();
  if (text === '')
    return { ok: false, reason: `The ${what} is empty: write it on standard input.` };
  if (chars(text) > max) return { ok: false, reason: `The ${what} is at most ${max} characters.` };
  return { ok: true, value: text };
}
export const resultText = (raw: string) => agentText(raw, CONSOLE_REQUEST_RESULT_MAX, 'result');
export const questionText = (raw: string) =>
  agentText(raw, CONSOLE_REQUEST_QUESTION_MAX, 'question');

// --- Transitions --------------------------------------------------------------

/**
 * What may happen to a request in a given status, and where it goes. Every
 * refusal is a sentence the console words in Persian.
 *
 * - A person edits an open request; a closed one is reopened first, so a
 *   result is never left beside text it was not written for.
 * - A person cancels an open request, and reopens a closed one (to `new`).
 * - "Run it now" is marked on an open request that is not waiting for a
 *   decision, and withdrawn at any time; it is cleared when Claude writes a
 *   result or asks, and when the request closes.
 * - Any console user decides a request that is `waiting_decision`; it moves
 *   to `decided`.
 * - A person adds, removes or captions a picture on an open request only
 *   (T-1731), like an edit; the status stays.
 * - Claude writes a result in any status (`in_progress`, `done` or
 *   `cancelled`), and asks a question on an open request (to
 *   `waiting_decision`, the earlier decision cleared; it stays in the history).
 */
export type RequestMove =
  | { kind: 'edit' }
  | { kind: 'cancel' }
  | { kind: 'reopen' }
  | { kind: 'execute'; on: boolean }
  | { kind: 'decide' }
  | { kind: 'result'; status: ResultStatus }
  | { kind: 'ask' }
  // T-1731 (D-357): a picture added, removed or captioned, like an edit.
  | { kind: 'image' };

export function nextStatus(
  status: ConsoleRequestStatus,
  move: RequestMove,
): { ok: true; status: ConsoleRequestStatus } | { ok: false; reason: string } {
  switch (move.kind) {
    case 'edit':
      return isOpen(status)
        ? { ok: true, status }
        : { ok: false, reason: 'A closed request is reopened before it is edited.' };
    case 'cancel':
      return isOpen(status)
        ? { ok: true, status: 'cancelled' }
        : { ok: false, reason: 'This request is closed already.' };
    case 'reopen':
      return isOpen(status)
        ? { ok: false, reason: 'This request is open already.' }
        : { ok: true, status: 'new' };
    case 'execute':
      if (!move.on) return { ok: true, status };
      if (status === 'waiting_decision')
        return { ok: false, reason: 'This request waits for a decision first.' };
      return isOpen(status)
        ? { ok: true, status }
        : { ok: false, reason: 'A closed request is reopened before it is run.' };
    case 'decide':
      return status === 'waiting_decision'
        ? { ok: true, status: 'decided' }
        : { ok: false, reason: 'This request has no open question.' };
    case 'result':
      return { ok: true, status: move.status };
    case 'ask':
      return isOpen(status)
        ? { ok: true, status: 'waiting_decision' }
        : { ok: false, reason: 'A closed request is reopened before a question is put on it.' };
    case 'image':
      return isOpen(status)
        ? { ok: true, status }
        : { ok: false, reason: 'A closed request is reopened before its pictures change.' };
  }
}
