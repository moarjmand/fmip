import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  SocialAutomation,
  SocialAutomationLevel,
  SocialCardPayload,
  SocialGateCheck,
  SocialNetwork,
  SocialPostKind,
  SocialPostOrigin,
  SocialPostState,
  SocialSensitiveReason,
} from '@fmip/contracts';
import { SOCIAL_AUTOMATION_ACTOR, SOCIAL_TIME_ZONE } from '@fmip/contracts/console';
import { DatabaseError, Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { ConsoleAudit } from '../../agents-console/console-audit.service';
import type { StoredCredential } from './buffer-publisher';
import type { SealedSecret } from './secret-box';
import {
  type RunEvent,
  afterEvent,
  approver,
  canMove,
  checkLevelChange,
  checkPersonApproval,
  checkRejection,
  checkSwitch,
  isEligible,
} from './social-rules';

/**
 * The social posts' tables (T-1838, D-427): `social_post`, `social_automation`
 * and `social_switch`, and the publisher's sealed key `social_credential`
 * (T-1837), written only here. Every change is one transaction that
 * also writes its `console_audit` row (rule 10: actor, time, reason, previous
 * value) -- a person's action under the person's name, the job's own under
 * `automation` with no id -- so a change that fails writes no audit row and an
 * audit row never names a change that did not happen.
 *
 * The database holds the same rules again (migration `1765901834000`): the
 * state machine, the frozen columns, one live row per (fixture, kind,
 * network), five slots a London day, the job's approvals and claims only for
 * an automatic kind while publishing runs. A refusal here is a typed answer;
 * a refusal there is an error, which is the point of having both.
 *
 * Locks are taken in one order -- the kill switch, then a kind's automation
 * row, then the post -- so two changes never wait on each other in a circle.
 * The switch is read `FOR SHARE` by whatever depends on it (a claim, the
 * job's approval, a raise): a stop being written waits for them, and they
 * wait for it, so none passes on a switch read before a stop committed
 * (review of PR #893, round 2).
 */

/** A console person, as `ConsoleSessions` names them. */
export interface SocialActor {
  id: string;
  name: string;
}

/** A post as the job drafts it: everything it publishes, frozen. */
export interface NewSocialPost {
  fixtureId: string;
  kind: SocialPostKind;
  network: SocialNetwork;
  templateVersion: string;
  body: string;
  payload: SocialCardPayload;
  inputs: Record<string, unknown>;
  gates: SocialGateCheck;
  forecastId: string | null;
  modelVersion: string | null;
  sensitive: SocialSensitiveReason | null;
  expiresAt: Date;
}

export interface SocialPostRecord {
  id: string;
  fixture_id: string;
  kind: SocialPostKind;
  network: SocialNetwork;
  state: SocialPostState;
  origin: SocialPostOrigin;
  template_version: string;
  body: string;
  payload: SocialCardPayload;
  inputs: Record<string, unknown>;
  gates: SocialGateCheck;
  forecast_id: string | null;
  model_version: string | null;
  sensitive: boolean;
  sensitive_reason: SocialSensitiveReason | null;
  edited_from: string | null;
  expires_at: Date;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decided_reason: string | null;
  /** `YYYY-MM-DD`, Europe/London. */
  post_day: string | null;
  slot: number | null;
  claimed_at: Date | null;
  provider_ref: string | null;
  published_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

const POST_COLUMNS = `id, fixture_id, kind, network, state, origin, template_version, body,
  payload, inputs, gates, forecast_id, model_version, sensitive, sensitive_reason, edited_from,
  expires_at, approved_by, approved_by_name, approved_at, decided_by, decided_by_name, decided_at,
  decided_reason, post_day::text AS post_day, slot, claimed_at, provider_ref, published_at,
  last_error, created_at`;

interface AutomationRow {
  kind: SocialPostKind;
  level: SocialAutomationLevel;
  clean_run: number;
  level_changed_at: Date | null;
  level_changed_by: string | null;
  level_changed_by_name: string | null;
  level_reason: string | null;
}

export type StoreOutcome<T, R extends string> =
  { ok: true; value: T } | { ok: false; refusal: R; gates?: string[] };

/** Thrown inside a transaction to roll it back and answer with a refusal. */
class Refused extends Error {
  constructor(
    readonly refusal: string,
    readonly gates?: string[],
  ) {
    super(refusal);
  }
}

const isConstraint = (error: unknown, code: string, constraint: string): boolean =>
  error instanceof DatabaseError && error.code === code && error.constraint === constraint;

/** A kind's clean run after an event, for the audit row of the change that causes it (rule 10). */
const runAfter = (row: AutomationRow, event: RunEvent): number =>
  afterEvent({ level: row.level, clean_run: row.clean_run }, event).next.clean_run;

/**
 * What the publisher records for a claimed post. `notSent` marks a refusal
 * before anything was sent (`stopped`: the kill switch landed after the
 * claim): the slot is given back and the kind's run kept.
 */
export type SocialFinish =
  | { state: 'published'; providerRef: string }
  | { state: 'refused'; error: string; notSent?: 'not_sent' | 'stopped' }
  | { state: 'unknown'; error: string };

/** A post the publisher may take: approved, or refused and still valid. */
export interface PublishableRow {
  id: string;
  kind: SocialPostKind;
  state: 'approved' | 'refused';
  approved_by_name: string | null;
  updated_at: Date;
  expires_at: Date;
  kick_off: string;
  competition_rank: number | null;
}

/** A key's record in words, for an audit row: never the key. */
const credentialWords = (row: { set_at: Date; set_by_name: string } | null): string =>
  row === null ? 'not set' : `set on ${row.set_at.toISOString()} by ${row.set_by_name}`;

/** What a kind's record was, for an audit row's previous value. */
const automationRecord = (row: AutomationRow) => ({
  level: row.level,
  clean_run: row.clean_run,
  level_changed_at: row.level_changed_at?.toISOString() ?? null,
  level_changed_by: row.level_changed_by_name,
  level_reason: row.level_reason,
});

@Injectable()
export class PostgresSocialPostStore {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: ConsoleAudit,
  ) {}

  // -------------------------------------------------------------------------
  // Reads.
  // -------------------------------------------------------------------------

  async get(id: string): Promise<SocialPostRecord | null> {
    const { rows } = await this.pool.query<SocialPostRecord>(
      `SELECT ${POST_COLUMNS} FROM social_post WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Every post of some fixtures but the superseded ones: what the job must
   * not draft again. A rejected, expired or published post stands for its
   * (fixture, kind, network) as much as a live one does.
   */
  async standingFor(fixtureIds: readonly string[]): Promise<SocialPostRecord[]> {
    if (fixtureIds.length === 0) return [];
    const { rows } = await this.pool.query<SocialPostRecord>(
      `SELECT ${POST_COLUMNS} FROM social_post
        WHERE fixture_id = ANY($1::uuid[]) AND state <> 'superseded'
        ORDER BY created_at`,
      [[...fixtureIds]],
    );
    return rows;
  }

  /** Every kind's level and run, as the console shows them. */
  async automation(): Promise<SocialAutomation[]> {
    const { rows } = await this.pool.query<AutomationRow>(
      `SELECT kind, level, clean_run, level_changed_at, level_changed_by, level_changed_by_name, level_reason
         FROM social_automation ORDER BY kind`,
    );
    return rows.map((r) => ({
      kind: r.kind,
      level: r.level,
      clean_run: r.clean_run,
      eligible: isEligible(r.clean_run),
      level_changed_at: r.level_changed_at?.toISOString() ?? null,
      level_changed_by: r.level_changed_by_name,
    }));
  }

  async stopped(): Promise<boolean> {
    const { rows } = await this.pool.query<{ stopped: boolean }>(
      `SELECT stopped FROM social_switch`,
    );
    return rows[0]?.stopped ?? true;
  }

  // -------------------------------------------------------------------------
  // The job's changes.
  // -------------------------------------------------------------------------

  /**
   * Drafts a post, unless its (fixture, kind, network) already has a live
   * one. An automatic kind's clean template post is approved by `automation`
   * in the same statement, with its audit row; any other waits for a person.
   */
  async draft(
    post: NewSocialPost,
  ): Promise<{ kind: 'drafted'; id: string; approvedBy: string | null } | { kind: 'exists' }> {
    const outcome = await this.tx(async (c) => {
      const stopped = await this.lockSwitch(c, 'SHARE');
      const auto = await this.lockAutomation(c, post.kind, 'SHARE');
      const automatic =
        approver({
          level: auto.level,
          sensitive: post.sensitive !== null,
          origin: 'template',
          edited: false,
          stopped,
        }) === SOCIAL_AUTOMATION_ACTOR;
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO social_post (fixture_id, kind, network, state, origin, template_version, body,
                                  payload, inputs, gates, forecast_id, model_version, sensitive,
                                  sensitive_reason, expires_at, approved_by_name, approved_at)
         VALUES ($1, $2, $3, $4, 'template', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 CASE WHEN $15::text IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (fixture_id, kind, network) WHERE state NOT IN ('rejected', 'expired', 'superseded')
         DO NOTHING
         RETURNING id`,
        [
          post.fixtureId,
          post.kind,
          post.network,
          automatic ? 'approved' : 'pending_approval',
          post.templateVersion,
          post.body,
          JSON.stringify(post.payload),
          JSON.stringify(post.inputs),
          JSON.stringify(post.gates),
          post.forecastId,
          post.modelVersion,
          post.sensitive !== null,
          post.sensitive,
          post.expiresAt.toISOString(),
          automatic ? SOCIAL_AUTOMATION_ACTOR : null,
        ],
      );
      const id = rows[0]?.id;
      if (id === undefined) return { kind: 'exists' as const };
      if (automatic) {
        await this.audit.write(c, {
          actorId: null,
          actorName: SOCIAL_AUTOMATION_ACTOR,
          action: 'social.approve',
          targetType: 'social_post',
          targetId: id,
          reason: `${post.kind} is automatic: a clean template post`,
          previous: null,
          next: { state: 'approved' },
        });
      }
      return {
        kind: 'drafted' as const,
        id,
        approvedBy: automatic ? SOCIAL_AUTOMATION_ACTOR : null,
      };
    });
    if (!outcome.ok) throw new Error(`draft refused: ${outcome.refusal}`);
    return outcome.value;
  }

  /**
   * Claims a post for publishing: `approved` or `refused` to `publishing`,
   * taking a slot of its network's London day (the claim's, by the database's
   * clock, as the CHECK reads it). A slot already taken, a sixth slot, a post
   * already claimed or publishing stopped answer a refusal and write nothing.
   */
  async claim(
    id: string,
    slot: number,
  ): Promise<
    StoreOutcome<
      { post_day: string; slot: number },
      'not_found' | 'stopped' | 'not_claimable' | 'slot_taken' | 'no_such_slot'
    >
  > {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      if (await this.lockSwitch(c, 'SHARE')) throw new Refused('stopped');
      const auto = await this.lockAutomation(c, kind, 'SHARE');
      const post = await this.lockPost(c, id);
      if (!canMove(post.state, 'publishing')) throw new Refused('not_claimable');
      if (post.approved_by_name === SOCIAL_AUTOMATION_ACTOR && auto.level !== 'automatic') {
        throw new Refused('not_claimable');
      }
      let claimed: { post_day: string; slot: number };
      try {
        const { rows } = await c.query<{ post_day: string; slot: number }>(
          `UPDATE social_post
              SET state = 'publishing', slot = $2, claimed_at = now(),
                  post_day = (now() AT TIME ZONE '${SOCIAL_TIME_ZONE}')::date
            WHERE id = $1
        RETURNING post_day::text AS post_day, slot`,
          [id, slot],
        );
        claimed = rows[0]!;
      } catch (error) {
        if (isConstraint(error, '23505', 'social_post_daily_slot')) throw new Refused('slot_taken');
        if (isConstraint(error, '23514', 'social_post_slot_range'))
          throw new Refused('no_such_slot');
        throw error;
      }
      await this.audit.write(c, {
        actorId: null,
        actorName: SOCIAL_AUTOMATION_ACTOR,
        action: 'social.claim',
        targetType: 'social_post',
        targetId: id,
        reason: `claimed slot ${claimed.slot} of ${claimed.post_day}`,
        previous: { state: post.state },
        next: { state: 'publishing', ...claimed },
      });
      return claimed;
    });
  }

  /**
   * What the network answered for a claimed post, and its effect on the
   * kind's run (`afterEvent`): published counts as clean unless the post is
   * an edit; refused by the network (the slot given back) or no answer
   * (`unknown`, the slot kept) is a publishing error, which resets the run
   * and lowers an automatic kind, audited. A refusal before anything was
   * sent (`notSent`: no channel, the provider unreachable, a rate limit, a
   * text over the limit, or `stopped` after the claim) gives the slot back
   * and keeps the run (T-1839, D-427 point 6 as amended); a job-approved post
   * whose kind is no longer automatic goes back to a person.
   */
  async finish(
    id: string,
    answer: SocialFinish,
  ): Promise<StoreOutcome<SocialPostState, 'not_found' | 'not_publishing'>> {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      const auto = await this.lockAutomation(c, kind, 'UPDATE');
      const post = await this.lockPost(c, id);
      if (post.state !== 'publishing') throw new Refused('not_publishing');
      const notSent = answer.state === 'refused' ? (answer.notSent ?? null) : null;
      const event: RunEvent | null =
        answer.state === 'published'
          ? { type: 'published', edited: post.edited_from !== null }
          : notSent !== null
            ? null
            : { type: 'publish_error' };
      if (answer.state === 'published') {
        await c.query(
          `UPDATE social_post SET state = 'published', provider_ref = $2, published_at = now() WHERE id = $1`,
          [id, answer.providerRef],
        );
      } else {
        await c.query(
          `UPDATE social_post
              SET state = $2, last_error = $3,
                  slot = CASE WHEN $2 = 'refused' THEN NULL ELSE slot END,
                  post_day = CASE WHEN $2 = 'refused' THEN NULL ELSE post_day END,
                  claimed_at = CASE WHEN $2 = 'refused' THEN NULL ELSE claimed_at END
            WHERE id = $1`,
          [id, answer.state, answer.error.slice(0, 500)],
        );
      }
      await this.audit.write(c, {
        actorId: null,
        actorName: SOCIAL_AUTOMATION_ACTOR,
        action: 'social.finish',
        targetType: 'social_post',
        targetId: id,
        reason:
          answer.state === 'published'
            ? 'the network published it'
            : notSent === 'stopped'
              ? 'stopped'
              : notSent === 'not_sent'
                ? 'nothing was sent'
                : answer.state === 'refused'
                  ? 'the network refused it'
                  : 'the network did not answer',
        previous: {
          state: post.state,
          post_day: post.post_day,
          slot: post.slot,
          clean_run: auto.clean_run,
        },
        next: {
          state: answer.state,
          clean_run: event === null ? auto.clean_run : runAfter(auto, event),
        },
      });
      if (event !== null) {
        await this.applyRun(c, auto, event);
      } else if (post.approved_by_name === SOCIAL_AUTOMATION_ACTOR && auto.level !== 'automatic') {
        // Lowered (by the kill switch) while it was being sent: back to a person, as its peers went.
        await this.backToPerson(c, kind, `${kind} is no longer automatic`);
      }
      return answer.state;
    });
  }

  /**
   * Ends a post that may no longer go: `expired` (its validity ended, or a
   * gate other than the forecast failed) or `superseded` (the forecast the
   * site shows changed). Only a post not yet claimed.
   */
  async end(
    id: string,
    to: 'expired' | 'superseded',
    reason: string,
  ): Promise<StoreOutcome<null, 'not_found' | 'not_waiting'>> {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      const post = await this.lockPost(c, id);
      if (!canMove(post.state, to)) throw new Refused('not_waiting');
      await c.query(`UPDATE social_post SET state = $2, last_error = $3 WHERE id = $1`, [
        id,
        to,
        reason.slice(0, 500),
      ]);
      await this.audit.write(c, {
        actorId: null,
        actorName: SOCIAL_AUTOMATION_ACTOR,
        action: to === 'expired' ? 'social.expire' : 'social.supersede',
        targetType: 'social_post',
        targetId: id,
        reason,
        previous: { state: post.state },
        next: { state: to },
      });
      return null;
    });
  }

  /** Ends every post not yet claimed whose validity has ended by `now`; how many. */
  async expireDue(now: Date): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM social_post
        WHERE state IN ('pending_approval', 'approved', 'refused') AND expires_at <= $1
        ORDER BY expires_at`,
      [now.toISOString()],
    );
    let ended = 0;
    for (const { id } of rows) {
      if ((await this.end(id, 'expired', 'its validity ended')).ok) ended += 1;
    }
    return ended;
  }

  /**
   * A headline found sensitive after drafting: the post waits for a person.
   * Any approval is withdrawn in the same statement -- the job's (the CHECK
   * forbids it on a sensitive post) and a person's too, who approved it
   * without that headline ("became sensitive after approval", D-427 point 5
   * as amended 2026-11-16, review of PR #896): it needs a fresh approval.
   * Only before publishing, and never undone; a post already sensitive is
   * left as it is.
   */
  async markSensitive(
    id: string,
    reason: SocialSensitiveReason,
  ): Promise<StoreOutcome<SocialPostState, 'not_found' | 'not_waiting' | 'already'>> {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      const post = await this.lockPost(c, id);
      if (post.sensitive) throw new Refused('already');
      if (!['pending_approval', 'approved', 'refused'].includes(post.state)) {
        throw new Refused('not_waiting');
      }
      const withdraw = post.approved_by_name !== null;
      const state: SocialPostState = withdraw ? 'pending_approval' : post.state;
      await c.query(
        `UPDATE social_post
            SET sensitive = true, sensitive_reason = $2, state = $3,
                approved_by = CASE WHEN $4 THEN NULL ELSE approved_by END,
                approved_by_name = CASE WHEN $4 THEN NULL ELSE approved_by_name END,
                approved_at = CASE WHEN $4 THEN NULL ELSE approved_at END
          WHERE id = $1`,
        [id, reason, state, withdraw],
      );
      await this.audit.write(c, {
        actorId: null,
        actorName: SOCIAL_AUTOMATION_ACTOR,
        action: 'social.sensitive',
        targetType: 'social_post',
        targetId: id,
        reason: withdraw ? 'became sensitive after approval' : `sensitive: ${reason}`,
        previous: {
          state: post.state,
          sensitive: false,
          approved_by: post.approved_by_name,
          approved_at: post.approved_at?.toISOString() ?? null,
        },
        next: { state, sensitive: true, sensitive_reason: reason },
      });
      return state;
    });
  }

  // -------------------------------------------------------------------------
  // A console person's changes (either account; the level the owner's only).
  // -------------------------------------------------------------------------

  /** A person's approval of a waiting post whose gates pass now (checked by the caller, just before). */
  async approve(
    id: string,
    actor: SocialActor,
    gates: SocialGateCheck,
  ): Promise<StoreOutcome<null, 'not_found' | 'not_waiting' | 'gates_failed'>> {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      const post = await this.lockPost(c, id);
      const check = checkPersonApproval(post.state, gates);
      if (!check.ok) throw new Refused(check.refusal, check.gates);
      await c.query(
        `UPDATE social_post SET state = 'approved', approved_by = $2, approved_by_name = $3, approved_at = now()
          WHERE id = $1`,
        [id, actor.id, actor.name],
      );
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.approve',
        targetType: 'social_post',
        targetId: id,
        reason: 'approved by a person, its gates passing',
        previous: { state: post.state },
        next: { state: 'approved', gates },
      });
      return null;
    });
  }

  /** A person's rejection, with a reason; resets the kind's run and leaves its level. */
  async reject(
    id: string,
    actor: SocialActor,
    reason: string,
  ): Promise<StoreOutcome<null, 'not_found' | 'not_waiting' | 'reason_required'>> {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      const auto = await this.lockAutomation(c, kind, 'UPDATE');
      const post = await this.lockPost(c, id);
      const check = checkRejection(post.state, reason);
      if (!check.ok) throw new Refused(check.refusal);
      await c.query(
        `UPDATE social_post
            SET state = 'rejected', decided_by = $2, decided_by_name = $3, decided_at = now(), decided_reason = $4
          WHERE id = $1`,
        [id, actor.id, actor.name, reason.trim()],
      );
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.reject',
        targetType: 'social_post',
        targetId: id,
        reason: reason.trim(),
        previous: { state: post.state, clean_run: auto.clean_run },
        next: { state: 'rejected', clean_run: runAfter(auto, { type: 'rejected' }) },
      });
      await this.applyRun(c, auto, { type: 'rejected' });
      return null;
    });
  }

  /**
   * A person's edit of the caption only (the service checks the text first,
   * `checkCaptionEdit`): the post is frozen, so the old row is rejected
   * ("edited: <reason>") and a new one drafted from it with the new text and
   * the same card payload, `edited_from` naming the old, waiting for a person
   * (never the job's to approve). Resets the kind's run and leaves its level.
   */
  async edit(
    id: string,
    actor: SocialActor,
    body: string,
    reason: string,
  ): Promise<StoreOutcome<string, 'not_found' | 'not_waiting' | 'reason_required'>> {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      const auto = await this.lockAutomation(c, kind, 'UPDATE');
      const post = await this.lockPost(c, id);
      const check = checkRejection(post.state, reason);
      if (!check.ok) throw new Refused(check.refusal);
      await c.query(
        `UPDATE social_post
            SET state = 'rejected', decided_by = $2, decided_by_name = $3, decided_at = now(), decided_reason = $4
          WHERE id = $1`,
        [id, actor.id, actor.name, `edited: ${reason.trim()}`],
      );
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO social_post (fixture_id, kind, network, origin, template_version, body, payload,
                                  inputs, gates, forecast_id, model_version, sensitive, sensitive_reason,
                                  edited_from, expires_at)
         SELECT fixture_id, kind, network, origin, template_version, $2, payload, inputs, gates,
                forecast_id, model_version, sensitive, sensitive_reason, id, expires_at
           FROM social_post WHERE id = $1
         RETURNING id`,
        [id, body],
      );
      const edited = rows[0]!.id;
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.edit',
        targetType: 'social_post',
        targetId: id,
        reason: reason.trim(),
        previous: { state: post.state, body: post.body, clean_run: auto.clean_run },
        next: {
          id: edited,
          state: 'pending_approval',
          body,
          clean_run: runAfter(auto, { type: 'edited' }),
        },
      });
      await this.applyRun(c, auto, { type: 'edited' });
      return edited;
    });
  }

  /**
   * A person settles a post the network never answered for, from Buffer:
   * `published` (with Buffer's reference) or `refused` (its slot given back).
   * Either way the run stays reset: the post was not clean.
   */
  async settle(
    id: string,
    actor: SocialActor,
    to: { state: 'published'; providerRef: string } | { state: 'refused' },
    reason: string,
  ): Promise<
    StoreOutcome<null, 'not_found' | 'not_unknown' | 'reason_required' | 'reference_required'>
  > {
    const kind = await this.kindOf(id);
    if (kind === null) return { ok: false, refusal: 'not_found' };
    return this.tx(async (c) => {
      const post = await this.lockPost(c, id);
      if (post.state !== 'unknown') throw new Refused('not_unknown');
      if (reason.trim() === '') throw new Refused('reason_required');
      if (to.state === 'published') {
        if (to.providerRef.trim() === '') throw new Refused('reference_required');
        await c.query(
          `UPDATE social_post
              SET state = 'published', provider_ref = $2, published_at = now(),
                  decided_by = $3, decided_by_name = $4, decided_at = now(), decided_reason = $5
            WHERE id = $1`,
          [id, to.providerRef.trim(), actor.id, actor.name, reason.trim()],
        );
      } else {
        await c.query(
          `UPDATE social_post
              SET state = 'refused', slot = NULL, post_day = NULL, claimed_at = NULL,
                  decided_by = $2, decided_by_name = $3, decided_at = now(), decided_reason = $4
            WHERE id = $1`,
          [id, actor.id, actor.name, reason.trim()],
        );
      }
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.settle',
        targetType: 'social_post',
        targetId: id,
        reason: reason.trim(),
        previous: { state: post.state, post_day: post.post_day, slot: post.slot },
        next: { state: to.state },
      });
      return null;
    });
  }

  /**
   * The kill switch: either account stops or resumes publishing, with a
   * reason. A stop lowers every automatic kind as `automation` (keeping its
   * run) and sends the job's approved or refused posts back to a person.
   */
  async setSwitch(
    actor: SocialActor,
    stop: boolean,
    reason: string,
  ): Promise<StoreOutcome<null, 'no_change' | 'reason_required'>> {
    return this.tx(async (c) => {
      const { rows } = await c.query<{
        stopped: boolean;
        changed_at: Date | null;
        changed_by_name: string | null;
        reason: string | null;
      }>(`SELECT stopped, changed_at, changed_by_name, reason FROM social_switch FOR UPDATE`);
      const before = rows[0]!;
      const check = checkSwitch(before.stopped, stop, reason);
      if (!check.ok) throw new Refused(check.refusal);
      await c.query(
        `UPDATE social_switch
            SET stopped = $1, changed_at = now(), changed_by = $2, changed_by_name = $3, reason = $4`,
        [stop, actor.id, actor.name, reason.trim()],
      );
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.kill',
        targetType: 'social_switch',
        targetId: 'switch',
        reason: reason.trim(),
        previous: {
          stopped: before.stopped,
          changed_at: before.changed_at?.toISOString() ?? null,
          changed_by: before.changed_by_name,
          reason: before.reason,
        },
        next: { stopped: stop },
      });
      if (stop) {
        const kinds = await c.query<AutomationRow>(
          `SELECT kind, level, clean_run, level_changed_at, level_changed_by, level_changed_by_name, level_reason
             FROM social_automation ORDER BY kind FOR UPDATE`,
        );
        for (const auto of kinds.rows) await this.applyRun(c, auto, { type: 'kill_switch' });
        await this.backToPerson(c, null, 'publishing was stopped');
      }
      return null;
    });
  }

  /**
   * A kind's level, the owner's only (`console_user.owner`), both ways, with a
   * reason; a raise only from a run of 14, only while publishing runs, and
   * with a reason of its own, not the last change's (review of PR #893, round
   * 2). Every change records its own time, person and reason. A lowering
   * sends the job's approved or refused posts of the kind back to a person.
   */
  async setLevel(
    actor: SocialActor,
    kind: SocialPostKind,
    to: SocialAutomationLevel,
    reason: string,
  ): Promise<
    StoreOutcome<
      null,
      | 'not_owner'
      | 'no_change'
      | 'not_eligible'
      | 'stopped'
      | 'reason_required'
      | 'reason_not_fresh'
    >
  > {
    return this.tx(async (c) => {
      const stopped = await this.lockSwitch(c, 'SHARE');
      const auto = await this.lockAutomation(c, kind, 'UPDATE');
      const owner = await c.query<{ owner: boolean }>(
        `SELECT owner FROM console_user WHERE id = $1 AND disabled_at IS NULL`,
        [actor.id],
      );
      const check = checkLevelChange({
        owner: owner.rows[0]?.owner === true,
        from: auto.level,
        to,
        clean_run: auto.clean_run,
        stopped,
        reason,
      });
      if (!check.ok) throw new Refused(check.refusal);
      if (to === 'automatic' && reason.trim() === (auto.level_reason ?? '').trim()) {
        throw new Refused('reason_not_fresh');
      }
      await c.query(
        `UPDATE social_automation
            SET level = $2, level_changed_at = clock_timestamp(), level_changed_by = $3,
                level_changed_by_name = $4, level_reason = $5
          WHERE kind = $1`,
        [kind, to, actor.id, actor.name, reason.trim()],
      );
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.level',
        targetType: 'social_automation',
        targetId: kind,
        reason: reason.trim(),
        previous: automationRecord(auto),
        next: { level: to, clean_run: auto.clean_run },
      });
      if (to === 'approval') await this.backToPerson(c, kind, `${kind} was lowered to approval`);
      return null;
    });
  }

  // -------------------------------------------------------------------------
  // The publisher's reads (T-1837).
  // -------------------------------------------------------------------------

  /**
   * The posts a network may publish now: approved, or refused and still
   * valid, with the competition's rank as frozen at drafting and when the row
   * last changed (a refused post waits for a slot after its refusal).
   */
  async publishable(network: SocialNetwork, now: Date): Promise<PublishableRow[]> {
    const { rows } = await this.pool.query<PublishableRow>(
      `SELECT id, kind, state, approved_by_name, updated_at, expires_at,
              payload->>'kick_off' AS kick_off,
              CASE WHEN jsonb_typeof(inputs->'competition_rank') = 'number'
                   THEN (inputs->>'competition_rank')::int END AS competition_rank
         FROM social_post
        WHERE network = $1 AND state IN ('approved', 'refused') AND expires_at > $2
        ORDER BY created_at`,
      [network, now.toISOString()],
    );
    return rows;
  }

  /**
   * Runs the job's tick alone: a session advisory lock held on one connection
   * for its length; null, doing nothing, when another tick holds it (review
   * of PR #895: drafting once is the code's, beyond the one live row).
   */
  async exclusive<T>(work: () => Promise<T>): Promise<T | null> {
    const c = await this.pool.connect();
    // A connection whose unlock failed may still hold the lock: it is thrown away, not pooled.
    let broken: Error | undefined;
    try {
      const { rows } = await c.query<{ got: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('social_publishing_tick')) AS got`,
      );
      if (rows[0]?.got !== true) return null;
      try {
        return await work();
      } finally {
        await c
          .query(`SELECT pg_advisory_unlock(hashtext('social_publishing_tick'))`)
          .catch((error: unknown) => {
            broken = error instanceof Error ? error : new Error(String(error));
          });
      }
    } finally {
      c.release(broken);
    }
  }

  /** The slots of a network's London day already held (publishing, published or unknown). */
  async heldSlots(network: SocialNetwork, day: string): Promise<number[]> {
    const { rows } = await this.pool.query<{ slot: number }>(
      `SELECT slot FROM social_post
        WHERE network = $1 AND post_day = $2::date AND slot IS NOT NULL
          AND state IN ('publishing', 'published', 'unknown')`,
      [network, day],
    );
    return rows.map((r) => r.slot);
  }

  /** Posts claimed before `before` and still `publishing`: their publisher never recorded an answer. */
  async staleClaims(before: Date): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM social_post WHERE state = 'publishing' AND claimed_at < $1 ORDER BY claimed_at`,
      [before.toISOString()],
    );
    return rows.map((r) => r.id);
  }

  /** Per network, the newest publication and the newest attempt (a claim or its outcome), for `/health/social`. */
  async lastByNetwork(): Promise<
    {
      network: SocialNetwork;
      published_at: Date | null;
      state: SocialPostState | null;
      at: Date | null;
    }[]
  > {
    const { rows } = await this.pool.query<{
      network: SocialNetwork;
      published_at: Date | null;
      state: SocialPostState | null;
      at: Date | null;
    }>(
      `SELECT n.network,
              (SELECT max(published_at) FROM social_post p WHERE p.network = n.network) AS published_at,
              a.state, a.at
         FROM unnest(ARRAY['x', 'instagram']) AS n(network)
         LEFT JOIN LATERAL (
           SELECT state, updated_at AS at FROM social_post p
            WHERE p.network = n.network AND (p.claimed_at IS NOT NULL OR p.state IN ('refused', 'published'))
            ORDER BY updated_at DESC LIMIT 1
         ) a ON true`,
    );
    return rows;
  }

  // -------------------------------------------------------------------------
  // The publisher's key (T-1837; the console's field is T-1836). Stored
  // sealed; the sealing is the caller's, the opening the publisher's only.
  // -------------------------------------------------------------------------

  /** The sealed key of a provider, or null. Read by the publisher alone. */
  async credential(provider: string): Promise<StoredCredential | null> {
    const { rows } = await this.pool.query<StoredCredential>(
      `SELECT id, iv, tag, ciphertext FROM social_credential WHERE provider = $1`,
      [provider],
    );
    return rows[0] ?? null;
  }

  /** Who set a provider's key and when, never the key: "set on <date> by <who>", or null. */
  async credentialRecord(provider: string): Promise<{ set_at: Date; set_by: string } | null> {
    const { rows } = await this.pool.query<{ set_at: Date; set_by: string }>(
      `SELECT set_at, set_by_name AS set_by FROM social_credential WHERE provider = $1`,
      [provider],
    );
    return rows[0] ?? null;
  }

  /**
   * Sets a provider's key, sealed by `seal` with the row's id (the associated
   * data), replacing any before it, with its audit row: the previous value is
   * "set on <date> by <who>" or "not set", never the key.
   */
  async setCredential(
    provider: string,
    actor: SocialActor,
    seal: (rowId: string) => SealedSecret,
    reason: string,
  ): Promise<StoreOutcome<{ set_at: Date }, 'reason_required'>> {
    return this.tx(async (c) => {
      if (reason.trim() === '') throw new Refused('reason_required');
      // Two settings at once would each seal for a row id of their own.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('social_credential'))`);
      const before = await this.lockCredential(c, provider);
      const id = before?.id ?? randomUUID();
      const sealed = seal(id);
      const { rows } = await c.query<{ set_at: Date }>(
        before === null
          ? `INSERT INTO social_credential (id, provider, ciphertext, iv, tag, set_at, set_by, set_by_name)
             VALUES ($1, $2, $3, $4, $5, now(), $6, $7) RETURNING set_at`
          : `UPDATE social_credential
                SET ciphertext = $3, iv = $4, tag = $5, set_at = now(), set_by = $6, set_by_name = $7
              WHERE id = $1 AND provider = $2 RETURNING set_at`,
        [id, provider, sealed.ciphertext, sealed.iv, sealed.tag, actor.id, actor.name],
      );
      const setAt = rows[0]!.set_at;
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.credential',
        targetType: 'social_credential',
        targetId: provider,
        reason: reason.trim(),
        previous: { key: credentialWords(before) },
        next: { key: credentialWords({ set_at: setAt, set_by_name: actor.name }) },
      });
      return { set_at: setAt };
    });
  }

  /** Clears a provider's key, with a reason and its audit row; publishing then stops. */
  async clearCredential(
    provider: string,
    actor: SocialActor,
    reason: string,
  ): Promise<StoreOutcome<null, 'reason_required' | 'not_set'>> {
    return this.tx(async (c) => {
      if (reason.trim() === '') throw new Refused('reason_required');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('social_credential'))`);
      const before = await this.lockCredential(c, provider);
      if (before === null) throw new Refused('not_set');
      await c.query(`DELETE FROM social_credential WHERE id = $1`, [before.id]);
      await this.audit.write(c, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'social.credential',
        targetType: 'social_credential',
        targetId: provider,
        reason: reason.trim(),
        previous: { key: credentialWords(before) },
        next: { key: 'not set' },
      });
      return null;
    });
  }

  private async lockCredential(
    c: PoolClient,
    provider: string,
  ): Promise<{ id: string; set_at: Date; set_by_name: string } | null> {
    const { rows } = await c.query<{ id: string; set_at: Date; set_by_name: string }>(
      `SELECT id, set_at, set_by_name FROM social_credential WHERE provider = $1 FOR UPDATE`,
      [provider],
    );
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Inside a transaction.
  // -------------------------------------------------------------------------

  /**
   * A kind's run after an event (`afterEvent`): the new run, and a lowering
   * by `automation` with its audit row and the job's posts of the kind sent
   * back to a person. The caller holds the kind's row `FOR UPDATE`.
   */
  private async applyRun(c: PoolClient, auto: AutomationRow, event: RunEvent): Promise<void> {
    const { next, lowered } = afterEvent({ level: auto.level, clean_run: auto.clean_run }, event);
    if (lowered !== null) {
      await c.query(
        `UPDATE social_automation
            SET level = 'approval', clean_run = $2, level_changed_at = clock_timestamp(),
                level_changed_by = NULL, level_changed_by_name = $3, level_reason = $4
          WHERE kind = $1`,
        [auto.kind, next.clean_run, SOCIAL_AUTOMATION_ACTOR, lowered.reason],
      );
      await this.audit.write(c, {
        actorId: null,
        actorName: SOCIAL_AUTOMATION_ACTOR,
        action: lowered.action,
        targetType: 'social_automation',
        targetId: auto.kind,
        reason: lowered.reason,
        previous: automationRecord(auto),
        next: lowered.next,
      });
      await this.backToPerson(c, auto.kind, `${auto.kind} was lowered: ${lowered.reason}`);
    } else if (next.clean_run !== auto.clean_run) {
      await c.query(`UPDATE social_automation SET clean_run = $2 WHERE kind = $1`, [
        auto.kind,
        next.clean_run,
      ]);
    }
  }

  /**
   * The job's `approved` or `refused` posts (of one kind, or all) go back to
   * a person, their approval withdrawn (`backToPerson` in the rules), each
   * with its audit row.
   */
  private async backToPerson(
    c: PoolClient,
    kind: SocialPostKind | null,
    reason: string,
  ): Promise<void> {
    const { rows } = await c.query<{ id: string; state: SocialPostState }>(
      `SELECT id, state FROM social_post
        WHERE approved_by_name = $1 AND state IN ('approved', 'refused')
          AND ($2::text IS NULL OR kind = $2)
        ORDER BY id FOR UPDATE`,
      [SOCIAL_AUTOMATION_ACTOR, kind],
    );
    for (const row of rows) {
      await c.query(
        `UPDATE social_post
            SET state = 'pending_approval', approved_by = NULL, approved_by_name = NULL, approved_at = NULL
          WHERE id = $1`,
        [row.id],
      );
      await this.audit.write(c, {
        actorId: null,
        actorName: SOCIAL_AUTOMATION_ACTOR,
        action: 'social.withdraw',
        targetType: 'social_post',
        targetId: row.id,
        reason,
        previous: { state: row.state, approved_by: SOCIAL_AUTOMATION_ACTOR },
        next: { state: 'pending_approval' },
      });
    }
  }

  private async lockSwitch(c: PoolClient, mode: 'SHARE' | 'UPDATE'): Promise<boolean> {
    const { rows } = await c.query<{ stopped: boolean }>(
      `SELECT stopped FROM social_switch FOR ${mode}`,
    );
    return rows[0]?.stopped ?? true;
  }

  private async lockAutomation(
    c: PoolClient,
    kind: SocialPostKind,
    mode: 'SHARE' | 'UPDATE',
  ): Promise<AutomationRow> {
    const { rows } = await c.query<AutomationRow>(
      `SELECT kind, level, clean_run, level_changed_at, level_changed_by, level_changed_by_name, level_reason
         FROM social_automation WHERE kind = $1 FOR ${mode}`,
      [kind],
    );
    return rows[0]!;
  }

  private async lockPost(c: PoolClient, id: string): Promise<SocialPostRecord> {
    const { rows } = await c.query<SocialPostRecord>(
      `SELECT ${POST_COLUMNS} FROM social_post WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0]!;
  }

  /** A post's kind, a frozen column, read before the locks are taken in their order. */
  private async kindOf(id: string): Promise<SocialPostKind | null> {
    const { rows } = await this.pool.query<{ kind: SocialPostKind }>(
      `SELECT kind FROM social_post WHERE id = $1`,
      [id],
    );
    return rows[0]?.kind ?? null;
  }

  private async tx<T, R extends string>(
    work: (c: PoolClient) => Promise<T>,
  ): Promise<StoreOutcome<T, R>> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const value = await work(c);
      await c.query('COMMIT');
      return { ok: true, value };
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (error instanceof Refused) {
        return error.gates === undefined
          ? { ok: false, refusal: error.refusal as R }
          : { ok: false, refusal: error.refusal as R, gates: error.gates };
      }
      throw error;
    } finally {
      c.release();
    }
  }
}
