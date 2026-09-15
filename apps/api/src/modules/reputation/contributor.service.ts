import { Injectable } from '@nestjs/common';
import type {
  ContributorEligibility,
  ContributorGrant,
  ContributorListResponse,
  ContributorStatusResponse,
} from '@fmip/contracts';
import { IdentityService } from '../identity/identity.service';
import {
  PostgresContributorStore,
  type GrantEventRow,
  type GrantRow,
} from './internal/contributor-store';
import { ELIGIBILITY_V1, eligibilityFor } from './internal/eligibility';

/**
 * Contributor eligibility and contributor grants (blueprint 9.4 and 10.2,
 * T-250).
 *
 * **The whole point of this service is that it has two verbs and they are not
 * the same verb.** `statusOf` computes; `grant`, `pause`, `resume` and
 * `withdraw` record what a person decided. There is no method that reads
 * eligibility and writes a grant, and there should never be one: the fifth
 * requirement in blueprint 10.2 is a human being, and a function that satisfied
 * it automatically would have deleted it.
 *
 * What may be refused is not decided here either. Whether a transition is
 * possible is the schema's (`PL013`); this service turns that refusal into a
 * sentence rather than predicting it.
 */

const MAX_CANDIDATES = 200;
const DEFAULT_CANDIDATES = 50;

/** The database's word for "you cannot do that to this grant" (T-250). */
export const IMPOSSIBLE_TRANSITION = 'PL013';

export interface GrantFailure {
  ok: false;
  /** `unknown_member`, `no_grant`, or the database's hint for a refused transition. */
  why: string;
}

export type GrantOutcome = { ok: true; grant: ContributorGrant } | GrantFailure;

function hintOf(error: unknown): string | undefined {
  const e = error as { code?: string; hint?: string };
  return e.code === IMPOSSIBLE_TRANSITION ? (e.hint ?? 'refused') : undefined;
}

function asGrant(row: GrantRow, history: GrantEventRow[]): ContributorGrant {
  return {
    id: row.id,
    username: row.username,
    standing: row.standing as ContributorGrant['standing'],
    granted_by: row.granted_by,
    reason: row.reason,
    granted_at: row.granted_at.toISOString(),
    rules_version: row.rules_version,
    accepted_at: row.accepted_at.toISOString(),
    history: history.map((e) => ({
      kind: e.kind as ContributorGrant['history'][number]['kind'],
      actor: e.actor,
      reason: e.reason,
      at: e.at.toISOString(),
    })),
  };
}

@Injectable()
export class ContributorService {
  constructor(
    private readonly store: PostgresContributorStore,
    private readonly identity: IdentityService,
  ) {}

  /** The four requirements, computed. Grants nothing and never has. */
  async eligibilityOf(userId: string): Promise<ContributorEligibility | null> {
    const facts = await this.store.factsFor(userId, ELIGIBILITY_V1.conductWindowDays);
    return facts === null ? null : eligibilityFor(facts);
  }

  /**
   * Both halves, for the member they are about.
   *
   * `grant` is the newest one whatever its standing, so that "withdrawn" and
   * "never considered" do not render the same. They are different facts and
   * only one of them is owed an explanation (rule 3).
   */
  async statusOf(userId: string, username: string): Promise<ContributorStatusResponse | null> {
    const [eligibility, held] = await Promise.all([
      this.eligibilityOf(userId),
      this.store.grantFor(userId),
    ]);
    if (eligibility === null) return null;
    return {
      username,
      eligibility,
      grant: held === null ? null : asGrant(held.grant, held.history),
    };
  }

  /** Who a reviewer might be deciding about: everybody who qualifies, and everybody who holds one. */
  async candidates(limit = DEFAULT_CANDIDATES): Promise<ContributorListResponse> {
    const capped = Math.min(Math.max(limit, 1), MAX_CANDIDATES);
    const rows = await this.store.candidates(ELIGIBILITY_V1, capped);
    const entries = await Promise.all(
      rows.map(async (row) => {
        const held = await this.store.grantFor(row.user_id);
        return {
          username: row.username,
          eligibility: eligibilityFor(row.facts),
          grant: held === null ? null : asGrant(held.grant, held.history),
        };
      }),
    );
    return { generated_at: new Date().toISOString(), entries };
  }

  /**
   * Approve somebody.
   *
   * **It does not check eligibility, and that is the decision.** An approver
   * looking at the queue has the four requirements in front of them; refusing
   * the write here would put the platform's arithmetic above a person's
   * judgement, which is the opposite of what blueprint 10.2 asks for. What is
   * recorded is who decided and why, so the decision can be read afterwards and
   * argued with.
   */
  async grant(
    approverId: string,
    username: string,
    reason: string,
    rulesVersion: string,
  ): Promise<GrantOutcome> {
    const user = await this.identity.userByUsername(username.toLowerCase());
    if (user === null) return { ok: false, why: 'unknown_member' };
    try {
      await this.store.grant(user.id, approverId, reason, rulesVersion);
    } catch (error) {
      const hint = hintOf(error);
      if (hint !== undefined) return { ok: false, why: hint };
      throw error;
    }
    const held = await this.store.grantFor(user.id);
    if (held === null) return { ok: false, why: 'unknown_member' };
    return { ok: true, grant: asGrant(held.grant, held.history) };
  }

  /** Pause, resume or withdraw the member's live grant. */
  async change(
    actorId: string,
    username: string,
    kind: 'paused' | 'resumed' | 'withdrawn',
    reason: string,
  ): Promise<GrantOutcome> {
    const user = await this.identity.userByUsername(username.toLowerCase());
    if (user === null) return { ok: false, why: 'unknown_member' };
    const grantId = await this.store.liveGrantId(user.id);
    // Never held one, or the last one was withdrawn. Either way there is
    // nothing to act on, and inventing a grant to withdraw would be worse than
    // saying so.
    if (grantId === null) return { ok: false, why: 'no_grant' };
    try {
      await this.store.addEvent(grantId, kind, actorId, reason, user.id);
    } catch (error) {
      const hint = hintOf(error);
      if (hint !== undefined) return { ok: false, why: hint };
      throw error;
    }
    const held = await this.store.grantFor(user.id);
    if (held === null) return { ok: false, why: 'no_grant' };
    return { ok: true, grant: asGrant(held.grant, held.history) };
  }
}
