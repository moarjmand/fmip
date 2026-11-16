/**
 * The agents console's pre-launch checklist (T-1840, D-428): two lists (the
 * family-and-friends launch and the public launch), each in sections, every
 * item with its status, who must do it, notes and history. Runtime values
 * live on the console's own entry point (`@fmip/contracts/console`); the
 * barrel exports the types only.
 */

/** The two lists, in the order the page shows them. */
export const CONSOLE_CHECKLIST_LISTS = ['friends', 'public'] as const;
export const CONSOLE_CHECKLIST_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'done',
  'not_needed',
] as const;
/** The assignee that is not a console account: the agents' team (Claude). */
export const CONSOLE_CHECKLIST_AGENTS = 'agents';
export const CONSOLE_CHECKLIST_TITLE_MAX = 500;
export const CONSOLE_CHECKLIST_NOTE_MAX = 2000;
export const CONSOLE_CHECKLIST_REASON_MAX = 300;

export type ConsoleChecklistList = (typeof CONSOLE_CHECKLIST_LISTS)[number];
export type ConsoleChecklistStatus = (typeof CONSOLE_CHECKLIST_STATUSES)[number];
export type ConsoleChecklistEventKind =
  'created' | 'retitled' | 'sectioned' | 'status' | 'assigned' | 'moved' | 'removed';

/**
 * Who must do an item: a console account by its id, the agents' team
 * (`'agents'`), or nobody (`null`).
 */
export type ConsoleChecklistAssignee = string | null;

/** One note on an item; immutable. */
export interface ConsoleChecklistNote {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

/**
 * One change to an item. `previous` and `next` are the values as stored: a
 * status key, `'agents'` or a console account's id for the assignee, a
 * title, a section id, a position; `null` is none.
 */
export interface ConsoleChecklistEvent {
  kind: ConsoleChecklistEventKind;
  actor: string;
  previous: string | null;
  next: string | null;
  created_at: string;
}

export interface ConsoleChecklistItem {
  id: string;
  section_id: string;
  position: number;
  title: string;
  status: ConsoleChecklistStatus;
  assignee: ConsoleChecklistAssignee;
  updated_at: string;
  /** Display name of who changed it last; null for the seed. */
  updated_by: string | null;
  notes: ConsoleChecklistNote[];
  history: ConsoleChecklistEvent[];
}

export interface ConsoleChecklistSection {
  id: string;
  list: ConsoleChecklistList;
  position: number;
  title: string;
  items: ConsoleChecklistItem[];
}

/** A console account an item can be given to. */
export interface ConsoleChecklistPerson {
  id: string;
  username: string;
  display_name: string;
  /** The maintainer (`console_user.owner`). */
  owner: boolean;
  /** A disabled account keeps its name on its items but takes no new ones. */
  enabled: boolean;
}

/** `GET /console/checklist`: both lists, their sections and live items, and the people. */
export interface ConsoleChecklist {
  sections: ConsoleChecklistSection[];
  people: ConsoleChecklistPerson[];
}

/** `POST /console/checklist/items`. */
export interface ConsoleChecklistItemInput {
  section_id: string;
  title: string;
}

/** `PATCH /console/checklist/items/:id`: any of these, at least one. */
export interface ConsoleChecklistItemPatch {
  title?: string;
  section_id?: string;
  status?: ConsoleChecklistStatus;
  assignee?: ConsoleChecklistAssignee;
}
