// ---------------------------------------------------------------------------
// The agents console (T-1696 to T-1700, D-340): `agents.traveltohormuz.ir`,
// for the maintainer and the teammate, with its own accounts. What it shows
// comes from the maintainer's computer as one snapshot at a time; what its
// people ask of the computer waits in a queue until the computer takes it.
// Nothing here is a member's: the console's people are not the site's.
// ---------------------------------------------------------------------------

import type {
  CONSOLE_DECISION_CHOICES,
  CONSOLE_REQUEST_EVENT_KINDS,
  CONSOLE_REQUEST_PRIORITIES,
  CONSOLE_REQUEST_STATUSES,
} from './console-requests';
import type { ConsoleModelLab } from './console-model-lab';
import type { ConsoleProviders } from './console-providers';

/** The snapshot shape this API reads; the publisher writes the same number. */
export const CONSOLE_SNAPSHOT_SCHEMA = 1;

/** A name to sign in with: lower case, 3 to 32 characters. */
export const CONSOLE_USERNAME_PATTERN = '^[a-z0-9][a-z0-9_.-]{2,31}$';

export interface ConsoleMe {
  id: string;
  username: string;
  display_name: string;
  /**
   * Whether this account is the console's owner (D-427 point 6; T-1908): the
   * one account that triages a security finding (D-456, 2026-11-21). The page
   * says why to the other one instead of offering a button the server refuses.
   * Absent from an API built before T-1908.
   */
  owner?: boolean;
}

/** `POST /console/session`. */
export interface ConsoleSignInRequest {
  username: string;
  password: string;
}

/** `POST /console/invitations/accept`: the invitation's token, and the account it opens. */
export interface ConsoleAcceptInvitationRequest {
  token: string;
  username: string;
  password: string;
}

/** `GET /console/invitations/:token`: who it was made for, while it is open. */
export interface ConsoleInvitationView {
  display_name: string;
  expires_at: string;
}

// --- The snapshot ----------------------------------------------------------

export type ConsoleSeverity = 'critical' | 'major' | 'minor' | 'info';
/**
 * `planned`, `rejected` and `snoozed` are a person's triage (T-1907, D-456
 * point 2): accepted with a task row asked for or made and no work started,
 * turned down with a reason, or put off until a date. A snooze that has run
 * out reads `open` again. `planned`, not `accepted`: the team charter's
 * `accepted` already means "known, nothing to do" (`wontfix` here).
 */
export type ConsoleFindingStatus =
  'open' | 'fixed' | 'wontfix' | 'duplicate' | 'planned' | 'rejected' | 'snoozed';

/** The three triage commands (T-1907), each naming a finding of the loaded snapshot. */
export const CONSOLE_FINDING_COMMAND_KINDS = [
  'finding.accept',
  'finding.reject',
  'finding.snooze',
] as const;
export type ConsoleFindingCommandKind = (typeof CONSOLE_FINDING_COMMAND_KINDS)[number];
/** The shortest reason a reject carries, in characters. */
export const CONSOLE_REJECT_REASON_MIN = 3;
/** A snooze is at most this many days from today (D-456, the maintainer on 2026-11-21)... */
export const CONSOLE_SNOOZE_MAX_DAYS = 90;
/** ...and this many for a critical or major finding. */
export const CONSOLE_SNOOZE_MAX_DAYS_SEVERE = 14;
/**
 * What a withheld security finding carries in place of its title (T-1948,
 * D-456's addition of 2026-11-22): the computer sends this, the server writes
 * it over whatever an older publisher sent, and the page draws it. Persian:
 * the console shows text as written (D-352). The title itself is read in the
 * ops files on the computer. Exported from `@fmip/contracts/console` only,
 * like the console's other runtime constants (not the main barrel).
 */
export const CONSOLE_WITHHELD_FINDING_TITLE =
  'یافته‌ی امنیتی؛ عنوان و جزئیاتش در کنسول نمایش داده نمی‌شود';

/**
 * A triage command a person asked for that the computer has not reported
 * back yet (T-1907): still in the queue, or taken and not finished. The
 * server adds it to `GET /console/snapshot`; the finding's own status changes
 * only when the computer has appended the line and published again.
 */
export interface ConsoleFindingPending {
  command_id: string;
  kind: ConsoleFindingCommandKind;
  /** The console user who asked (display name). */
  requested_by: string;
  requested_at: string;
  /** `finding.snooze` only: the day it would wake, YYYY-MM-DD. */
  until: string | null;
  /**
   * The computer has taken it (T-1908): it is being applied and can no longer
   * be withdrawn (`DELETE /console/commands/:id`). Absent before T-1908.
   */
  taken?: boolean;
}

/** Where an agent's memory comes from: a file it reads, a skill, its own memory. */
export interface ConsoleMemorySource {
  kind: 'instructions' | 'skill' | 'charter' | 'project' | 'memory' | 'history';
  label: string;
  path: string;
}

/** One file of an agent's own memory, as it is now. */
export interface ConsoleMemoryEntry {
  path: string;
  updated_at: string;
  /** The file's text, cut to a few thousand characters. */
  text: string;
}

/** One run of an agent, from the daily run's log. */
export interface ConsoleAgentRun {
  at: string;
  status: 'ok' | 'failed' | 'skipped';
  findings: number;
  duration_seconds: number | null;
}

// --- How an agent works, as the console's schematic draws it (T-1725, D-352) ---

/** What starts a run: its schedule, a pull request, a person asking, the console's "run now", a chat message. */
export const CONSOLE_FLOW_TRIGGERS = [
  'schedule',
  'pull-request',
  'request',
  'run-now',
  'chat',
] as const;
/** What it reads. */
export const CONSOLE_FLOW_INPUTS = [
  'rules',
  'skill',
  'memory',
  'repository',
  'tasks',
  'production-db',
  'server',
  'public-pages',
  'github',
  'live-site',
  'web',
  'design-canvas',
  'lab',
  'dashboard',
  'team-findings',
  'team-reports',
  'desk',
] as const;
/** What it may not do (the team charter, its own file, the marketing wing's rules). */
export const CONSOLE_FLOW_LIMITS = [
  'server-read-only',
  'no-purchase-account-secret',
  'outside-text-data',
  'proposals-only',
  'no-repo-edit',
  'tests-on-request',
  'no-merge-deploy',
  'no-publish',
  'maintainer-decides',
  'no-paid-tools',
  'no-personal-data',
] as const;
/** What it leaves behind. */
export const CONSOLE_FLOW_OUTPUTS = [
  'report',
  'brief',
  'findings',
  'desk-questions',
  'handoffs',
  'ops-file',
  'design-canvas',
  'memory',
] as const;
/** Who reads what it leaves: another agent (named in `detail`), the engineering session, people, the console. */
export const CONSOLE_FLOW_READERS = [
  'agent',
  'engineering-session',
  'maintainer',
  'console',
] as const;

export type ConsoleFlowTrigger = (typeof CONSOLE_FLOW_TRIGGERS)[number];
export type ConsoleFlowInput = (typeof CONSOLE_FLOW_INPUTS)[number];
export type ConsoleFlowLimit = (typeof CONSOLE_FLOW_LIMITS)[number];
export type ConsoleFlowOutput = (typeof CONSOLE_FLOW_OUTPUTS)[number];
export type ConsoleFlowReader = (typeof CONSOLE_FLOW_READERS)[number];

/** One box of the schematic: a closed kind the console words in Persian, and its technical detail (a path, a schedule, an agent id). */
export interface ConsoleFlowNode<K extends string> {
  kind: K;
  detail: string | null;
}

/** One step of the agent's method: as its skill writes it, and in Persian when the publisher knows it. */
export interface ConsoleFlowStep {
  text: string;
  fa: string | null;
}

/** How an agent works, built by the publisher from its file, its skill and the team charter. */
export interface ConsoleAgentFlow {
  triggers: ConsoleFlowNode<ConsoleFlowTrigger>[];
  inputs: ConsoleFlowNode<ConsoleFlowInput>[];
  steps: ConsoleFlowStep[];
  limits: ConsoleFlowNode<ConsoleFlowLimit>[];
  outputs: ConsoleFlowNode<ConsoleFlowOutput>[];
  readers: ConsoleFlowNode<ConsoleFlowReader>[];
}

/** One agent as the console shows it. */
export interface ConsoleAgent {
  name: string;
  description: string;
  model: string;
  /** Tools as the agent's file names them. */
  tools: string[];
  /** The same tools grouped into what they let it do ("reads the repository", "the server, read-only"). */
  access: { area: string; level: 'read' | 'write'; tools: string[] }[];
  skills: string[];
  schedule: string;
  paused: boolean;
  /** How it works, drawn as a diagram: what it reads, its steps, what it leaves. */
  workflow: { inputs: string[]; steps: string[]; outputs: string[] };
  /** The schematic's data (D-352); absent in a snapshot built before it, when the console draws from `workflow`. */
  flow?: ConsoleAgentFlow;
  memory: { sources: ConsoleMemorySource[]; entries: ConsoleMemoryEntry[] };
  runs: ConsoleAgentRun[];
}

export interface ConsoleFinding {
  id: string;
  agent: string;
  severity: ConsoleSeverity;
  status: ConsoleFindingStatus;
  title: string;
  opened_at: string;
  /**
   * `null` for a security finding that is not resolved or marked public
   * (D-340, T-1879): its detail stays on the computer, and so does its title
   * (T-1948): `title` is then `CONSOLE_WITHHELD_FINDING_TITLE`.
   */
  detail: string | null;
  related: string | null;
  /** The task row made for it, `T-n` (T-1907); absent or null when it has none. */
  task?: string | null;
  /** A snoozed finding's wake day, YYYY-MM-DD; null otherwise. Absent before T-1907. */
  until?: string | null;
  /** Who triaged it (`planned`, `rejected`, `snoozed`): the console username; null otherwise. */
  triaged_by?: string | null;
  /** Added by the server, never by the computer: the triage command not yet applied, if any. */
  pending?: ConsoleFindingPending | null;
  /**
   * A security finding only, set by the computer (T-1907): its detail may be
   * shown (resolved by the security agent's own re-check, or marked public,
   * D-455 point 2). Without it the server removes `detail` and `related` of
   * every security finding, whatever its status.
   */
  releasable?: boolean;
}

export interface ConsoleReport {
  agent: string;
  date: string;
  title: string;
  path: string;
  /** The report's text, cut to a few thousand characters. */
  text: string;
}

export interface ConsoleDecisionOption {
  key: string;
  label: string;
}

/** An open question on the desk, or a decision already in the record (D-xxx). */
export interface ConsoleDecision {
  id: string;
  title: string;
  status: 'open' | 'decided';
  summary: string;
  options: ConsoleDecisionOption[];
  answer: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

export interface ConsoleSnapshot {
  schema: number;
  generated_at: string;
  agents: ConsoleAgent[];
  findings: ConsoleFinding[];
  reports: ConsoleReport[];
  brief: { date: string; text: string } | null;
  decisions: ConsoleDecision[];
  /**
   * The model lab's ledger (T-1752, D-371), from the model scientist's file
   * on the computer. Absent from a snapshot built before it, null when the
   * file is missing or unreadable: the model page then says the ledger was
   * not supplied (rule 3).
   */
  model_lab?: ConsoleModelLab | null;
  /**
   * The football data providers' comparison (T-1830, D-423), from the
   * research file on the computer. Absent from a snapshot built before it,
   * null when the file is missing or unreadable: the providers page then
   * says the comparison was not supplied (rule 3).
   */
  providers?: ConsoleProviders | null;
}

/** `GET /console/snapshot`: the newest snapshot, and when it reached the server. */
export interface ConsoleSnapshotResponse {
  snapshot: ConsoleSnapshot | null;
  loaded_at: string | null;
}

// --- Commands --------------------------------------------------------------

export const CONSOLE_COMMAND_KINDS = [
  'agent.pause',
  'agent.resume',
  'agent.run',
  'agent.model',
  'agent.schedule',
  'decision.answer',
  // T-1907 (D-456 point 2): a person's triage of a finding.
  'finding.accept',
  'finding.reject',
  'finding.snooze',
] as const;
export type ConsoleCommandKind = (typeof CONSOLE_COMMAND_KINDS)[number];

export const CONSOLE_AGENT_MODELS = ['haiku', 'sonnet', 'opus'] as const;
export const CONSOLE_AGENT_SCHEDULES = ['daily', 'weekly', 'monthly', 'on-demand'] as const;

/** `POST /console/commands`. */
export interface ConsoleCommandRequest {
  kind: ConsoleCommandKind;
  /** The agent's name, the decision's id for `decision.answer`, the finding's id for `finding.*`. */
  target: string;
  /** `{ model }`, `{ schedule }`, `{ answer, note? }`, `{ until }` for a snooze; empty for the rest. */
  payload: Record<string, string>;
  /**
   * Why. Every kind needs one, 1 to 500 characters, `finding.accept` and
   * `finding.snooze` included; for `finding.reject` it is the reject's reason,
   * 3 characters or more, and is kept in the payload too. A triage reason is
   * stored as one line.
   */
  reason: string;
}

export type ConsoleCommandStatus = 'queued' | 'taken' | 'done' | 'failed' | 'cancelled';

export interface ConsoleCommand {
  id: string;
  kind: ConsoleCommandKind;
  target: string;
  payload: Record<string, string>;
  status: ConsoleCommandStatus;
  requested_by: string;
  /** The asker's username (T-1907): what a triage line on the computer names in `by`. */
  requested_by_username?: string;
  /**
   * Set by the server alone, on the commands it hands to the computer
   * (T-1907): whether the asker is the console's owner. The computer checks it
   * again before it writes a security finding's triage.
   */
  requested_by_owner?: boolean;
  requested_at: string;
  finished_at: string | null;
  outcome: string | null;
}

// --- The board -------------------------------------------------------------

export const CONSOLE_BOARD_COLUMNS = ['backlog', 'next', 'doing', 'review', 'done'] as const;
export type ConsoleBoardColumn = (typeof CONSOLE_BOARD_COLUMNS)[number];

export interface ConsoleBoardCard {
  id: string;
  title: string;
  body: string;
  column: ConsoleBoardColumn;
  position: number;
  labels: string[];
  assignee: string | null;
  due_on: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** `POST /console/board` and `PATCH /console/board/:id`. */
export interface ConsoleBoardCardInput {
  title?: string;
  body?: string;
  column?: ConsoleBoardColumn;
  position?: number;
  labels?: string[];
  assignee?: string | null;
  due_on?: string | null;
}

/** One line of the console's audit, newest first. */
export interface ConsoleAuditEntry {
  actor: string;
  action: string;
  target: string;
  reason: string;
  at: string;
}

// --- Chat with an agent (T-1722, D-350) ------------------------------------

/** The longest message a console person may write to an agent, in characters. */
export const CONSOLE_MESSAGE_MAX = 4000;
/** The longest reply an agent's run may post back; a longer one is cut. */
export const CONSOLE_REPLY_MAX = 8000;
/** How often the maintainer's computer answers the queue, in minutes (said on the page). */
export const CONSOLE_CHAT_EVERY_MINUTES = 10;

/** A person's message: waiting, taken by the computer, answered, or not answered. */
export type ConsoleMessageStatus = 'queued' | 'answering' | 'answered' | 'failed';

export interface ConsoleMessage {
  id: string;
  agent: string;
  /** `person`: a console person wrote it; `agent`: the agent's reply, posted by the computer. */
  author_kind: 'person' | 'agent';
  /** The person's display name, or the agent's name. */
  author: string;
  body: string;
  created_at: string;
  /** A person's message only; `null` on an agent's reply. */
  status: ConsoleMessageStatus | null;
  /** On an agent's reply: the person's message it answers. */
  reply_to: string | null;
  /** On a failed message: why it was not answered, as the computer said. */
  failure: string | null;
}

/** `GET /console/agents/:name/messages[?before=<id>]`: oldest first, the newest last. */
export interface ConsoleConversation {
  agent: string;
  messages: ConsoleMessage[];
  /** Whether there are older messages; ask again with `before` = the first message's id. */
  has_older: boolean;
}

/** `POST /console/agents/:name/messages`. */
export interface ConsolePostMessageRequest {
  body: string;
}

/** One message the computer took (`take-messages`), with the conversation it belongs to. */
export interface ConsoleChatItem {
  message: ConsoleMessage;
  /** The agent's conversation up to and including `message`, oldest first, at most 20. */
  conversation: ConsoleMessage[];
}

// --- Teammate requests (T-1728, D-354) --------------------------------------

// The runtime lists are in './console-requests' (T-1731): this module is in
// every public page's bundle through the barrel's values, and these are only
// the console's. A type-only import costs nothing at runtime.
export type ConsoleRequestStatus = (typeof CONSOLE_REQUEST_STATUSES)[number];
export type ConsoleRequestPriority = (typeof CONSOLE_REQUEST_PRIORITIES)[number];
export type ConsoleDecisionChoice = (typeof CONSOLE_DECISION_CHOICES)[number];

export type ConsoleRequestEventKind = (typeof CONSOLE_REQUEST_EVENT_KINDS)[number];

/** One line of a request's history; append-only. */
export interface ConsoleRequestEvent {
  id: string;
  kind: ConsoleRequestEventKind;
  /** `person`: a console user; `agent`: Claude, through the server's command line. */
  actor_kind: 'person' | 'agent';
  /** The console user's display name; `null` for the agent. */
  actor: string | null;
  from_status: ConsoleRequestStatus | null;
  to_status: ConsoleRequestStatus | null;
  /** The question, the decision's text or the result as written then, when the event has one. */
  note: string | null;
  at: string;
}

export interface ConsoleRequest {
  id: string;
  title: string;
  /** The details; `''` when none were written. */
  body: string;
  status: ConsoleRequestStatus;
  priority: ConsoleRequestPriority;
  /**
   * The console user who filed it (display name): the account signed in when
   * it was added, recorded on every request since T-1728 (T-1831, D-424).
   */
  created_by: string;
  /** That account's username, the stable key the list is filtered by (T-1831). */
  created_by_username: string;
  created_at: string;
  updated_at: string;
  /** The result box, written by Claude; `null` until one is. */
  result: string | null;
  result_at: string | null;
  /** The question put to the teammate; `null` when none is. */
  decision_question: string | null;
  decision_asked_at: string | null;
  decision_choice: ConsoleDecisionChoice | null;
  decision_text: string | null;
  /** Who answered the question (display name). */
  decision_by: string | null;
  decided_at: string | null;
  /** When a console user marked it "run it now"; `null` when it is not marked. */
  execute_requested_at: string | null;
  /** The pictures on the request (T-1731, D-357), in the order they were added. */
  images: ConsoleRequestImage[];
}

// --- Pictures on a teammate request (T-1731, D-357) -------------------------

/**
 * One picture on a request, as stored: re-encoded on the server as WebP with
 * every piece of metadata removed (EXIF, GPS, ICC), so these figures are the
 * stored file's, not the upload's. The bytes are served only to a console
 * session (`GET /console/requests/:id/images/:imageId[/thumb]`) and to the
 * server's command line (`request-image`).
 */
export interface ConsoleRequestImage {
  id: string;
  /** 1, 2, 3 ... in the order added; a removed picture leaves its number unused. */
  position: number;
  caption: string | null;
  /** The stored file's type: `image/webp`. */
  content_type: string;
  byte_size: number;
  width: number;
  height: number;
  /** The stored file's sha256, hex: the computer skips a download it already holds. */
  sha256: string;
  thumb_width: number;
  thumb_height: number;
  /** The console user who added it (display name). */
  uploaded_by: string;
  created_at: string;
}

/** `PATCH /console/requests/:id/images/:imageId`: the caption, or `''` to clear it. */
export interface ConsoleRequestImageCaption {
  caption: string;
}

/** A request with its history, oldest first (`GET /console/requests/:id`, `list-requests`). */
export interface ConsoleRequestDetail extends ConsoleRequest {
  events: ConsoleRequestEvent[];
}

/** Requests per status, and the open ones (every status but `done` and `cancelled`). */
export interface ConsoleRequestCounts {
  all: number;
  open: number;
  by_status: Record<ConsoleRequestStatus, number>;
}

/** One console user who filed requests, and how many (T-1831, D-424). */
export interface ConsoleRequestFiler {
  username: string;
  display_name: string;
  count: number;
}

/**
 * `GET /console/requests[?status=s][&by=username]`: newest first, each with
 * its history. With `by`, the requests and the counts are that person's
 * alone; `filers` is always everyone who filed one, for the filter.
 */
export interface ConsoleRequestList {
  requests: ConsoleRequestDetail[];
  counts: ConsoleRequestCounts;
  filers: ConsoleRequestFiler[];
}

/** `POST /console/requests`. */
export interface ConsoleRequestCreate {
  title: string;
  body?: string;
  priority?: ConsoleRequestPriority;
}

/** `PATCH /console/requests/:id`: any of the three. */
export interface ConsoleRequestEdit {
  title?: string;
  body?: string;
  priority?: ConsoleRequestPriority;
}

/** `POST /console/requests/:id/status`: a console user cancels or reopens. */
export interface ConsoleRequestStatusChange {
  action: 'cancel' | 'reopen';
}

/** `POST /console/requests/:id/decision`. */
export interface ConsoleRequestDecide {
  choice: ConsoleDecisionChoice;
  /** Optional with `approve` or `reject`; required with `other`. */
  text?: string;
}
