import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  type CreateGroupRequest,
  GROUP_FAVOURITE_TYPES,
  GROUP_INVITE_POLICIES,
  GROUP_ROLES,
  GROUP_SLUG_PATTERN,
  GROUP_VISIBILITIES,
  type Group,
  type GroupDirectoryFilters,
  type GroupFavourite,
  type GroupFavouriteRef,
  type GroupHistoryEntry,
  type GroupInvite,
  type GroupInvitePolicy,
  type GroupRules,
  MAX_GROUP_RULES,
  type GroupJoinRequest,
  type GroupMember,
  type GroupRole,
  type GroupStanding,
  type GroupSummary,
  MAX_GROUP_DESCRIPTION,
  MAX_GROUP_NAME,
  MAX_JOIN_NOTE,
  MIN_GROUP_NAME,
  type UpdateGroupRequest,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { LANGUAGE_TAG, UUID, groupSummary } from './internal/group-summary';
import {
  type DirectoryFilters,
  type GroupRow,
  GroupsStore,
  type RulesRow,
  type InviteRow,
  type MemberRow,
} from './internal/groups-store';
import { NotificationsService } from '../notifications/notifications.service';

/** How many groups a directory page shows. */
export const DIRECTORY_LIMIT = 50;
/** How many entries of a group's history one read returns. */
export const HISTORY_LIMIT = 100;

/**
 * Whether a role may invite under a policy (T-1020, D-132). The schema's
 * `group_may_invite()` is the rule; this is the same table, read only to say
 * `may_invite` on a group's page, never to refuse.
 */
export function mayInvite(policy: string, role: string | null): boolean {
  if (role === null) return false;
  if (policy === 'owner') return role === 'owner';
  if (policy === 'owner_and_moderators') return role === 'owner' || role === 'moderator';
  return true;
}

/** The sentence a refused inviter reads: which policy, in words. */
export function policySentence(policy: string): string {
  if (policy === 'owner') return "Only this group's owner invites people to it.";
  if (policy === 'owner_and_moderators') {
    return "Only this group's owner and moderators invite people to it.";
  }
  return 'Every member of this group may invite people to it.';
}

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
  | 'rate_limited'
  | 'policy'
  | 'rules'
  | 'closed';

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
  | { ok: true; value: T }
  | { ok: false; reason: GroupRefusal; fields?: Record<string, string>; message?: string };

const BLOCKED = 'PL003';
const SANCTIONED = 'PL004';
const NOT_PERMITTED = 'PL006';
const GROUP_CLOSED = 'PL020';
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

const FOREIGN_KEY = '23503';

const summary = groupSummary;

/**
 * A language and a favourite as sent, checked and shaped for the store, or
 * the fields that are wrong (T-1022). `undefined` in means "not sent", which
 * an update leaves alone.
 */
export function checkAbout(input: {
  language?: string | null;
  favourite?: GroupFavouriteRef | null;
}):
  | {
      ok: true;
      language: string | null | undefined;
      favourite: { team: string | null; competition: string | null } | undefined;
    }
  | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  let language: string | null | undefined;
  if (input.language !== undefined) {
    const tag = input.language === null ? '' : String(input.language).trim();
    if (tag === '') language = null;
    else if (LANGUAGE_TAG.test(tag)) language = tag;
    else fields.language = 'A language tag, such as en or pt-BR.';
  }
  let favourite: { team: string | null; competition: string | null } | undefined;
  if (input.favourite !== undefined) {
    const ref = input.favourite;
    if (ref === null) favourite = { team: null, competition: null };
    else if (
      typeof ref !== 'object' ||
      !GROUP_FAVOURITE_TYPES.includes(ref.type) ||
      typeof ref.id !== 'string' ||
      !UUID.test(ref.id)
    ) {
      fields.favourite = 'A club or a competition, by its id.';
    } else {
      favourite =
        ref.type === 'team'
          ? { team: ref.id, competition: null }
          : { team: null, competition: ref.id };
    }
  }
  return Object.keys(fields).length === 0
    ? { ok: true, language, favourite }
    : { ok: false, fields };
}

/**
 * The directory's filters from a query string (T-1022). A value that cannot be
 * one is left out rather than refused, the way the scores filters read theirs.
 */
export function directoryFilters(query: Record<string, unknown> | undefined): DirectoryFilters {
  const one = (value: unknown): string => {
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
    return typeof value === 'string' ? value : '';
  };
  const language = one(query?.language).trim();
  const team = one(query?.team).trim();
  const competition = one(query?.competition).trim();
  return {
    language: LANGUAGE_TAG.test(language) ? language : null,
    team: UUID.test(team) ? team.toLowerCase() : null,
    competition: UUID.test(competition) ? competition.toLowerCase() : null,
  };
}

function rulesView(row: RulesRow): GroupRules {
  return {
    version: row.version,
    body: row.body,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Whether what somebody accepted is the group's current rules (T-1023).
 * `null` latest: the group has none, and nothing needs accepting. Pure, so
 * the three refusals have a unit test.
 */
export function rulesCheck(
  latest: number | null,
  accepted: number | null | undefined,
): { ok: true; version: number | null } | { ok: false; message: string } {
  if (latest === null) return { ok: true, version: null };
  if (accepted === undefined || accepted === null) {
    return { ok: false, message: 'This group has rules. Read them and accept them to join.' };
  }
  if (accepted !== latest) {
    return {
      ok: false,
      message: "This group's rules have changed since you read them. Read the new version.",
    };
  }
  return { ok: true, version: latest };
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

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly notifications: NotificationsService,
  ) {
    this.store = new GroupsStore(pool);
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * The directory, filtered by name, language and favourite (T-1022), with
   * the filters echoed as they were read -- the favourite named, so the page
   * can say what it is showing.
   */
  async directory(
    term: string,
    filters: DirectoryFilters = { language: null, team: null, competition: null },
  ): Promise<{ groups: GroupSummary[]; filters: GroupDirectoryFilters }> {
    const rows = await this.store.directory(term.trim(), DIRECTORY_LIMIT, filters);
    let favourite: GroupFavourite | null = null;
    const ref: GroupFavouriteRef | null =
      filters.team !== null
        ? { type: 'team', id: filters.team }
        : filters.competition !== null
          ? { type: 'competition', id: filters.competition }
          : null;
    if (ref !== null) {
      const name = await this.store.favouriteName(ref.type, ref.id);
      if (name !== null) favourite = { ...ref, name };
    }
    return { groups: rows.map(summary), filters: { language: filters.language, favourite } };
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
    const rules = await this.store.latestRules(row.id);
    const mine = inside ? await this.store.memberRules(row.id, viewerId) : null;
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
      closed:
        row.closed_at === null || row.closed_reason === null
          ? null
          : { at: row.closed_at.toISOString(), reason: row.closed_reason },
      invite_policy: row.invite_policy as GroupInvitePolicy,
      // Nobody invites into a closed group (T-1025).
      may_invite: row.closed_at === null && mayInvite(row.invite_policy, role),
      rules: rules === null ? null : rulesView(rules),
      rules_accepted_version: mine?.rules_version ?? null,
      // Shown once: until the member says they have read the newest version.
      rules_changed:
        mine !== null && rules !== null && (mine.rules_seen_version ?? 0) < rules.version,
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
    const about = checkAbout(request);
    if (fields !== null || !about.ok) {
      return {
        ok: false,
        reason: 'invalid',
        fields: { ...(fields ?? {}), ...(about.ok ? {} : about.fields) },
      };
    }

    try {
      const row = await this.store.create(
        request.slug.toLowerCase(),
        request.name.trim(),
        request.description?.trim() ?? null,
        request.visibility,
        viewerId,
        {
          language: about.language ?? null,
          team: about.favourite?.team ?? null,
          competition: about.favourite?.competition ?? null,
        },
      );
      return { ok: true, value: summary(row) };
    } catch (error) {
      if (code(error) === UNIQUE) {
        return { ok: false, reason: 'conflict', fields: { slug: 'That handle is taken.' } };
      }
      if (code(error) === FOREIGN_KEY) {
        return {
          ok: false,
          reason: 'invalid',
          fields: { favourite: 'No such club or competition.' },
        };
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
    if (found.value.group.closed_at !== null) return { ok: false, reason: 'closed' };

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
    const about = checkAbout(patch);
    if (!about.ok) return { ok: false, reason: 'invalid', fields: about.fields };

    try {
      await this.store.update(found.value.group.id, {
        name: patch.name?.trim(),
        description:
          patch.description === undefined ? undefined : (patch.description?.trim() ?? null),
        visibility: patch.visibility,
        language: about.language,
        favourite: about.favourite,
      });
      return { ok: true, value: true };
    } catch (error) {
      if (code(error) === FOREIGN_KEY) {
        return {
          ok: false,
          reason: 'invalid',
          fields: { favourite: 'No such club or competition.' },
        };
      }
      return this.refusal(error);
    }
  }

  /**
   * Only the owner. A moderator runs a group; they do not end one. A closed
   * group is not deleted by its owner (T-1025): the closure and its appeal
   * stand on it.
   */
  async remove(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const found = await this.owner(viewerId, slug);
    if (!found.ok) return found;
    if (found.value.group.closed_at !== null) return { ok: false, reason: 'closed' };
    await this.store.remove(found.value.group.id);
    return { ok: true, value: true };
  }

  // -------------------------------------------------------------------------
  // Getting in and out
  // -------------------------------------------------------------------------

  /** Joining a public group. Every other visibility has its own door. */
  async join(
    viewerId: string,
    slug: string,
    rulesVersion?: number | null,
  ): Promise<GroupOutcome<true>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };
    if (row.visibility !== 'public') {
      // The invite-only case stays `not_found`: a stranger must not learn it is
      // there by being told they cannot join it.
      return row.visibility === 'discoverable'
        ? { ok: false, reason: 'wrong_door' }
        : { ok: false, reason: 'not_found' };
    }
    const rules = await this.accepted(row.id, rulesVersion);
    if (!rules.ok) return rules;
    try {
      await this.store.addMember(row.id, viewerId, 'member', rules.value);
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
    if (found.value.group.closed_at !== null) return { ok: false, reason: 'closed' };

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
    // Inside the group, then the policy -- which is the schema's to apply
    // (T-1020): a member the policy does not cover is refused by
    // `group_invite_a_policy_guard` and told which policy it is.
    const found = await this.inside(viewerId, slug);
    if (!found.ok) return found;
    if (!viewer.emailVerified) return { ok: false, reason: 'forbidden' };

    const invitee = await this.store.memberIdByUsername(username);
    if (invitee === null) return { ok: false, reason: 'not_found' };
    if (invitee === viewerId) return { ok: false, reason: 'invalid' };

    try {
      await this.store.invite(found.value.group.id, invitee, viewerId);
      // One standing invitation is one notification, whoever sends it and
      // however many times. The key is the group, because a withdrawn and
      // re-sent invitation is the same group asking the same person.
      await this.notifications.emit({
        userId: invitee,
        kind: 'group_invite',
        subjectType: 'group',
        subjectId: found.value.group.id,
        sourceId: viewerId,
        dedupeKey: `group_invite:${found.value.group.id}`,
      });
      return { ok: true, value: true };
    } catch (error) {
      if (code(error) === UNIQUE) return { ok: false, reason: 'conflict' };
      if (code(error) === NOT_PERMITTED) {
        return {
          ok: false,
          reason: 'policy',
          message: policySentence(found.value.group.invite_policy),
        };
      }
      return this.refusal(error);
    }
  }

  /**
   * The owner and the moderators withdraw any invitation; anybody else in the
   * group only one they sent themselves (T-1020).
   */
  async withdrawInvite(
    viewerId: string,
    slug: string,
    username: string,
  ): Promise<GroupOutcome<true>> {
    const found = await this.inside(viewerId, slug);
    if (!found.ok) return found;
    const invitee = await this.store.memberIdByUsername(username);
    if (invitee === null) return { ok: false, reason: 'not_found' };
    const decides = found.value.role === 'owner' || found.value.role === 'moderator';
    const gone = await this.store.withdrawInvite(
      found.value.group.id,
      invitee,
      decides ? undefined : viewerId,
    );
    return gone ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
  }

  // -------------------------------------------------------------------------
  // Who may invite, and the group's history (T-1020, D-132)
  // -------------------------------------------------------------------------

  /** The owner only: a moderator runs a group; the owner decides who opens its door. */
  async setInvitePolicy(
    viewerId: string,
    slug: string,
    policy: GroupInvitePolicy,
  ): Promise<GroupOutcome<true>> {
    if (!GROUP_INVITE_POLICIES.includes(policy)) {
      return { ok: false, reason: 'invalid', fields: { invite_policy: 'Not a policy.' } };
    }
    const found = await this.owner(viewerId, slug);
    if (!found.ok) return found;
    if (found.value.group.closed_at !== null) return { ok: false, reason: 'closed' };
    try {
      await this.store.setInvitePolicy(found.value.group.id, viewerId, policy);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  // -------------------------------------------------------------------------
  // Rules (T-1023, D-133)
  // -------------------------------------------------------------------------

  /**
   * The owner writes the next version; nothing is edited in place. A group
   * moderator runs the group, but the rules a member accepts are the owner's.
   */
  async setRules(
    viewerId: string,
    slug: string,
    body: string | undefined,
  ): Promise<GroupOutcome<{ version: number }>> {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text.length < 1 || text.length > MAX_GROUP_RULES) {
      return {
        ok: false,
        reason: 'invalid',
        fields: { body: `Between 1 and ${MAX_GROUP_RULES} characters.` },
      };
    }
    const found = await this.owner(viewerId, slug);
    if (!found.ok) return found;
    const version = await this.store.writeRules(found.value.group.id, viewerId, text);
    return { ok: true, value: { version } };
  }

  /** A member has read the current rules: they are not shown as new again. */
  async rulesSeen(viewerId: string, slug: string): Promise<GroupOutcome<true>> {
    const found = await this.inside(viewerId, slug);
    if (!found.ok) return found;
    const done = await this.store.markRulesSeen(found.value.group.id, viewerId);
    return done ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
  }

  /** Every audited change to the group, for the people who run it. */
  async history(viewerId: string, slug: string): Promise<GroupOutcome<GroupHistoryEntry[]>> {
    const found = await this.decider(viewerId, slug);
    if (!found.ok) return found;
    const rows = await this.store.history(found.value.group.id, HISTORY_LIMIT);
    return {
      ok: true,
      value: rows.map((row) => ({
        action: row.action,
        actor: row.actor,
        reason: row.reason,
        previous: row.previous,
        next: row.next,
        created_at: row.created_at.toISOString(),
      })),
    };
  }

  async acceptInvite(
    viewerId: string,
    slug: string,
    rulesVersion?: number | null,
  ): Promise<GroupOutcome<true>> {
    const row = await this.store.bySlug(slug.toLowerCase());
    // An invitation is the only thing that makes an invite-only group visible
    // to somebody outside it, so a missing one is `not_found` either way.
    if (row === null || !(await this.store.hasInvite(row.id, viewerId))) {
      return { ok: false, reason: 'not_found' };
    }
    const rules = await this.accepted(row.id, rulesVersion);
    if (!rules.ok) return rules;
    try {
      await this.store.acceptInvite(row.id, viewerId, rules.value);
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
    rulesVersion?: number | null,
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
    const rules = await this.accepted(row.id, rulesVersion);
    if (!rules.ok) return rules;
    try {
      await this.store.requestJoin(row.id, viewerId, note?.trim() ?? null, rules.value);
      // Everybody who can answer it, and nobody who cannot. Sending it to every
      // member would be a group of two hundred told about a queue two of them
      // can act on -- which is how a member turns notifications off entirely.
      await this.notifications.emitMany(
        (await this.store.deciderIds(row.id))
          .filter((decider) => decider !== viewerId)
          .map((decider) => ({
            userId: decider,
            kind: 'group_join_request' as const,
            subjectType: 'group' as const,
            subjectId: row.id,
            sourceId: viewerId,
            dedupeKey: `group_join_request:${row.id}:${viewerId}`,
          })),
      );
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

  /** What the joiner accepted, checked against the group's current rules. */
  private async accepted(
    groupId: string,
    sent: number | null | undefined,
  ): Promise<GroupOutcome<number | null>> {
    const latest = await this.store.latestRules(groupId);
    const checked = rulesCheck(latest?.version ?? null, sent);
    return checked.ok
      ? { ok: true, value: checked.version }
      : { ok: false, reason: 'rules', message: checked.message };
  }

  /** The group plus the viewer's role, when they are in it at all. */
  private async inside(
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
      case GROUP_CLOSED:
        return { ok: false, reason: 'closed' };
      case NOT_PERMITTED:
        // The schema's own copy of the rules gate (T-1023): somebody let in
        // who had not accepted them -- a request filed before the group had
        // rules is the one way to get here.
        if ((error as { hint?: string }).hint === 'rules') {
          return {
            ok: false,
            reason: 'rules',
            message:
              'This group has rules, and they have not been accepted. Ask again after reading them.',
          };
        }
        throw error;
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
