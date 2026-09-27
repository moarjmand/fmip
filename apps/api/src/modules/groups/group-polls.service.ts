import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { CreateGroupPollRequest, GroupPoll } from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { type GroupRow, GroupsStore } from './internal/groups-store';
import { pollView, validatePoll, validateRemovalReason } from './internal/polls';
import { PollsStore } from './internal/polls-store';

/**
 * Why a poll verb was refused. `members_only` is not `forbidden`: one says
 * polls are for the people *in* the group, the other that this is for the
 * people who *run* it (or, for closing, who asked).
 */
export type PollRefusal =
  | 'not_found'
  | 'members_only'
  | 'forbidden'
  | 'invalid'
  | 'poll_closed'
  | 'poll_limit'
  | 'restricted'
  | 'rate_limited';

export type PollOutcome<T> =
  { ok: true; value: T } | { ok: false; reason: PollRefusal; fields?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function code(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

/**
 * Group polls (blueprint 8.2, T-643, D-091). A member's question to their
 * group, answered as counts, inside the groups boundary because a poll is the
 * group's and its audience is the membership. Who may see a poll is who is in
 * the group -- even a public group's polls are for its members -- and an
 * invite-only group nobody may know about stays `not_found` here too.
 *
 * Like the rest of this boundary it decides who is asking and what they are
 * shown; whether they may write is the schema's, and a refusal the database
 * made is repeated as a sentence rather than decided twice.
 *
 * A poll is not one of the prediction products (rule 6) and nothing here reads
 * or writes one.
 */
@Injectable()
export class GroupPollsService {
  private readonly groups: GroupsStore;
  private readonly polls: PollsStore;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.groups = new GroupsStore(pool);
    this.polls = new PollsStore(pool);
  }

  async list(viewerId: string, slug: string): Promise<PollOutcome<GroupPoll[]>> {
    const found = await this.member(viewerId, slug);
    if (!found.ok) return found;
    const { group, role } = found.value;
    const records = await this.polls.list(group.id, viewerId);
    return { ok: true, value: records.map((r) => pollView(r, { id: viewerId, role })) };
  }

  async create(
    viewerId: string,
    slug: string,
    body: Partial<CreateGroupPollRequest> | null,
  ): Promise<PollOutcome<GroupPoll>> {
    const found = await this.member(viewerId, slug);
    if (!found.ok) return found;
    const checked = validatePoll(body);
    if (!checked.ok) return { ok: false, reason: 'invalid', fields: checked.fields };
    try {
      const id = await this.polls.create(found.value.group.id, viewerId, checked.poll);
      return this.one(viewerId, found.value, id);
    } catch (error) {
      if (code(error) === '23505')
        return {
          ok: false,
          reason: 'invalid',
          fields: { options: 'Each option must be different.' },
        };
      return this.refusal(error);
    }
  }

  async vote(
    viewerId: string,
    slug: string,
    pollId: string,
    optionId: unknown,
  ): Promise<PollOutcome<GroupPoll>> {
    const found = await this.poll(viewerId, slug, pollId);
    if (!found.ok) return found;
    if (typeof optionId !== 'string' || !UUID.test(optionId))
      return { ok: false, reason: 'invalid', fields: { option_id: 'Choose one of the options.' } };
    if (!found.value.poll.options.some((o) => o.id === optionId))
      return { ok: false, reason: 'invalid', fields: { option_id: 'Choose one of the options.' } };
    try {
      await this.polls.vote(pollId, viewerId, optionId);
    } catch (error) {
      return this.refusal(error);
    }
    return this.one(viewerId, found.value, pollId);
  }

  async withdraw(viewerId: string, slug: string, pollId: string): Promise<PollOutcome<GroupPoll>> {
    const found = await this.poll(viewerId, slug, pollId);
    if (!found.ok) return found;
    const view = pollView(found.value.poll, { id: viewerId, role: found.value.role });
    if (view.status === 'closed') return { ok: false, reason: 'poll_closed' };
    await this.polls.withdraw(pollId, viewerId);
    return this.one(viewerId, found.value, pollId);
  }

  /** The creator, or the group's owner, closes a poll before its time. */
  async close(viewerId: string, slug: string, pollId: string): Promise<PollOutcome<GroupPoll>> {
    const found = await this.poll(viewerId, slug, pollId);
    if (!found.ok) return found;
    const view = pollView(found.value.poll, { id: viewerId, role: found.value.role });
    if (view.status === 'closed') return { ok: false, reason: 'poll_closed' };
    if (!view.may_close) return { ok: false, reason: 'forbidden' };
    try {
      await this.polls.close(pollId, viewerId);
    } catch (error) {
      return this.refusal(error);
    }
    return this.one(viewerId, found.value, pollId);
  }

  /**
   * The group's owner or a moderator removes a poll, with a reason; the
   * audit row is written with the removal (rule 10).
   */
  async remove(
    viewerId: string,
    slug: string,
    pollId: string,
    reason: unknown,
  ): Promise<PollOutcome<true>> {
    const found = await this.poll(viewerId, slug, pollId);
    if (!found.ok) return found;
    if (found.value.role !== 'owner' && found.value.role !== 'moderator')
      return { ok: false, reason: 'forbidden' };
    const text = validateRemovalReason(reason);
    if (text === null)
      return {
        ok: false,
        reason: 'invalid',
        fields: { reason: 'Say why, in at most 500 characters.' },
      };
    const removed = await this.polls.remove(found.value.poll, found.value.group.id, viewerId, text);
    return removed ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
  }

  // -------------------------------------------------------------------------

  /** The group, when the viewer is in it. */
  private async member(
    viewerId: string,
    slug: string,
  ): Promise<PollOutcome<{ group: GroupRow; role: string }>> {
    const group = await this.groups.bySlug(slug.toLowerCase());
    if (group === null) return { ok: false, reason: 'not_found' };
    const role = await this.groups.role(group.id, viewerId);
    if (role === null) {
      // An invite-only group is not findable, and a poll is not a way to find
      // one; an invitation is itself being told it exists (the rule `read()` follows).
      if (group.visibility === 'invite_only' && !(await this.groups.hasInvite(group.id, viewerId)))
        return { ok: false, reason: 'not_found' };
      return { ok: false, reason: 'members_only' };
    }
    return { ok: true, value: { group, role } };
  }

  private async poll(viewerId: string, slug: string, pollId: string) {
    const found = await this.member(viewerId, slug);
    if (!found.ok) return found;
    if (!UUID.test(pollId)) return { ok: false as const, reason: 'not_found' as const };
    const [poll] = await this.polls.list(found.value.group.id, viewerId, pollId, 1);
    if (poll === undefined) return { ok: false as const, reason: 'not_found' as const };
    return { ok: true as const, value: { ...found.value, poll } };
  }

  private async one(
    viewerId: string,
    found: { group: GroupRow; role: string },
    pollId: string,
  ): Promise<PollOutcome<GroupPoll>> {
    const [poll] = await this.polls.list(found.group.id, viewerId, pollId, 1);
    if (poll === undefined) return { ok: false, reason: 'not_found' };
    return { ok: true, value: pollView(poll, { id: viewerId, role: found.role }) };
  }

  /** A refusal the database made, said once. */
  private refusal<T>(error: unknown): PollOutcome<T> {
    switch (code(error)) {
      case 'PL004':
        return { ok: false, reason: 'restricted' };
      case 'PL005':
        return { ok: false, reason: 'rate_limited' };
      case 'PL006':
        return { ok: false, reason: 'members_only' };
      case 'PL018':
        return { ok: false, reason: 'poll_closed' };
      case 'PL019':
        return { ok: false, reason: 'poll_limit' };
      case '23503':
      case '23514':
        return { ok: false, reason: 'invalid' };
      default:
        throw error;
    }
  }
}
