import {
  CONSOLE_AGENT_MODELS,
  CONSOLE_AGENT_SCHEDULES,
  CONSOLE_BOARD_COLUMNS,
  CONSOLE_COMMAND_KINDS,
  CONSOLE_MESSAGE_MAX,
  CONSOLE_REPLY_MAX,
  CONSOLE_SNAPSHOT_SCHEMA,
  CONSOLE_USERNAME_PATTERN,
  type ConsoleBoardCardInput,
  type ConsoleCommandRequest,
  type ConsoleSnapshot,
} from '@fmip/contracts';

/**
 * The agents console's rules (T-1696, T-1697, D-340), pure so they are tested
 * without a database: the session cookie, the lock after wrong passwords, the
 * snapshot's shape and what is withheld from it, and what a command or a board
 * card may say.
 */

export const CONSOLE_COOKIE = 'fmip_console';
/** A session not used for this long ends. */
export const SESSION_IDLE_HOURS = 12;
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
/** The agent whose open findings show their title and severity only (D-340). */
export const WITHHELD_AGENT = 'security';

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
      findings: snapshot.findings.map((finding) =>
        finding.agent === WITHHELD_AGENT && finding.status === 'open'
          ? { ...finding, detail: null }
          : finding,
      ),
      reports: snapshot.reports.map((report) =>
        report.agent === WITHHELD_AGENT
          ? { ...report, text: '' }
          : { ...report, text: cut(report.text) },
      ),
      brief: snapshot.brief === null || snapshot.brief === undefined ? null : snapshot.brief,
    },
  };
}

/** A command as a person asked it, or the reason it cannot be asked. */
export function checkCommand(
  body: unknown,
  agents: readonly string[],
  decisions: readonly string[],
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
  const k = kind as ConsoleCommandRequest['kind'];
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
