import {
  GROUP_INVITE_POLICIES,
  type GroupFavouriteRef,
  type GroupFavouriteType,
  type GroupHistoryEntry,
  type GroupInvitePolicy,
  type InviteLinkState,
  INVITE_LINK_DEFAULT_HOURS,
  INVITE_LINK_DEFAULT_USES,
  INVITE_LINK_MAX_HOURS,
  INVITE_LINK_MIN_HOURS,
  type UpdateGroupRequest,
} from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

/**
 * What the owner's settings on a group's page read from their forms, and how
 * the group's history is put into words (T-1026, over T-1020..T-1023).
 *
 * Pure, so the rules are tested without a server: nothing here decides what
 * is allowed -- the API does, over the schema -- it only turns form fields
 * into the request the API expects, and never invents a value the form did
 * not carry.
 */

/** How long a new invite link lasts, as the form offers it: an hour, a day, a week, thirty days. */
export const LINK_DURATION_HOURS = [
  INVITE_LINK_MIN_HOURS,
  24,
  INVITE_LINK_DEFAULT_HOURS,
  INVITE_LINK_MAX_HOURS,
] as const;

/** The option value of a favourite in the form's select: `team:<uuid>` or `competition:<uuid>`. */
export function favouriteValue(ref: GroupFavouriteRef | null): string {
  return ref === null ? '' : `${ref.type}:${ref.id}`;
}

/**
 * The favourite the form chose (rule 1: by id, never by name). `''` clears
 * it. Anything else is split and sent as it came -- a value that is not a
 * known type and an id is the API's to refuse, not this function's to repair.
 */
export function parseFavourite(value: string): GroupFavouriteRef | null {
  if (value === '') return null;
  const at = value.indexOf(':');
  return {
    type: (at < 0 ? '' : value.slice(0, at)) as GroupFavouriteType,
    id: value.slice(at + 1),
  };
}

/**
 * The patch the language-and-favourite form sends. The favourite is sent only
 * when the form carried its select: when the list of clubs could not be
 * fetched the select is not rendered, and the group's favourite must then stay
 * as it is rather than be cleared by a field that was never shown.
 */
export function aboutPatch(form: {
  get(name: string): FormDataEntryValue | null;
  has(name: string): boolean;
}): UpdateGroupRequest {
  const language = String(form.get('language') ?? '').trim();
  const patch: UpdateGroupRequest = { language: language === '' ? null : language };
  if (form.has('favourite')) patch.favourite = parseFavourite(String(form.get('favourite')));
  return patch;
}

/** The policy the form chose, or `undefined` for the API to refuse as "not a policy". */
export function parsePolicy(value: FormDataEntryValue | null): GroupInvitePolicy | undefined {
  const policy = String(value ?? '');
  return (GROUP_INVITE_POLICIES as readonly string[]).includes(policy)
    ? (policy as GroupInvitePolicy)
    : undefined;
}

/** A new link's expiry and use cap; the API's defaults when a field is missing or not a number. */
export function linkRequest(form: { get(name: string): FormDataEntryValue | null }): {
  expires_in_hours: number;
  max_uses: number;
} {
  const hours = Number(form.get('expires_in_hours'));
  const uses = Number(form.get('max_uses'));
  return {
    expires_in_hours: Number.isInteger(hours) && hours > 0 ? hours : INVITE_LINK_DEFAULT_HOURS,
    max_uses: Number.isInteger(uses) && uses > 0 ? uses : INVITE_LINK_DEFAULT_USES,
  };
}

/** Where a link is followed: the page that previews it and joins or asks. */
export function inviteLinkUrl(origin: string, locale: string, token: string): string {
  return `${origin}/${locale}/group-invite/${encodeURIComponent(token)}`;
}

/** The catalogue key naming one history entry; an action this does not know is "a change". */
export function historyActionKey(action: string): MessageKey {
  switch (action) {
    case 'user_group.invite_policy':
      return 'groupSettings.history.action.invitePolicy';
    case 'user_group.rules':
      return 'groupSettings.history.action.rules';
    default:
      return 'groupSettings.history.action.other';
  }
}

/** The label of each invite policy, for the form and for the history's before and after. */
const POLICY_KEYS: Record<GroupInvitePolicy, MessageKey> = {
  owner: 'groupSettings.policy.owner',
  owner_and_moderators: 'groupSettings.policy.owner_and_moderators',
  members: 'groupSettings.policy.members',
};

export function policyKey(policy: GroupInvitePolicy): MessageKey {
  return POLICY_KEYS[policy];
}

/** Where a link stands, in words: `orphaned` says why it stopped working. */
const LINK_STATE_KEYS: Record<InviteLinkState, MessageKey> = {
  live: 'groupSettings.links.state.live',
  revoked: 'groupSettings.links.state.revoked',
  expired: 'groupSettings.links.state.expired',
  exhausted: 'groupSettings.links.state.exhausted',
  orphaned: 'groupSettings.links.state.orphaned',
};

export function linkStateKey(state: InviteLinkState): MessageKey {
  return LINK_STATE_KEYS[state];
}

/**
 * One side of a history entry (before or after) as `field: value` pairs. A
 * policy is shown by its label key; every other value as the audit log holds
 * it, because the log is the record and this only reads it. `null` values
 * say "none" rather than disappear, so a cleared field is visible as cleared.
 */
export function historyValues(
  side: GroupHistoryEntry['previous'],
): { field: string; value: string; policy: GroupInvitePolicy | null }[] {
  if (side === null) return [];
  return Object.entries(side).map(([field, raw]) => {
    const policy = field === 'invite_policy' ? (parsePolicy(String(raw)) ?? null) : null;
    const value =
      raw === null || raw === undefined
        ? '—'
        : typeof raw === 'object'
          ? JSON.stringify(raw)
          : String(raw);
    return { field, value, policy };
  });
}
