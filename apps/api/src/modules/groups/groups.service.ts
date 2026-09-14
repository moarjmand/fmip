import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  type CreateGroupRequest,
  GROUP_ROLES,
  GROUP_SLUG_PATTERN,
  GROUP_VISIBILITIES,
  type Group,
  type GroupInvite,
  type GroupJoinRequest,
  type GroupMember,
  type GroupRole,
  type GroupStanding,
  type GroupSummary,
  type GroupVisibility,
  MAX_GROUP_DESCRIPTION,
  MAX_GROUP_NAME,
  MAX_JOIN_NOTE,
  MIN_GROUP_NAME,
  type UpdateGroupRequest,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import {
  type GroupRow,
  GroupsStore,
  type InviteRow,
  type MemberRow,
} from './internal/groups-store';

/** How many groups a directory page shows. */
export const DIRECTORY_LIMIT = 50;

/**
 * Why a verb was refused. One list, mapped to status codes once, in the
 * controller.
 *
 * `unavailable` never says "they blocked you", the same as everywhere else in
 * this product; `restricted` never says which sanction. Both are refusals the
 * database made, repeated rather than decided here.
 */
export type GroupRefusal =
  | 'not_found'
  | 'forbidden'
  | 'invalid'
  | 'conflict'
  | 'last_owner'
  | 'wrong_door'
  | 'restricted'
  | 'unavailable'
  | 'rate_limited';

/**
 * The answer to "who is in this group, and may you ask" (T-243). Narrower than
 * `GroupOutcome` on purpose: the two refusals here are the only two this
 * question has, and the caller is another module's controller, which should not
 * have to map refusals it can never receive.
 *
 * `members_only` is not `forbidden`: one says this is for the people who *run*
 * the group and the other that it is for the people who are *in* it.
 */
export type GroupAudience =
  { ok: true; members: string[] } | { ok: false; reason: 'not_found' | 'members_only' };

export type GroupOutcome<T> =
  { ok: true; value: T } | { ok: false; reason: GroupRefusal; fields?: Record<string, string> };

const BLOCKED = 'PL003';
const SANCTIONED = 'PL004';
const OVER_RATE = 'PL005';
const SLUG_FIXED = 'PL008';
const LAST_OWNER = 'PL009';
const ALREADY_IN = 'PL010';
const WRONG_DOOR = 'PL011';
const UNIQUE = '23505';
const CHECK = '23514';

function code(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

function summary(row: GroupRow): GroupSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility as GroupVisibility,
    member_count: Number(row.member_count),
    created_at: row.created_at.toISOString(),
  };
}

/** One member, with the role narrowed to what the contract allows. */
function membership(row: MemberRow): GroupMember {
  return {
    username: row.username,
    display_name: row.display_name,
    role: row.role as GroupRole,
    joined_at: row.joined_at.toISOString(),
  };
}

function invitation(row: InviteRow): GroupInvite {
  return {
    group: summary(row),
    invited_by: row.invited_by,
    created_at: row.invited_at.toISOString(),
  };
}

/**
 * The groups boundary (blueprint 8.2 and the exclusive groups of 10.1, T-241).
 *
 * **It decides who is asking, and nothing about who may be where.** Membership,
 * roles, the one-owner rule, which visibility can be asked to join and who may
 * be invited are all the schema's (T-240, D-057). This service turns a refusal
 * the database made into a sentence and a status code — it never makes one of
 * its own that the database would have allowed, because the moment it does
 * there are two answers to the same question.
 *
 * The one thing it *does* decide is **what a stranger is shown**: an invite-only
 * group is `not_found` rather than `forbidden`, for the same reason a
 * conversation somebody is not in is (T-221). Telling a stranger a group exists
 * is already telling them something about the people in it.
 */
@Injectable()
export class GroupsService {
  private readonly store: GroupsStore;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new GroupsStore(pool);
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async directory(term: string): Promise<GroupSummary[]> {
    const rows = await this.store.directory(term.trim(), DIRECTORY_LIMIT);
    return rows.map(summary);
  }

  async mine(viewerId: string): Promise<GroupSummary[]> {
    return (await this.store.mine(viewerId)).map(summary);
  }

  /** One group as this viewer may see it, or `null` when they may not know. */
  async read(viewerId: string, slug: string): Promise<Group | null> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return null;

    const role = await this.store.role(row.id, viewerId);
    if (role === null && row.visibility === 'invite_only') {
      // Not "you may not": an invite-only group is not findable, and saying it
      // exists would be the one thing that visibility is for. An invitation is
      // the exception, because an invitation *is* being told it exists -- and a
      // list of invitations nobody can open would be a cruel joke.
      if (!(await this.store.hasInvite(row.id, viewerId))) return null;
    }

    const inside = role !== null;
    const decides = role === 'owner' || role === 'moderator';
    return {
      ...summary(row),
      standing: await this.standing(row, viewerId, role),
      // A conversation id somebody cannot open would be an invitation to a 404.
      // Every group has one; what varies is whether this viewer is in it.
      conversation_id: inside ? await this.store.conversationFor(row.id) : null,
      // A discoverable group is found, not read: its membership is exactly what
      // it does not show.
      members:
        inside || row.visibility === 'public'
          ? (await this.store.members(row.id)).map(membership)
          : null,
      pending: decides ? await this.store.pending(row.id) : null,
    };
  }

  /**
   * Who the group's board is drawn from, and whether this viewer may ask
   * (blueprint 8.2, T-243).
   *
   * **This boundary does not rank anybody.** It answers the one question the
   * reputation boundary cannot -- who is in this group -- and hands back a set
   * of ids. The ranking is `ReputationService.leaderboard` under the same rules
   * version, the same floor and the same formula as the global board, because a
   * second method is where a second formula begins.
   *
   * **Who may look is who may see the membership**, and for the same reason: a
   * board is a list of members with numbers beside them. So the predicate is
   * the one `read()` uses for `members` -- inside, or the group is public -- and
   * an invite-only group nobody may know about is still `not_found`.
   */
  async audience(viewerId: string, slug: string): Promise<GroupAudience> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };

    const role = await this.store.role(row.id, viewerId);
    if (role === null && row.visibility === 'invite_only') {
      // The same door `read()` opens: an invitation is itself being told the
      // group is there, so an invitee gets past it and a stranger does not.
      if (!(await this.store.hasInvite(row.id, viewerId)))
        return { ok: false, reason: 'not_found' };
    }
    if (role === null && row.visibility !== 'public') {
      return { ok: false, reason: 'members_only' };
    }
    return { ok: true, members: await this.store.memberIds(row.id) };
  }

  async invites(viewerId: string): Promise<GroupInvite[]> {
    return (await this.store.invitesFor(viewerId)).map(invitation);
  }

  async requests(viewerId: string, slug: string): Promise<GroupOutcome<GroupJoinRequest[]>> {
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;
    const rows = await this.store.requests(found.value.group.id);
    return {
      ok: true,
      value: rows.map((row) => ({
        username: row.username,
        display_name: row.display_name,
        note: row.note,
        created_at: row.created_at.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Making and changing a group
  // -------------------------------------------------------------------------

  async create(viewerId: string, request: CreateGroupRequest): Promise<GroupOutcome<GroupSummary>> {
    const fields = this.checkShape(request);
    if (fields !== null) return { ok: false, reason: 'invalid', fields };

    try {
      const row = await this.store.create(
        request.slug.toLowerCase(),
        request.name.trim(),
        request.description?.trim() ?? null,
        request.visibility,
        viewerId,
      );
      return { ok: true, value: summary(row) };
    } catch (error) {
      if (code(error) === UNIQUE) {
        return { ok: false, reason: 'conflict', fields: { slug: 'That handle is taken.' } };
      }
      return this.refusal(error);
    }
  }

  async update(
    viewerId: string,
    slug: string,
    patch: UpdateGroupRequest,
  ): Promise<GroupOutcome<true>> {
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;

    if (patch.name !== undefined) {
      const length = patch.name.trim().length;
      if (length < MIN_GROUP_NAME || length > MAX_GROUP_NAME) {
        return {
          ok: false,
          reason: 'invalid',
          fields: { name: `Between ${MIN_GROUP_NAME} and ${MAX_GROUP_NAME} characters.` },
        };
      }
    }
    if ((patch.description ?? '').length > MAX_GROUP_DESCRIPTION) {
      return {
        ok: false,
        reason: 'invalid',
        fields: { description: `At most ${MAX_GROUP_DESCRIPTION} characters.` },
      };
    }
    if (patch.visibility !== undefined && !GROUP_VISIBILITIES.includes(patch.visibility)) {
      return { ok: false, reason: 'invalid', fields: { visibility: 'Not a visibility.' } };
    }

    try {
      await this.store.update(found.value.group.id, {
        name: patch.name?.trim(),
        description:
          patch.description === undefined ? undefined : (patch.description?.trim() ?? null),
        visibility: patch.visibility,
      });
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  /** Only the owner. A moderator runs a group; they do not end one. */
  async remove(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const found = await this.owner(viewerId, slug);
    if (!found.ok) return found;
    await this.store.remove(found.value.group.id);
    return { ok: true, value: true };
  }

  // -------------------------------------------------------------------------
  // Getting in and out
  // -------------------------------------------------------------------------

  /** Joining a public group. Every other visibility has its own door. */
  async join(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };
    if (row.visibility !== 'public') {
      // The invite-only case stays `not_found`: a stranger must not learn it is
      // there by being told they cannot join it.
      return row.visibility === 'discoverable'
        ? { ok: false, reason: 'wrong_door' }
        : { ok: false, reason: 'not_found' };
    }
    try {
      await this.store.addMember(row.id, viewerId);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  async leave(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };
    try {
      const left = await this.store.removeMember(row.id, viewerId);
      return left ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
    } catch (error) {
      return this.refusal(error);
    }
  }

  async setRole(
    viewerId: string,
    slug: string,
    username: string,
    role: GroupRole,
  ): Promise<GroupOutcome<true>> {
    if (!GROUP_ROLES.includes(role)) {
      return { ok: false, reason: 'invalid', fields: { role: 'Not a role.' } };
    }
    const found = await this.owner(viewerId, slug);
    if (!found.ok) return found;

    const subject = await this.store.memberIdByUsername(username);
    if (subject === null) return { ok: false, reason: 'not_found' };
    const theirs = await this.store.role(found.value.group.id, subject);
    if (theirs === null) return { ok: false, reason: 'not_found' };
    if (subject === viewerId) {
      // Demoting yourself is how a group loses its owner. Hand it on instead.
      return { ok: false, reason: 'last_owner' };
    }

    try {
      if (role === 'owner') await this.store.handOver(found.value.group.id, viewerId, subject);
      else await this.store.setRole(found.value.group.id, subject, role);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  async removeMember(
    viewerId: string,
    slug: string,
    username: string,
  ): Promise<GroupOutcome<true>> {
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;

    const subject = await this.store.memberIdByUsername(username);
    if (subject === null) return { ok: false, reason: 'not_found' };
    const theirs = await this.store.role(found.value.group.id, subject);
    if (theirs === null) return { ok: false, reason: 'not_found' };
    // A moderator cannot remove an owner or another moderator; only the owner
    // can, and the owner cannot be removed at all.
    if (theirs === 'owner') return { ok: false, reason: 'last_owner' };
    if (theirs === 'moderator' && found.value.role !== 'owner') {
      return { ok: false, reason: 'forbidden' };
    }

    try {
      await this.store.removeMember(found.value.group.id, subject);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  /**
   * Inviting is reaching somebody, so it needs what reaching somebody needs.
   *
   * A verified e-mail, the same gate a friend request passes (T-201). An
   * invitation that arrives in a stranger's list is exactly the surface that
   * gate exists to keep an unverified account away from, and leaving it open
   * here would have been the rule holding everywhere but one door.
   */
  async invite(
    viewer: { id: string; emailVerified: boolean },
    slug: string,
    username: string,
  ): Promise<GroupOutcome<true>> {
    const viewerId = viewer.id;
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;
    if (!viewer.emailVerified) return { ok: false, reason: 'forbidden' };

    const invitee = await this.store.memberIdByUsername(username);
    if (invitee === null) return { ok: false, reason: 'not_found' };
    if (invitee === viewerId) return { ok: false, reason: 'invalid' };

    try {
      await this.store.invite(found.value.group.id, invitee, viewerId);
      return { ok: true, value: true };
    } catch (error) {
      if (code(error) === UNIQUE) return { ok: false, reason: 'conflict' };
      return this.refusal(error);
    }
  }

  async withdrawInvite(
    viewerId: string,
    slug: string,
    username: string,
  ): Promise<GroupOutcome<true>> {
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;
    const invitee = await this.store.memberIdByUsername(username);
    if (invitee === null) return { ok: false, reason: 'not_found' };
    const gone = await this.store.withdrawInvite(found.value.group.id, invitee);
    return gone ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
  }

  async acceptInvite(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    // An invitation is the only thing that makes an invite-only group visible
    // to somebody outside it, so a missing one is `not_found` either way.
    if (row === null || !(await this.store.hasInvite(row.id, viewerId))) {
      return { ok: false, reason: 'not_found' };
    }
    try {
      await this.store.acceptInvite(row.id, viewerId);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  async declineInvite(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };
    const gone = await this.store.withdrawInvite(row.id, viewerId);
    return gone ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
  }

  // -------------------------------------------------------------------------
  // Join requests
  // -------------------------------------------------------------------------

  async askToJoin(
    viewerId: string,
    slug: string,
    note: string | null,
  ): Promise<GroupOutcome<true>> {
    if ((note ?? '').length > MAX_JOIN_NOTE) {
      return {
        ok: false,
        reason: 'invalid',
        fields: { note: `At most ${MAX_JOIN_NOTE} characters.` },
      };
    }
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null || row.visibility === 'invite_only') {
      return { ok: false, reason: 'not_found' };
    }
    try {
      await this.store.requestJoin(row.id, viewerId, note?.trim() ?? null);
      return { ok: true, value: true };
    } catch (error) {
      if (code(error) === UNIQUE) return { ok: false, reason: 'conflict' };
      return this.refusal(error);
    }
  }

  async answerRequest(
    viewerId: string,
    slug: string,
    username: string,
    accept: boolean,
  ): Promise<GroupOutcome<true>> {
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;
    const asker = await this.store.memberIdByUsername(username);
    if (asker === null) return { ok: false, reason: 'not_found' };
    if (!(await this.store.hasRequest(found.value.group.id, asker))) {
      return { ok: false, reason: 'not_found' };
    }

    try {
      if (accept) await this.store.acceptRequest(found.value.group.id, asker);
      else await this.store.dropRequest(found.value.group.id, asker);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  /** Withdrawing your own asking. Needs no privilege; getting out never does. */
  async withdrawRequest(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };
    const gone = await this.store.dropRequest(row.id, viewerId);
    return gone ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
  }

  // -------------------------------------------------------------------------

  /**
   * Where this viewer stands — one value, so every surface has to answer for
   * each case rather than falling through to "nothing to offer".
   */
  private async standing(
    row: GroupRow,
    viewerId: string,
    role: string | null,
  ): Promise<GroupStanding> {
    if (role !== null) return role as GroupStanding;
    if (await this.store.hasInvite(row.id, viewerId)) return 'invited';
    if (await this.store.hasRequest(row.id, viewerId)) return 'requested';
    if (row.visibility === 'public') return 'may_join';
    if (row.visibility === 'discoverable') return 'may_ask';
    return 'invite_only';
  }

  /** The group plus the viewer's role, when they may decide things in it. */
  private async decider(
    viewerId: string,
    slug: string,
  ): Promise<GroupOutcome<{ group: GroupRow; role: string }>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };
    const role = await this.store.role(row.id, viewerId);
    if (role === null) {
      return row.visibility === 'invite_only'
        ? { ok: false, reason: 'not_found' }
        : { ok: false, reason: 'forbidden' };
    }
    if (role !== 'owner' && role !== 'moderator') return { ok: false, reason: 'forbidden' };
    return { ok: true, value: { group: row, role } };
  }

  private async owner(
    viewerId: string,
    slug: string,
  ): Promise<GroupOutcome<{ group: GroupRow; role: string }>> {
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;
    if (found.value.role !== 'owner') return { ok: false, reason: 'forbidden' };
    return found;
  }

  private checkShape(request: CreateGroupRequest): Record<string, string> | null {
    const fields: Record<string, string> = {};
    if (!GROUP_SLUG_PATTERN.test(request.slug?.toLowerCase() ?? '')) {
      fields.slug = 'Three to forty characters: lower-case letters, digits and dashes.';
    }
    const name = request.name?.trim() ?? '';
    if (name.length < MIN_GROUP_NAME || name.length > MAX_GROUP_NAME) {
      fields.name = `Between ${MIN_GROUP_NAME} and ${MAX_GROUP_NAME} characters.`;
    }
    if ((request.description ?? '').length > MAX_GROUP_DESCRIPTION) {
      fields.description = `At most ${MAX_GROUP_DESCRIPTION} characters.`;
    }
    if (!GROUP_VISIBILITIES.includes(request.visibility)) {
      fields.visibility = 'Not a visibility.';
    }
    return Object.keys(fields).length === 0 ? null : fields;
  }

  /** A refusal the database made, said once. */
  private refusal<T>(error: unknown): GroupOutcome<T> {
    switch (code(error)) {
      case BLOCKED:
        return { ok: false, reason: 'unavailable' };
      case SANCTIONED:
        return { ok: false, reason: 'restricted' };
      case OVER_RATE:
        return { ok: false, reason: 'rate_limited' };
      case SLUG_FIXED:
        return { ok: false, reason: 'invalid', fields: { slug: 'A handle never changes.' } };
      case LAST_OWNER:
        return { ok: false, reason: 'last_owner' };
      case ALREADY_IN:
        return { ok: false, reason: 'conflict' };
      case WRONG_DOOR:
        return { ok: false, reason: 'wrong_door' };
      case UNIQUE:
        return { ok: false, reason: 'conflict' };
      case CHECK:
        return { ok: false, reason: 'invalid' };
      default:
        throw error;
    }
  }
}
