import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  type CreateGroupInviteLinkRequest,
  type CreatedGroupInviteLink,
  type FollowInviteLinkResponse,
  type GroupInviteLink,
  type GroupRules,
  type GroupSummary,
  INVITE_LINK_DEFAULT_HOURS,
  INVITE_LINK_DEFAULT_USES,
  INVITE_LINK_MAX_HOURS,
  INVITE_LINK_MAX_USES,
  INVITE_LINK_MIN_HOURS,
  type InviteLinkPreview,
  type InviteLinkState,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { groupSummary } from './internal/group-summary';
import { type GroupRow, GroupsStore } from './internal/groups-store';
import { InviteLinksStore, type LinkRow } from './internal/invite-links-store';
import { policySentence, rulesCheck } from './groups.service';

/**
 * Why a link verb was refused. `gone` is a dead link that is allowed to say
 * which kind of dead it is (`message`); a dead link to an invite-only group is
 * `not_found` instead, because the group is not findable and a dead link no
 * longer invites anybody to it.
 */
export type LinkRefusal =
  | 'not_found'
  | 'forbidden'
  | 'invalid'
  | 'policy'
  | 'gone'
  | 'already_member'
  | 'restricted'
  | 'unavailable'
  | 'rate_limited'
  | 'rules';

export type LinkOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: LinkRefusal; fields?: Record<string, string>; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 32 random bytes as base64url: 43 characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const DEAD: Record<string, string> = {
  revoked: 'This invite link was revoked.',
  expired: 'This invite link has expired.',
  exhausted: 'This invite link has been used as many times as it allows.',
  orphaned: 'Whoever made this invite link can no longer invite people to this group.',
};

function code(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

/** The only form a token is kept in (D-132). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A whole number in range, the default when absent, or the field's complaint.
 * Pure, so the limits have a unit test of their own.
 */
export function checkLinkRequest(
  body: CreateGroupInviteLinkRequest | null | undefined,
): { ok: true; hours: number; uses: number } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const hours = body?.expires_in_hours ?? INVITE_LINK_DEFAULT_HOURS;
  const uses = body?.max_uses ?? INVITE_LINK_DEFAULT_USES;
  if (!Number.isInteger(hours) || hours < INVITE_LINK_MIN_HOURS || hours > INVITE_LINK_MAX_HOURS) {
    fields.expires_in_hours = `Whole hours from ${INVITE_LINK_MIN_HOURS} to ${INVITE_LINK_MAX_HOURS}.`;
  }
  if (!Number.isInteger(uses) || uses < 1 || uses > INVITE_LINK_MAX_USES) {
    fields.max_uses = `From 1 to ${INVITE_LINK_MAX_USES}.`;
  }
  return Object.keys(fields).length === 0 ? { ok: true, hours, uses } : { ok: false, fields };
}

function linkView(row: LinkRow): GroupInviteLink {
  return {
    id: row.id,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    max_uses: row.max_uses,
    uses: row.uses,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    state: row.state as InviteLinkState,
  };
}

/**
 * Invite links (blueprint 8.2, T-1021, D-132), inside the groups boundary
 * because a link is the group's door.
 *
 * Making one is inviting, so it answers what inviting answers: somebody inside
 * the group, a verified e-mail (T-201), and the group's invite policy -- which
 * is the schema's, like every membership rule. Following one is the database's
 * `group_invite_link_follow()`, so the checks, the membership and the use are
 * one statement under one lock.
 */
@Injectable()
export class GroupInviteLinksService {
  private readonly groups: GroupsStore;
  private readonly links: InviteLinksStore;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly notifications: NotificationsService,
  ) {
    this.groups = new GroupsStore(pool);
    this.links = new InviteLinksStore(pool);
  }

  async create(
    viewer: { id: string; emailVerified: boolean },
    slug: string,
    body: CreateGroupInviteLinkRequest | null | undefined,
  ): Promise<LinkOutcome<CreatedGroupInviteLink>> {
    const found = await this.inside(viewer.id, slug);
    if (!found.ok) return found;
    const checked = checkLinkRequest(body);
    if (!checked.ok) return { ok: false, reason: 'invalid', fields: checked.fields };
    if (!viewer.emailVerified) return { ok: false, reason: 'forbidden' };

    const token = newToken();
    try {
      const row = await this.links.create(
        found.value.group.id,
        viewer.id,
        hashToken(token),
        checked.hours,
        checked.uses,
      );
      return { ok: true, value: { ...linkView(row), token } };
    } catch (error) {
      if (code(error) === 'PL006') {
        return {
          ok: false,
          reason: 'policy',
          message: policySentence(found.value.group.invite_policy),
        };
      }
      return this.refusal(error);
    }
  }

  /** The owner and moderators see every link; anybody else in the group their own. */
  async list(viewerId: string, slug: string): Promise<LinkOutcome<GroupInviteLink[]>> {
    const found = await this.inside(viewerId, slug);
    if (!found.ok) return found;
    const rows = await this.links.list(
      found.value.group.id,
      this.decides(found.value.role) ? undefined : viewerId,
    );
    return { ok: true, value: rows.map(linkView) };
  }

  /** The owner and moderators revoke any link; its maker their own. */
  async revoke(viewerId: string, slug: string, linkId: string): Promise<LinkOutcome<true>> {
    const found = await this.inside(viewerId, slug);
    if (!found.ok) return found;
    if (!UUID.test(linkId)) return { ok: false, reason: 'not_found' };
    const done = await this.links.revoke(
      found.value.group.id,
      linkId,
      viewerId,
      this.decides(found.value.role) ? undefined : viewerId,
    );
    return done ? { ok: true, value: true } : { ok: false, reason: 'not_found' };
  }

  async preview(viewerId: string, token: string): Promise<LinkOutcome<InviteLinkPreview>> {
    if (!TOKEN.test(token)) return { ok: false, reason: 'not_found' };
    const row = await this.links.preview(hashToken(token), viewerId);
    if (row === null) return { ok: false, reason: 'not_found' };
    if (row.state !== 'live' && row.visibility === 'invite_only' && !row.member) {
      return { ok: false, reason: 'not_found' };
    }
    return {
      ok: true,
      value: {
        group: await this.groupById(row.group_id),
        state: row.state as InviteLinkState,
        follow: row.visibility === 'discoverable' ? 'ask' : 'join',
        member: row.member,
        rules: await this.rulesOf(row.group_id),
      },
    };
  }

  async follow(
    viewerId: string,
    token: string,
    rulesVersion?: number | null,
  ): Promise<LinkOutcome<FollowInviteLinkResponse>> {
    if (!TOKEN.test(token)) return { ok: false, reason: 'not_found' };
    // The rules are asked about only for a link that would let somebody in:
    // a dead one answers first, and an invite-only group behind it stays 404.
    const seen = await this.links.preview(hashToken(token), viewerId);
    let accepted: number | null = null;
    if (seen !== null && seen.state === 'live' && !seen.member) {
      const latest = await this.groups.latestRules(seen.group_id);
      const checked = rulesCheck(latest?.version ?? null, rulesVersion);
      if (!checked.ok) return { ok: false, reason: 'rules', message: checked.message };
      accepted = checked.version;
    }
    let row;
    try {
      row = await this.links.follow(hashToken(token), viewerId, accepted);
    } catch (error) {
      if (code(error) === '23505') return { ok: false, reason: 'already_member' };
      return this.refusal(error);
    }
    if (row === null) return { ok: false, reason: 'not_found' };

    const dead = DEAD[row.outcome];
    if (dead !== undefined) {
      return row.visibility === 'invite_only'
        ? { ok: false, reason: 'not_found' }
        : { ok: false, reason: 'gone', message: dead };
    }
    if (row.outcome === 'member') return { ok: false, reason: 'already_member' };

    const group = await this.groupById(row.group_id);
    if (row.outcome === 'requested') {
      // The same people a request through the directory reaches (T-271).
      await this.notifications.emitMany(
        (await this.groups.deciderIds(row.group_id))
          .filter((decider) => decider !== viewerId)
          .map((decider) => ({
            userId: decider,
            kind: 'group_join_request' as const,
            subjectType: 'group' as const,
            subjectId: row.group_id,
            sourceId: viewerId,
            dedupeKey: `group_join_request:${row.group_id}:${viewerId}`,
          })),
      );
      return { ok: true, value: { outcome: 'requested', group } };
    }
    return { ok: true, value: { outcome: 'joined', group } };
  }

  // -------------------------------------------------------------------------

  private async rulesOf(groupId: string): Promise<GroupRules | null> {
    const rules = await this.groups.latestRules(groupId);
    return rules === null
      ? null
      : {
          version: rules.version,
          body: rules.body,
          created_by: rules.created_by,
          created_at: rules.created_at.toISOString(),
        };
  }

  private decides(role: string): boolean {
    return role === 'owner' || role === 'moderator';
  }

  private async groupById(id: string): Promise<GroupSummary> {
    return groupSummary((await this.groups.byId(id)) as GroupRow);
  }

  private async inside(
    viewerId: string,
    slug: string,
  ): Promise<LinkOutcome<{ group: GroupRow; role: string }>> {
    const row = await this.groups.bySlug(slug.toLowerCase());
    if (row === null) return { ok: false, reason: 'not_found' };
    const role = await this.groups.role(row.id, viewerId);
    if (role === null) {
      return row.visibility === 'invite_only'
        ? { ok: false, reason: 'not_found' }
        : { ok: false, reason: 'forbidden' };
    }
    return { ok: true, value: { group: row, role } };
  }

  private refusal<T>(error: unknown): LinkOutcome<T> {
    switch (code(error)) {
      case 'PL003':
        return { ok: false, reason: 'unavailable' };
      case 'PL004':
        return { ok: false, reason: 'restricted' };
      case 'PL005':
        return { ok: false, reason: 'rate_limited' };
      case 'PL010':
        return { ok: false, reason: 'already_member' };
      case 'PL006':
        if ((error as { hint?: string }).hint === 'rules') {
          return { ok: false, reason: 'rules', message: "Accept this group's rules to join." };
        }
        throw error;
      default:
        throw error;
    }
  }
}
