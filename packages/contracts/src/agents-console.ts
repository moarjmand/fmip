// ---------------------------------------------------------------------------
// The agents console (T-1696 to T-1700, D-340): `agents.traveltohormuz.ir`,
// for the maintainer and the teammate, with its own accounts. What it shows
// comes from the maintainer's computer as one snapshot at a time; what its
// people ask of the computer waits in a queue until the computer takes it.
// Nothing here is a member's: the console's people are not the site's.
// ---------------------------------------------------------------------------

/** The snapshot shape this API reads; the publisher writes the same number. */
export const CONSOLE_SNAPSHOT_SCHEMA = 1;

/** A name to sign in with: lower case, 3 to 32 characters. */
export const CONSOLE_USERNAME_PATTERN = '^[a-z0-9][a-z0-9_.-]{2,31}$';

export interface ConsoleMe {
  id: string;
  username: string;
  display_name: string;
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
export type ConsoleFindingStatus = 'open' | 'fixed' | 'wontfix' | 'duplicate';

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
  /** `null` for an open security finding (D-340): its detail stays on the computer. */
  detail: string | null;
  related: string | null;
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
] as const;
export type ConsoleCommandKind = (typeof CONSOLE_COMMAND_KINDS)[number];

export const CONSOLE_AGENT_MODELS = ['haiku', 'sonnet', 'opus'] as const;
export const CONSOLE_AGENT_SCHEDULES = ['daily', 'weekly', 'monthly', 'on-demand'] as const;

/** `POST /console/commands`. */
export interface ConsoleCommandRequest {
  kind: ConsoleCommandKind;
  /** The agent's name, or the decision's id for `decision.answer`. */
  target: string;
  /** `{ model }`, `{ schedule }`, `{ answer, note? }`; empty for the rest. */
  payload: Record<string, string>;
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
