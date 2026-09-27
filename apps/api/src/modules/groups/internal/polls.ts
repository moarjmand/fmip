import {
  type CreateGroupPollRequest,
  type GroupPoll,
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  MAX_POLL_REMOVAL_REASON,
  MIN_POLL_OPTIONS,
  POLL_DEFAULT_HOURS,
  POLL_MAX_HOURS,
  POLL_MIN_HOURS,
} from '@fmip/contracts';

/**
 * Group polls' pure half (T-643, D-091): what a valid poll is, and what one
 * viewer is shown of a stored one. The schema enforces every rule again
 * (`1764500000000_group-polls.sql`); this names each bad field at once so a
 * form can say what to fix, and decides nothing the database would allow.
 */

export interface ValidPoll {
  question: string;
  options: string[];
  hours: number;
}

export function validatePoll(
  body: Partial<CreateGroupPollRequest> | null | undefined,
): { ok: true; poll: ValidPoll } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (question.length < 1 || question.length > MAX_POLL_QUESTION)
    fields.question = `Between 1 and ${MAX_POLL_QUESTION} characters.`;

  const raw = Array.isArray(body?.options) ? body.options : [];
  // A blank field in a six-row form is an option nobody wrote, not an option.
  const options = raw
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS)
    fields.options = `Between ${MIN_POLL_OPTIONS} and ${MAX_POLL_OPTIONS} options.`;
  else if (options.some((o) => o.length > MAX_POLL_OPTION))
    fields.options = `Each option is at most ${MAX_POLL_OPTION} characters.`;
  else if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
    fields.options = 'Each option must be different.';

  const hours = body?.closes_in_hours ?? POLL_DEFAULT_HOURS;
  if (!Number.isInteger(hours) || hours < POLL_MIN_HOURS || hours > POLL_MAX_HOURS)
    fields.closes_in_hours = `A whole number of hours from ${POLL_MIN_HOURS} to ${POLL_MAX_HOURS} (30 days).`;

  return Object.keys(fields).length === 0
    ? { ok: true, poll: { question, options, hours } }
    : { ok: false, fields };
}

export function validateRemovalReason(reason: unknown): string | null {
  const text = typeof reason === 'string' ? reason.trim() : '';
  return text.length >= 1 && text.length <= MAX_POLL_REMOVAL_REASON ? text : null;
}

/** A stored poll as the store reads it, before anything is hidden. */
export interface PollRecord {
  id: string;
  question: string;
  creatorId: string | null;
  creatorUsername: string | null;
  createdAt: string;
  closesAt: string;
  closedAt: string | null;
  /** The database's clock at the read, so open and closed are decided by one clock. */
  now: string;
  myVote: string | null;
  options: { id: string; label: string; votes: number }[];
}

export function isOpen(record: Pick<PollRecord, 'closedAt' | 'closesAt' | 'now'>): boolean {
  return record.closedAt === null && record.now < record.closesAt;
}

/**
 * One poll for one viewer. Results -- a count per option and the total -- are
 * shown to a member who has voted, and to everybody once the poll is closed;
 * before that the member sees the question and the answers only, so the
 * counts cannot steer their vote. Who voted is not in the shape at all.
 */
export function pollView(record: PollRecord, viewer: { id: string; role: string }): GroupPoll {
  const open = isOpen(record);
  const results = !open || record.myVote !== null;
  return {
    id: record.id,
    question: record.question,
    options: record.options.map((o) => ({
      id: o.id,
      label: o.label,
      votes: results ? o.votes : null,
    })),
    created_by: record.creatorUsername,
    created_at: record.createdAt,
    closes_at: record.closesAt,
    closed_at: record.closedAt,
    status: open ? 'open' : 'closed',
    my_vote: record.myVote,
    total_votes: results ? record.options.reduce((n, o) => n + o.votes, 0) : null,
    may_close: open && (record.creatorId === viewer.id || viewer.role === 'owner'),
    may_remove: viewer.role === 'owner' || viewer.role === 'moderator',
  };
}
