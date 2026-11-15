import type {
  CoverageState,
  FixtureStatus,
  SocialAutomationLevel,
  SocialCardPayload,
  SocialCardTeam,
  SocialGate,
  SocialGateCheck,
  SocialNetwork,
  SocialPostKind,
  SocialPostOrigin,
  SocialPostState,
  SocialSensitiveReason,
  SocialSensitiveTopic,
} from '@fmip/contracts';
import {
  SOCIAL_AUTOMATION_ACTOR,
  SOCIAL_DAILY_CAP,
  SOCIAL_ELIGIBLE_RUN,
  SOCIAL_POST_KINDS,
  SOCIAL_SENSITIVE_TOPICS,
  SOCIAL_SLOT_TIMES,
  SOCIAL_TEMPLATE_VERSIONS,
  SOCIAL_TIME_ZONE,
  isoToDay,
  timeToMinutes,
  wallClock,
  wallTimeToInstant,
} from '@fmip/contracts/console';

/**
 * Posts to X and Instagram, the pure part (T-1834, D-427): the gates, the
 * sensitive-topic check, the fixed templates of the three kinds, the daily cap
 * as slots of a Europe/London day, the state machine and the automation run.
 * Nothing here touches the database; the store (T-1838) and the database's own
 * constraints (migration `1765901834000`) hold the same rules again.
 */

// ---------------------------------------------------------------------------
// Gates (D-427 point 3), at drafting and again at publishing.
// ---------------------------------------------------------------------------

/** A result is posted once it has stood unchanged this long after full time. */
export const RESULT_SETTLED_MS = 30 * 60 * 1000;
/** A forecast post needs the fixture read within this long. */
export const FORECAST_FRESH_MS = 6 * 60 * 60 * 1000;

/** The prediction products a post's inputs draw on (rule 6: at most one, the model's). */
export type SocialProduct = 'model' | 'founder' | 'community';

export interface SocialFacts {
  kind: SocialPostKind;
  fixture: {
    status: FixtureStatus;
    kick_off: string;
    coverage: CoverageState;
    last_updated_at: string | null;
    score_dispute: boolean;
  };
  /** The forecast the post carries (null for a result). */
  forecast: { id: string; version: string; status: 'available' | 'unavailable' } | null;
  /** The pre-kick-off forecast the match page shows now. */
  shown_forecast: { id: string; version: string } | null;
  /** The stored evaluation of that forecast (D-209), for a verdict. */
  evaluation: { forecast_id: string; correct: boolean } | null;
  products: readonly SocialProduct[];
}

/** Every gate the facts fail, in `SOCIAL_GATES` order; none means the post may go. */
export function checkGates(facts: SocialFacts, now: Date): SocialGateCheck {
  const failed: SocialGate[] = [];
  const { fixture, kind } = facts;
  const kickOff = Date.parse(fixture.kick_off);

  const statusOk =
    kind === 'forecast_pre_match'
      ? fixture.status === 'scheduled' && now.getTime() < kickOff
      : fixture.status === 'finished';
  if (!statusOk) failed.push('fixture_status');

  if (fixture.coverage !== 'available') failed.push('coverage');

  const updated = fixture.last_updated_at === null ? NaN : Date.parse(fixture.last_updated_at);
  const age = now.getTime() - updated;
  const fresh =
    !Number.isNaN(updated) &&
    age >= 0 &&
    (kind === 'forecast_pre_match' ? age <= FORECAST_FRESH_MS : age >= RESULT_SETTLED_MS);
  if (!fresh) failed.push('freshness');

  if (fixture.score_dispute) failed.push('score_dispute');

  if (kind !== 'result') {
    const f = facts.forecast;
    const shown = facts.shown_forecast;
    if (
      f === null ||
      f.status !== 'available' ||
      shown === null ||
      shown.id !== f.id ||
      shown.version !== f.version
    ) {
      failed.push('forecast_shown');
    }
  }

  if (kind === 'model_verdict') {
    if (facts.evaluation === null || facts.evaluation.forecast_id !== facts.forecast?.id) {
      failed.push('evaluation_stored');
    }
  }

  const products = [...new Set(facts.products)];
  const oneProduct =
    kind === 'result' ? products.length === 0 : products.length === 1 && products[0] === 'model';
  if (!oneProduct) failed.push('one_product');

  return { checked_at: now.toISOString(), passed: failed.length === 0, failed };
}

/** What a gate failure at publishing does: the post is never published, it ends. */
export function publishingOutcome(check: SocialGateCheck): 'publish' | 'expired' | 'superseded' {
  if (check.passed) return 'publish';
  return check.failed.includes('forecast_shown') ? 'superseded' : 'expired';
}

/** When a post stops being valid: a forecast at kick-off; a verdict or result at the end of its London day. */
export function expiresAt(kind: SocialPostKind, kickOff: string, draftedAt: Date): Date {
  if (kind === 'forecast_pre_match') return new Date(kickOff);
  const day = isoToDay(londonDay(draftedAt))!;
  return wallTimeToInstant(day + 1, 0, SOCIAL_TIME_ZONE);
}

// ---------------------------------------------------------------------------
// Sensitive topics (D-427 point 5): always to a person, never automatic.
// ---------------------------------------------------------------------------

/**
 * The lexicon, by topic. Word forms are matched whole; a few football idioms
 * that share a word ("crash out", "dead ball", "die-hard") are left out.
 * Over-matching only sends a post to a person, so the list errs wide.
 */
export const SENSITIVE_LEXICON: Readonly<Record<SocialSensitiveTopic, readonly RegExp[]>> = {
  politics: [
    /\bpolitic(?:s|al|ally|ian|ians)?\b/i,
    /\belections?\b/i,
    /\bgovernments?\b/i,
    /\bsanction(?:s|ed)?\b/i,
    /\bwars?\b/i,
  ],
  accident: [
    /\bcrash(?:es|ed|ing)?\b(?!\s+out\b)/i,
    /\baccidents?\b/i,
    /\btraged(?:y|ies)\b/i,
    /\btragic(?:ally)?\b/i,
  ],
  death: [
    /\bdeaths?\b/i,
    /\bdie[sd]?\b(?!-hard)/i,
    /\bdying\b/i,
    /\bdead\b(?!\s+(?:ball|rubber)s?\b)/i,
    /\bkill(?:ed|ing|s)?\b/i,
    /\bpassed away\b/i,
    /\bfunerals?\b/i,
    /\bminute(?:'|’)?s?\s+(?:of\s+)?silence\b/i,
  ],
  racism: [
    /\bracis[mt]s?\b/i,
    /\bracial(?:ly)?\b/i,
    /\babus(?:e|es|ed|ive)\b/i,
    /\bdiscriminat(?:e|ed|ion|ory)\b/i,
  ],
  betting: [
    /\bbet(?:s|ting)?\b/i,
    /\bodds\b/i,
    /\bbookmakers?\b/i,
    /\bbookies?\b/i,
    /\bgambl(?:e|es|ed|ing|er|ers)\b/i,
    /\bwagers?\b/i,
  ],
};

/** The topics a text touches, in `SOCIAL_SENSITIVE_TOPICS` order. */
export function sensitiveTopicsIn(text: string): SocialSensitiveTopic[] {
  return SOCIAL_SENSITIVE_TOPICS.filter((topic) =>
    SENSITIVE_LEXICON[topic].some((pattern) => pattern.test(text)),
  );
}

/**
 * Whether a post must wait for a person: the first topic any headline linked
 * to either team or the fixture touches, or `headlines_unreadable` when the
 * headlines could not be read (null): fail closed.
 */
export function sensitivity(headlines: readonly string[] | null): SocialSensitiveReason | null {
  if (headlines === null) return 'headlines_unreadable';
  for (const headline of headlines) {
    const [topic] = sensitiveTopicsIn(headline);
    if (topic !== undefined) return topic;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The fixed templates (D-427 point 12: automatic posts are templates only).
// ---------------------------------------------------------------------------

/** X counts any link as 23 characters. */
export const X_LINK_LENGTH = 23;
export const X_MAX_LENGTH = 280;
export const INSTAGRAM_MAX_LENGTH = 2200;

const LINK = /https?:\/\/\S+/g;

/** X's weighted length: a link 23, most Latin and punctuation 1, anything else 2 (twitter-text's ranges). */
export function xLength(text: string): number {
  const links = text.match(LINK) ?? [];
  let length = links.length * X_LINK_LENGTH;
  for (const char of text.replace(LINK, '')) {
    const cp = char.codePointAt(0)!;
    const light =
      cp <= 4351 ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247);
    length += light ? 1 : 2;
  }
  return length;
}

export const templateVersion = (kind: SocialPostKind): string =>
  `${kind}@${SOCIAL_TEMPLATE_VERSIONS[kind]}`;

const score = (s: { home: number; away: number }): string => `${s.home}–${s.away}`;

const clock = (iso: string): string => {
  const minutes = wallClock(new Date(iso), SOCIAL_TIME_ZONE).minutes;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

function lines(payload: SocialCardPayload, name: (team: SocialCardTeam) => string): string[] {
  const home = name(payload.home);
  const away = name(payload.away);
  const competition = payload.competition.name;
  switch (payload.kind) {
    case 'forecast_pre_match': {
      const p = payload.percent;
      return [
        `${home} v ${away}`,
        `${competition} · Kick-off ${clock(payload.kick_off)} UK time`,
        '',
        `${payload.model.name} (${payload.model.version}):`,
        `${home} win ${p.home}% · Draw ${p.draw}% · ${away} win ${p.away}%`,
      ];
    }
    case 'model_verdict': {
      const pick =
        payload.called === 'draw' ? 'Draw' : `${payload.called === 'home' ? home : away} win`;
      return [
        'Did the model get it right?',
        `${home} ${score(payload.score)} ${away} · ${competition}`,
        '',
        `${payload.model.name} (${payload.model.version}) pick: ${pick} (${payload.called_percent}%)`,
        payload.correct ? 'Yes: it got this one right.' : 'No: it got this one wrong.',
      ];
    }
    case 'result': {
      const out = [
        `Full time: ${home} ${score(payload.score)} ${away}${payload.after_extra_time ? ' (aet)' : ''}`,
      ];
      const pens = payload.penalties;
      if (pens !== null) {
        const winner = pens.home > pens.away ? home : away;
        const [w, l] = pens.home > pens.away ? [pens.home, pens.away] : [pens.away, pens.home];
        out.push(`${winner} won ${w}–${l} on penalties`);
      }
      out.push(competition);
      return out;
    }
  }
}

/**
 * A post's text from its frozen payload: on X with the match page's link
 * (counted as 23), on Instagram with no link. The full names first, the
 * short names when they do not fit; null when even those do not.
 */
export function buildBody(
  payload: SocialCardPayload,
  network: SocialNetwork,
  link: string,
): { body: string; template_version: string } | null {
  const namings: ((team: SocialCardTeam) => string)[] = [
    (t) => t.name,
    (t) => t.short_name ?? t.name,
  ];
  for (const name of namings) {
    const text = lines(payload, name).join('\n');
    const body = network === 'x' ? `${text}\n\n${link}` : text;
    const fits =
      network === 'x' ? xLength(body) <= X_MAX_LENGTH : [...body].length <= INSTAGRAM_MAX_LENGTH;
    if (fits) return { body, template_version: templateVersion(payload.kind) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The daily cap (D-427 point 4): slots 1-5 of a network's Europe/London day.
// ---------------------------------------------------------------------------

/** Nothing is published from 23:00 to 07:00, London time. */
export const QUIET_FROM_MINUTES = 23 * 60;
export const QUIET_UNTIL_MINUTES = 7 * 60;

const SLOT_MINUTES = SOCIAL_SLOT_TIMES.map((t) => timeToMinutes(t)!);

/** The Europe/London day of an instant, `YYYY-MM-DD`; the cap resets at its midnight. */
export const londonDay = (instant: Date): string => wallClock(instant, SOCIAL_TIME_ZONE).date;

/** The instants of a London day's slots, in order (slot 1 first). */
export function slotInstants(day: string): Date[] {
  const n = isoToDay(day);
  if (n === null) throw new Error(`not a day: ${day}`);
  return SLOT_MINUTES.map((m) => wallTimeToInstant(n, m, SOCIAL_TIME_ZONE));
}

/**
 * The slot a post may take now on a network, given the slots of today already
 * held: the latest slot whose time has come, if it is still free. A missed
 * slot is not caught up and nothing goes out in the quiet hours, so a day
 * never has more than `SOCIAL_DAILY_CAP` posts and fewer when fewer are due.
 */
export function dueSlot(
  now: Date,
  held: readonly number[],
): { post_day: string; slot: number } | null {
  const { date, minutes } = wallClock(now, SOCIAL_TIME_ZONE);
  if (minutes >= QUIET_FROM_MINUTES || minutes < QUIET_UNTIL_MINUTES) return null;
  if (new Set(held).size >= SOCIAL_DAILY_CAP) return null;
  let slot = 0;
  SLOT_MINUTES.forEach((m, i) => {
    if (m <= minutes) slot = i + 1;
  });
  if (slot === 0 || held.includes(slot)) return null;
  return { post_day: date, slot };
}

export interface SocialCandidate {
  id: string;
  kind: SocialPostKind;
  /** The product's competition order (T-504); null after every ranked one. */
  competition_rank: number | null;
  kick_off: string;
  expires_at: string;
}

/** Candidates in the order they take a slot: competition order, then kick-off, then kind. */
export function rankCandidates<T extends SocialCandidate>(candidates: readonly T[]): T[] {
  const rank = (c: SocialCandidate): number => c.competition_rank ?? Number.MAX_SAFE_INTEGER;
  return [...candidates].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Date.parse(a.kick_off) - Date.parse(b.kick_off) ||
      SOCIAL_POST_KINDS.indexOf(a.kind) - SOCIAL_POST_KINDS.indexOf(b.kind) ||
      a.id.localeCompare(b.id),
  );
}

/** The one post to publish now on a network and its slot, or null: never padded. */
export function nextToPublish<T extends SocialCandidate>(
  candidates: readonly T[],
  now: Date,
  held: readonly number[],
): { post: T; post_day: string; slot: number } | null {
  const slot = dueSlot(now, held);
  if (slot === null) return null;
  const [post] = rankCandidates(candidates.filter((c) => Date.parse(c.expires_at) > now.getTime()));
  return post === undefined ? null : { post, ...slot };
}

// ---------------------------------------------------------------------------
// The state machine (mirrors the trigger `social_post_guard`).
// ---------------------------------------------------------------------------

export const SOCIAL_TRANSITIONS: Readonly<Record<SocialPostState, readonly SocialPostState[]>> = {
  pending_approval: ['approved', 'rejected', 'expired', 'superseded'],
  approved: ['publishing', 'pending_approval', 'expired', 'superseded'],
  publishing: ['published', 'refused', 'unknown'],
  refused: ['publishing', 'expired', 'superseded'],
  unknown: ['published', 'refused'],
  published: [],
  rejected: [],
  expired: [],
  superseded: [],
};

export const canMove = (from: SocialPostState, to: SocialPostState): boolean =>
  SOCIAL_TRANSITIONS[from].includes(to);

// ---------------------------------------------------------------------------
// Approval and automation (D-427 point 6, the maintainer's answers of 2026-11-15).
// ---------------------------------------------------------------------------

export interface ApprovalFacts {
  level: SocialAutomationLevel;
  sensitive: boolean;
  origin: SocialPostOrigin;
  edited: boolean;
  /** The kill switch is on. */
  stopped: boolean;
}

/** Who approves a new post: the job, only for an automatic kind's clean template post; otherwise a person. */
export function approver(facts: ApprovalFacts): typeof SOCIAL_AUTOMATION_ACTOR | 'person' {
  return facts.level === 'automatic' &&
    !facts.sensitive &&
    facts.origin === 'template' &&
    !facts.edited &&
    !facts.stopped
    ? SOCIAL_AUTOMATION_ACTOR
    : 'person';
}

export type Refusal<R extends string> =
  { ok: true } | { ok: false; refusal: R; gates?: SocialGate[] };

/** A console person's approval: either account, a post still waiting, and its gates passing now. */
export function checkPersonApproval(
  state: SocialPostState,
  gates: SocialGateCheck,
): Refusal<'not_waiting' | 'gates_failed'> {
  if (state !== 'pending_approval') return { ok: false, refusal: 'not_waiting' };
  if (!gates.passed) return { ok: false, refusal: 'gates_failed', gates: gates.failed };
  return { ok: true };
}

const hasReason = (reason: string): boolean => reason.trim() !== '';

/** A rejection: either account, a post still waiting, and a reason. */
export function checkRejection(
  state: SocialPostState,
  reason: string,
): Refusal<'not_waiting' | 'reason_required'> {
  if (!canMove(state, 'rejected')) return { ok: false, refusal: 'not_waiting' };
  if (!hasReason(reason)) return { ok: false, refusal: 'reason_required' };
  return { ok: true };
}

/** The kill switch: either console account stops or resumes publishing, with a reason. */
export function checkSwitch(
  stopped: boolean,
  to: boolean,
  reason: string,
): Refusal<'no_change' | 'reason_required'> {
  if (stopped === to) return { ok: false, refusal: 'no_change' };
  if (!hasReason(reason)) return { ok: false, refusal: 'reason_required' };
  return { ok: true };
}

export const isEligible = (cleanRun: number): boolean => cleanRun >= SOCIAL_ELIGIBLE_RUN;

/**
 * A level change by a person. The maintainer (`console_user.owner`) only, both
 * ways; raising only from eligible (14 clean in a row); a reason always.
 * The console answers `not_owner` 403 and `not_eligible` 409.
 */
export function checkLevelChange(change: {
  owner: boolean;
  from: SocialAutomationLevel;
  to: SocialAutomationLevel;
  clean_run: number;
  reason: string;
}): Refusal<'not_owner' | 'no_change' | 'not_eligible' | 'reason_required'> {
  if (!change.owner) return { ok: false, refusal: 'not_owner' };
  if (change.from === change.to) return { ok: false, refusal: 'no_change' };
  if (change.to === 'automatic' && !isEligible(change.clean_run)) {
    return { ok: false, refusal: 'not_eligible' };
  }
  if (!hasReason(change.reason)) return { ok: false, refusal: 'reason_required' };
  return { ok: true };
}

export interface AutomationState {
  level: SocialAutomationLevel;
  clean_run: number;
}

/**
 * What happens to a kind's run. A clean post is one approved with no edit and
 * published with no error: only `published` with `edited: false` counts.
 * - `edited`, `rejected`, `publish_error` (refused or no answer) reset the run;
 * - `publish_error` and `kill_switch` lower an automatic kind to `approval`;
 * - `kill_switch` keeps the run: the kind stays eligible and the maintainer
 *   may raise it again once publishing resumes.
 */
export type RunEvent =
  | { type: 'published'; edited: boolean }
  | { type: 'edited' }
  | { type: 'rejected' }
  | { type: 'publish_error' }
  | { type: 'kill_switch' };

/** A lowering by the job, to be written as a `console_audit` row (`social.level`, actor `automation`). */
export interface Lowering {
  action: 'social.level';
  actor_name: typeof SOCIAL_AUTOMATION_ACTOR;
  reason: string;
  previous: AutomationState;
  next: AutomationState;
}

export function afterEvent(
  state: AutomationState,
  event: RunEvent,
): { next: AutomationState; became_eligible: boolean; lowered: Lowering | null } {
  let run = state.clean_run;
  let level = state.level;
  let reason: string | null = null;
  switch (event.type) {
    case 'published':
      run = event.edited ? 0 : run + 1;
      break;
    case 'edited':
    case 'rejected':
      run = 0;
      break;
    case 'publish_error':
      run = 0;
      if (level === 'automatic') reason = 'publishing error';
      break;
    case 'kill_switch':
      if (level === 'automatic') reason = 'kill switch';
      break;
  }
  if (reason !== null) level = 'approval';
  const next = { level, clean_run: run };
  return {
    next,
    became_eligible: !isEligible(state.clean_run) && isEligible(run),
    lowered:
      reason === null
        ? null
        : {
            action: 'social.level',
            actor_name: SOCIAL_AUTOMATION_ACTOR,
            reason,
            previous: { ...state },
            next,
          },
  };
}
