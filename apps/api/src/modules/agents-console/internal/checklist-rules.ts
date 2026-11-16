import type {
  ConsoleChecklistAssignee,
  ConsoleChecklistEventKind,
  ConsoleChecklistItemPatch,
  ConsoleChecklistStatus,
} from '@fmip/contracts';
import {
  CONSOLE_CHECKLIST_AGENTS,
  CONSOLE_CHECKLIST_NOTE_MAX,
  CONSOLE_CHECKLIST_REASON_MAX,
  CONSOLE_CHECKLIST_STATUSES,
  CONSOLE_CHECKLIST_TITLE_MAX,
} from '@fmip/contracts/console';

/**
 * The pre-launch checklist's pure part (T-1840, D-428): what a person may
 * write -- a new item, a change, a note, a move, a removal with its reason --
 * and which changes a patch makes to an item, as the history records them.
 * Nothing here touches the database.
 */

export const CHECKLIST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The `rate_limit` row of every checklist write (D-103). */
export const CHECKLIST_CEILING = 'console_checklist';

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStatus = (value: unknown): value is ConsoleChecklistStatus =>
  (CONSOLE_CHECKLIST_STATUSES as readonly unknown[]).includes(value);

/** Text trimmed, never rewritten; `null` when it is not text or blank. */
const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

function checkTitle(value: unknown): Checked<string> {
  const title = text(value);
  if (title === null) return { ok: false, reason: 'An item needs its text.' };
  if (title.length > CONSOLE_CHECKLIST_TITLE_MAX)
    return {
      ok: false,
      reason: `An item's text is at most ${CONSOLE_CHECKLIST_TITLE_MAX} characters.`,
    };
  return { ok: true, value: title };
}

function checkSection(value: unknown): Checked<string> {
  return typeof value === 'string' && CHECKLIST_ID.test(value)
    ? { ok: true, value }
    : { ok: false, reason: 'section_id is a section of the checklist.' };
}

/** A new item: its section and its text. */
export function checkNewItem(body: unknown): Checked<{ section_id: string; title: string }> {
  if (!isObject(body)) return { ok: false, reason: 'An item is an object.' };
  const section = checkSection(body.section_id);
  if (!section.ok) return section;
  const title = checkTitle(body.title);
  if (!title.ok) return title;
  return { ok: true, value: { section_id: section.value, title: title.value } };
}

/**
 * A change to an item: any of its text, section, status and assignee, at
 * least one. The assignee is a console account's id, `'agents'`, or `null`
 * for nobody; whether the account exists is the store's to check.
 */
export function checkItemPatch(body: unknown): Checked<ConsoleChecklistItemPatch> {
  if (!isObject(body)) return { ok: false, reason: 'A change is an object.' };
  const patch: ConsoleChecklistItemPatch = {};
  if (body.title !== undefined) {
    const title = checkTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if (body.section_id !== undefined) {
    const section = checkSection(body.section_id);
    if (!section.ok) return section;
    patch.section_id = section.value;
  }
  if (body.status !== undefined) {
    if (!isStatus(body.status))
      return {
        ok: false,
        reason: `status is one of ${CONSOLE_CHECKLIST_STATUSES.join(', ')}.`,
      };
    patch.status = body.status;
  }
  if (body.assignee !== undefined) {
    const assignee = body.assignee;
    if (
      !(
        assignee === null ||
        assignee === CONSOLE_CHECKLIST_AGENTS ||
        (typeof assignee === 'string' && CHECKLIST_ID.test(assignee))
      )
    )
      return { ok: false, reason: 'assignee is a console account, agents, or null.' };
    patch.assignee = assignee as ConsoleChecklistAssignee;
  }
  if (Object.keys(patch).length === 0) return { ok: false, reason: 'Nothing to change.' };
  return { ok: true, value: patch };
}

/** A note: its text. */
export function checkNote(body: unknown): Checked<string> {
  if (!isObject(body)) return { ok: false, reason: 'A note is an object.' };
  const note = text(body.body);
  if (note === null) return { ok: false, reason: 'A note needs its text.' };
  if (note.length > CONSOLE_CHECKLIST_NOTE_MAX)
    return { ok: false, reason: `A note is at most ${CONSOLE_CHECKLIST_NOTE_MAX} characters.` };
  return { ok: true, value: note };
}

/** A move one place up or down inside the item's section. */
export function checkMove(body: unknown): Checked<'up' | 'down'> {
  if (!isObject(body) || (body.direction !== 'up' && body.direction !== 'down'))
    return { ok: false, reason: 'direction is up or down.' };
  return { ok: true, value: body.direction };
}

/** A removal says why (rule 10): the reason goes to the audit row and the item's history. */
export function checkRemoval(body: unknown): Checked<string> {
  const reason = isObject(body) ? text(body.reason) : null;
  if (reason === null) return { ok: false, reason: 'Say why the item is removed.' };
  if (reason.length > CONSOLE_CHECKLIST_REASON_MAX)
    return {
      ok: false,
      reason: `A reason is at most ${CONSOLE_CHECKLIST_REASON_MAX} characters.`,
    };
  return { ok: true, value: reason };
}

/** The fields of an item a patch can change, as stored. */
export interface ItemState {
  title: string;
  section_id: string;
  status: ConsoleChecklistStatus;
  assignee: ConsoleChecklistAssignee;
}

export interface ItemChange {
  kind: Extract<ConsoleChecklistEventKind, 'retitled' | 'sectioned' | 'status' | 'assigned'>;
  previous: string | null;
  next: string | null;
}

/** What a patch really changes, one history row per field; a value sent unchanged is no change. */
export function changesOf(before: ItemState, patch: ConsoleChecklistItemPatch): ItemChange[] {
  const changes: ItemChange[] = [];
  if (patch.title !== undefined && patch.title !== before.title)
    changes.push({ kind: 'retitled', previous: before.title, next: patch.title });
  if (patch.section_id !== undefined && patch.section_id !== before.section_id)
    changes.push({ kind: 'sectioned', previous: before.section_id, next: patch.section_id });
  if (patch.status !== undefined && patch.status !== before.status)
    changes.push({ kind: 'status', previous: before.status, next: patch.status });
  if (patch.assignee !== undefined && patch.assignee !== before.assignee)
    changes.push({ kind: 'assigned', previous: before.assignee, next: patch.assignee });
  return changes;
}
