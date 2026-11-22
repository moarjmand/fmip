import {
  CONSOLE_AGENT_MODELS,
  CONSOLE_AGENT_SCHEDULES,
  CONSOLE_BOARD_COLUMNS,
  CONSOLE_COMMAND_KINDS,
  CONSOLE_FINDING_COMMAND_KINDS,
  CONSOLE_MESSAGE_MAX,
  CONSOLE_REJECT_REASON_MIN,
  CONSOLE_REPLY_MAX,
  CONSOLE_SNAPSHOT_SCHEMA,
  CONSOLE_SNOOZE_MAX_DAYS,
  CONSOLE_SNOOZE_MAX_DAYS_SEVERE,
  CONSOLE_USERNAME_PATTERN,
  type ConsoleBoardCardInput,
  type ConsoleCommand,
  type ConsoleCommandRequest,
  type ConsoleFinding,
  type ConsoleFindingCommandKind,
  type ConsoleFindingPending,
  type ConsoleSnapshot,
} from '@fmip/contracts';
import { CONSOLE_WITHHELD_FINDING_TITLE } from '@fmip/contracts/console';
import { checkModelLab } from './model-lab-rules';
import { checkProviders } from './providers-rules';

/**
 * The agents console's rules (T-1696, T-1697, D-340), pure so they are tested
 * without a database: the session cookie, the lock after wrong passwords, the
 * snapshot's shape and what is withheld from it, and what a command or a board
 * card may say.
 */

export const CONSOLE_COOKIE = 'fmip_console';
/** A session not used for this long ends. */
export const SESSION_IDLE_HOURS = 12;
/** A session ends this long after it was opened, however much it is used (T-1880). */
export const SESSION_MAX_DAYS = 7;
/** Wrong passwords in a row before a name is locked... */
export const LOCK_AFTER_FAILURES = 5;
/** ...and for how long. */
export const LOCK_MINUTES = 15;
/** An invitation is open this long. */
export const INVITATION_DAYS = 3;
/** The largest snapshot the API takes, in bytes of JSON. */
export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
/** A memory file's or a report's text is cut to this many characters. */
export const TEXT_MAX = 6000;
export const REASON_MAX = 500;
/** How many values a command's payload holds (the console sends at most four)... */
export const COMMAND_VALUES_MAX = 8;
/** ...and how long a value's name is. A value is as long as a reason at most. */
export const COMMAND_KEY_MAX = 40;
/** The `rate_limit` row of a console person's commands, of every kind (T-1880)... */
export const COMMAND_CEILING = 'console_command';
/** ...and of `agent.run` alone, each an agent started at once on the maintainer's computer. */
export const RUN_CEILING = 'console_command_run';
/** The agent whose open findings show their id and severity only (D-340; no title since T-1948). */
export const WITHHELD_AGENT = 'security';

const SECURITY_ID = /^sec-\d{4}-\d{2}-\d{2}-\d+$/i;
/** A security finding: the security agent's, or one whose id is `sec-YYYY-MM-DD-NN` (D-455 point 2). */
export const isSecurityFinding = (finding: { id: string; agent: string }): boolean =>
  finding.agent === WITHHELD_AGENT || SECURITY_ID.test(finding.id.trim());

/** The statuses after which a finding takes no triage: only reopening follows, which is not a console command. */
export const CLOSED_STATUSES: readonly string[] = ['fixed', 'wontfix', 'duplicate', 'rejected'];

/** The console's tokens are hashed apart from the site's, though with the same secret. */
export const consoleTokenText = (token: string): string => `console:${token}`;

/**
 * The console's `Set-Cookie`: host-only (no `Domain`), so it never reaches the
 * public site; `SameSite=Strict`, since nothing links into the console from
 * outside; `HttpOnly`; `Secure` in production.
 */
export function consoleCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${CONSOLE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export const isConsoleUsername = (value: unknown): value is string =>
  typeof value === 'string' && new RegExp(CONSOLE_USERNAME_PATTERN).test(value);

/** After a wrong password: the new count, and the lock it brings, if any. */
export function afterFailure(
  failures: number,
  now: Date,
): { failures: number; lockedUntil: Date | null } {
  const next = failures + 1;
  if (next < LOCK_AFTER_FAILURES) return { failures: next, lockedUntil: null };
  return { failures: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) };
}

export const isLocked = (lockedUntil: Date | null, now: Date): boolean =>
  lockedUntil !== null && lockedUntil.getTime() > now.getTime();

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const cut = (text: string): string =>
  text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;

/**
 * A snapshot as the computer sent it, checked: the right schema number and the
 * fields the console reads, with every long text cut and an open security
 * finding's detail removed before it is stored. Returns the reason when it is
 * not one.
 */
export function checkSnapshot(
  raw: unknown,
): { ok: true; snapshot: ConsoleSnapshot } | { ok: false; reason: string } {
  if (!isObject(raw)) return { ok: false, reason: 'The snapshot is not a JSON object.' };
  if (raw.schema !== CONSOLE_SNAPSHOT_SCHEMA) {
    return {
      ok: false,
      reason: `The snapshot's schema is ${String(raw.schema)}, not ${CONSOLE_SNAPSHOT_SCHEMA}.`,
    };
  }
  if (!isString(raw.generated_at) || Number.isNaN(Date.parse(raw.generated_at))) {
    return { ok: false, reason: 'generated_at is not a time.' };
  }
  for (const key of ['agents', 'findings', 'reports', 'decisions'] as const) {
    if (!Array.isArray(raw[key])) return { ok: false, reason: `${key} is not a list.` };
  }
  const snapshot = raw as unknown as ConsoleSnapshot;
  for (const agent of snapshot.agents) {
    if (!isObject(agent) || !isString(agent.name) || !isStringArray(agent.tools)) {
      return { ok: false, reason: 'An agent has no name or no tools.' };
    }
    if (!isObject(agent.workflow) || !isObject(agent.memory) || !Array.isArray(agent.runs)) {
      return { ok: false, reason: `Agent ${agent.name} has no workflow, memory or runs.` };
    }
  }
  for (const finding of snapshot.findings) {
    if (
      !isObject(finding) ||
      !isString(finding.id) ||
      !isString(finding.agent) ||
      !isString(finding.title)
    ) {
      return { ok: false, reason: 'A finding has no id, agent or title.' };
    }
  }
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      agents: snapshot.agents.map((agent) => ({
        ...agent,
        memory: {
          sources: agent.memory.sources,
          entries: agent.memory.entries.map((entry) => ({ ...entry, text: cut(entry.text) })),
        },
      })),
      // `pending` is the server's own word (T-1907): whatever the computer sent there is dropped.
      // The server's own net: a security finding the computer did not mark releasable
      // loses its detail and its related ids, in every status, new and closed alike,
      // and its title (T-1948): the fixed phrase is stored over whatever an older
      // publisher sent, so the title is in no stored snapshot and no answer.
      findings: snapshot.findings.map(({ pending: _pending, ...finding }) =>
        isSecurityFinding(finding) && finding.releasable !== true
          ? { ...finding, title: CONSOLE_WITHHELD_FINDING_TITLE, detail: null, related: null }
          : finding,
      ),
      reports: snapshot.reports.map((report) =>
        report.agent === WITHHELD_AGENT
          ? { ...report, text: '' }
          : { ...report, text: cut(report.text) },
      ),
      brief: snapshot.brief === null || snapshot.brief === undefined ? null : snapshot.brief,
      // T-1752 (D-371): the model lab's ledger, checked; null when the snapshot has none.
      model_lab: checkModelLab(raw.model_lab),
      // T-1830 (D-423): the data providers' comparison, checked; null when the snapshot has none.
      providers: checkProviders(raw.providers),
    },
  };
}

export const isFindingCommand = (kind: unknown): kind is ConsoleFindingCommandKind =>
  (CONSOLE_FINDING_COMMAND_KINDS as readonly unknown[]).includes(kind);

/** A calendar day that exists, YYYY-MM-DD. */
function isDay(value: unknown): value is string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/** What a triage command is judged by: the finding as the loaded snapshot has it. */
export type TriageFinding = Pick<ConsoleFinding, 'id' | 'agent' | 'severity' | 'status'>;

/** The longest a finding of this severity may be snoozed, in days. */
export const snoozeMaxDays = (severity: string): number =>
  severity === 'critical' || severity === 'major'
    ? CONSOLE_SNOOZE_MAX_DAYS_SEVERE
    : CONSOLE_SNOOZE_MAX_DAYS;

/**
 * A triage reason as stored: one line. Line ends become spaces and the
 * characters that only reorder or hide text (the bidirectional controls, the
 * Arabic letter mark included, the zero-width ones and the tag characters)
 * are removed, so what a person typed cannot dress
 * itself as something else on the finding's line, where agents read it.
 */
export function triageReason(raw: string): string {
  return cleanText(raw)
    .replace(/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A command as a person asked it, or the reason it cannot be asked. A triage
 * command (T-1907, D-456 point 2) names a finding the loaded snapshot holds
 * and that is not closed; a reject needs a reason of three characters or
 * more, a snooze a day after `now`'s UTC day and within the limit for the
 * finding's severity (90 days, 14 for critical and major). Its payload is
 * rebuilt here from what the kind takes, so nothing else a client sent
 * travels to the computer. Who may triage a security finding is the store's
 * to check, with the account's row.
 */
export function checkCommand(
  body: unknown,
  agents: readonly string[],
  decisions: readonly string[],
  findings: readonly TriageFinding[] = [],
  now: Date = new Date(),
): { ok: true; command: ConsoleCommandRequest } | { ok: false; reason: string } {
  if (!isObject(body)) return { ok: false, reason: 'Say what to do.' };
  const { kind, target, payload, reason } = body;
  if (!(CONSOLE_COMMAND_KINDS as readonly unknown[]).includes(kind)) {
    return { ok: false, reason: 'Not a command the console knows.' };
  }
  if (!isString(reason) || reason.trim() === '' || reason.length > REASON_MAX) {
    return { ok: false, reason: `Give a reason, up to ${REASON_MAX} characters.` };
  }
  const values = isObject(payload) ? payload : {};
  if (!Object.values(values).every(isString))
    return { ok: false, reason: 'Every value must be text.' };
  // T-1880: what a command carries is a choice and a short note, never a document.
  if (
    Object.keys(values).length > COMMAND_VALUES_MAX ||
    Object.entries(values).some(
      ([key, value]) => key.length > COMMAND_KEY_MAX || (value as string).length > REASON_MAX,
    )
  ) {
    return {
      ok: false,
      reason: `A command carries up to ${COMMAND_VALUES_MAX} values of ${REASON_MAX} characters.`,
    };
  }
  const k = kind as ConsoleCommandRequest['kind'];
  if (isFindingCommand(k)) {
    const finding = isString(target) ? findings.find((f) => f.id === target) : undefined;
    if (finding === undefined) return { ok: false, reason: 'No such finding.' };
    if (CLOSED_STATUSES.includes(finding.status))
      return { ok: false, reason: `This finding is closed (${finding.status}).` };
    const why = triageReason(reason);
    if (why === '') return { ok: false, reason: `Give a reason, up to ${REASON_MAX} characters.` };
    const payload: Record<string, string> = {};
    if (k === 'finding.reject') {
      if ([...why].length < CONSOLE_REJECT_REASON_MIN) {
        return {
          ok: false,
          reason: `Say why it is rejected, in ${CONSOLE_REJECT_REASON_MIN} characters or more.`,
        };
      }
      // The computer writes the reason on the finding's line; the queue keeps no other copy.
      payload.reason = why;
    }
    if (k === 'finding.snooze') {
      const today = now.toISOString().slice(0, 10);
      if (!isDay(values.until) || values.until <= today)
        return { ok: false, reason: 'Snooze until a day after today, YYYY-MM-DD.' };
      const limit = snoozeMaxDays(finding.severity);
      const last = new Date(Date.parse(`${today}T00:00:00Z`) + limit * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (values.until > last) {
        return {
          ok: false,
          reason:
            limit === CONSOLE_SNOOZE_MAX_DAYS
              ? `A finding is snoozed for ${limit} days at most: until ${last} or sooner.`
              : `A ${finding.severity} finding is snoozed for ${limit} days at most: until ${last} or sooner.`,
        };
      }
      payload.until = values.until;
    }
    return { ok: true, command: { kind: k, target: finding.id, payload, reason: why } };
  }
  if (k === 'decision.answer') {
    if (!isString(target) || !decisions.includes(target))
      return { ok: false, reason: 'No such open decision.' };
    if (!isString(values.answer) || values.answer.trim() === '')
      return { ok: false, reason: 'Choose an answer.' };
  } else {
    if (!isString(target) || !agents.includes(target))
      return { ok: false, reason: 'No such agent.' };
    if (
      k === 'agent.model' &&
      !(CONSOLE_AGENT_MODELS as readonly unknown[]).includes(values.model)
    ) {
      return { ok: false, reason: 'Not a model the agents run on.' };
    }
    if (
      k === 'agent.schedule' &&
      !(CONSOLE_AGENT_SCHEDULES as readonly unknown[]).includes(values.schedule)
    ) {
      return { ok: false, reason: 'Not a schedule the daily run knows.' };
    }
  }
  return {
    ok: true,
    command: {
      kind: k,
      target: target as string,
      payload: values as Record<string, string>,
      reason: reason.trim(),
    },
  };
}

/**
 * The snapshot as a console person reads it (T-1907): each finding with the
 * triage command asked for it that the computer has not reported back, the
 * newest when there are several, or `null`. `commands` is the queue's open
 * rows (`queued` and `taken`); every other kind and status is passed over.
 */
export function withPendingTriage(
  snapshot: ConsoleSnapshot,
  commands: readonly ConsoleCommand[],
): ConsoleSnapshot {
  const pending = new Map<string, ConsoleFindingPending>();
  for (const command of commands) {
    if (!isFindingCommand(command.kind)) continue;
    if (command.status !== 'queued' && command.status !== 'taken') continue;
    const held = pending.get(command.target);
    if (held !== undefined && held.requested_at >= command.requested_at) continue;
    pending.set(command.target, {
      command_id: command.id,
      kind: command.kind,
      requested_by: command.requested_by,
      requested_at: command.requested_at,
      until: command.kind === 'finding.snooze' ? (command.payload.until ?? null) : null,
      taken: command.status === 'taken',
    });
  }
  return {
    ...snapshot,
    findings: snapshot.findings.map((finding) => ({
      ...finding,
      pending: pending.get(finding.id) ?? null,
    })),
  };
}

// --- Chat with an agent (T-1722, D-350) --------------------------------------

/** The `rate_limit` row of a console person's messages to the agents. */
export const MESSAGE_CEILING = 'console_message';
/** How much of the conversation the computer is given with each message. */
export const CHAT_CONTEXT = 20;
/** A message the computer took but never answered is taken again after this long. */
export const ANSWERING_TIMEOUT_MINUTES = 60;
/** The conversation's page. */
export const CONVERSATION_PAGE = 50;
/** Why a message was not answered, as the computer says it. */
export const FAILURE_MAX = 1000;

/** An agent's name as the snapshot and the table have it (`.claude/agents/<name>.md`). */
export const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Text as stored: line ends made `\n`, and the characters Postgres cannot
 * hold or that only hide text (NUL and the other C0 controls but tab and
 * newline) removed.
 */
export function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/**
 * A message as a person wrote it to an agent, or the reason it cannot be
 * sent: the agent must be one the newest snapshot names, and the text one to
 * 4,000 characters. The text is data for the agent, never a command to the
 * server: nothing here reads it beyond its length.
 */
export function checkMessage(
  agent: string,
  body: unknown,
  agents: readonly string[],
): { ok: true; body: string } | { ok: false; reason: string } {
  if (!AGENT_NAME.test(agent) || !agents.includes(agent))
    return { ok: false, reason: 'No such agent.' };
  const raw = isObject(body) ? body.body : undefined;
  if (!isString(raw)) return { ok: false, reason: 'Write a message.' };
  const text = cleanText(raw).trim();
  if (text === '') return { ok: false, reason: 'Write a message.' };
  if ([...text].length > CONSOLE_MESSAGE_MAX)
    return { ok: false, reason: `A message is at most ${CONSOLE_MESSAGE_MAX} characters.` };
  return { ok: true, body: text };
}

/** An agent's reply as the computer sent it, cut to the longest the console keeps. */
export function replyText(raw: string): string {
  const text = cleanText(raw).trim();
  const chars = [...text];
  if (chars.length <= CONSOLE_REPLY_MAX) return text;
  return `${chars.slice(0, CONSOLE_REPLY_MAX - 1).join('')}…`;
}

/** The longest outcome a command keeps. */
export const COMMAND_OUTCOME_MAX = 1000;

/**
 * A command's outcome as the computer sent it on standard input (T-1878),
 * cut to the longest a command keeps. It is text to show: whatever it holds
 * (a `$(...)`, a backtick, a quote, a new line) is kept as written.
 */
export function outcomeText(raw: string): string {
  const text = cleanText(raw).trim();
  const chars = [...text];
  if (chars.length <= COMMAND_OUTCOME_MAX) return text;
  return `${chars.slice(0, COMMAND_OUTCOME_MAX - 1).join('')}…`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A board card's fields as sent, or the reason they are wrong. `creating` needs a title and a column. */
export function checkCard(
  body: unknown,
  creating: boolean,
): { ok: true; card: ConsoleBoardCardInput } | { ok: false; reason: string } {
  if (!isObject(body)) return { ok: false, reason: 'Send the card.' };
  const card: ConsoleBoardCardInput = {};
  if (body.title !== undefined) {
    if (!isString(body.title) || body.title.trim() === '' || body.title.length > 200) {
      return { ok: false, reason: 'A title, up to 200 characters.' };
    }
    card.title = body.title.trim();
  }
  if (body.body !== undefined) {
    if (!isString(body.body) || body.body.length > 10_000)
      return { ok: false, reason: 'The text is too long.' };
    card.body = body.body;
  }
  if (body.column !== undefined) {
    if (!(CONSOLE_BOARD_COLUMNS as readonly unknown[]).includes(body.column)) {
      return { ok: false, reason: 'Not a column of the board.' };
    }
    card.column = body.column as ConsoleBoardCardInput['column'];
  }
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position) || (body.position as number) < 0) {
      return { ok: false, reason: 'A position is a whole number.' };
    }
    card.position = body.position as number;
  }
  if (body.labels !== undefined) {
    if (
      !isStringArray(body.labels) ||
      body.labels.length > 10 ||
      body.labels.some((l) => l.length > 40)
    ) {
      return { ok: false, reason: 'Up to ten labels of 40 characters.' };
    }
    card.labels = body.labels;
  }
  if (body.assignee !== undefined) {
    if (body.assignee !== null && (!isString(body.assignee) || body.assignee.length > 60)) {
      return { ok: false, reason: 'An assignee is a name.' };
    }
    card.assignee = body.assignee as string | null;
  }
  if (body.due_on !== undefined) {
    if (body.due_on !== null && (!isString(body.due_on) || !DATE.test(body.due_on))) {
      return { ok: false, reason: 'A due date is YYYY-MM-DD.' };
    }
    card.due_on = body.due_on as string | null;
  }
  if (creating && (card.title === undefined || card.column === undefined)) {
    return { ok: false, reason: 'A new card needs a title and a column.' };
  }
  return { ok: true, card };
}
