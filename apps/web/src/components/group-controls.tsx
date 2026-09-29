'use client';

import { useActionState } from 'react';
import type { GroupStanding } from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import {
  acceptGroupInviteAction,
  answerJoinRequestAction,
  askToJoinGroupAction,
  declineGroupInviteAction,
  followInviteLinkAction,
  groupRulesSeenAction,
  setGroupRulesAction,
  joinGroupAction,
  leaveGroupAction,
  withdrawGroupRequestAction,
} from '@/lib/group-actions';
import { Button, FormStatus, TextArea } from '@/components/ui';
import { MAX_GROUP_RULES } from '@fmip/contracts';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One button, its own form, and whatever the API said about it — the same shape
 * as `friend-controls.tsx`, for the same reason: each control works on its own
 * without JavaScript, and a failure is shown beside the thing that failed.
 */
/**
 * The rules a member accepts to get in (T-1023): a box they tick, and the
 * version they were shown, so what they accept is the text on the screen.
 * Nothing at all when the group has no rules.
 */
function AcceptRules({ version }: { version: number | null | undefined }) {
  if (version === null || version === undefined) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="hidden" name="rules_version" value={version} />
      <input type="checkbox" name="accept_rules" required data-testid="group-accept-rules" />I have
      read this group&rsquo;s rules and I accept them.
    </label>
  );
}

function ActionButton({
  action,
  label,
  testId,
  quiet,
  rulesVersion,
}: {
  action: BoundAction;
  label: string;
  testId: string;
  quiet?: boolean;
  rulesVersion?: number | null;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <AcceptRules version={rulesVersion} />
      <Button
        type="submit"
        variant={quiet ? 'secondary' : 'primary'}
        pending={pending}
        pendingLabel="Working…"
        data-testid={testId}
        className="self-start"
      >
        {label}
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid={`${testId}-result`}>
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </FormStatus>
      )}
    </form>
  );
}

/** Asking to join, with a sentence for whoever decides. */
function AskToJoin({
  locale,
  slug,
  rulesVersion,
}: {
  locale: string;
  slug: string;
  rulesVersion: number | null;
}) {
  const [state, formAction, pending] = useActionState(
    askToJoinGroupAction.bind(null, locale, slug),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid="group-ask-form">
      <TextArea
        label="Say something to whoever decides (optional)"
        id="group-note"
        name="note"
        rows={2}
        maxLength={300}
        data-testid="group-note"
      />
      <AcceptRules version={rulesVersion} />
      <Button
        type="submit"
        variant="primary"
        pending={pending}
        pendingLabel="Working…"
        data-testid="group-ask"
        className="self-start"
      >
        Ask to join
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid="group-ask-result">
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </FormStatus>
      )}
    </form>
  );
}

/**
 * What the viewer can do about a group (blueprint 8.2, T-242).
 *
 * **The controls follow `GroupStanding` exactly**, and every state is a branch
 * rather than a fall-through, so a state that arrives with nothing to offer is
 * a failing test rather than a page that quietly shows nothing.
 *
 * Three of them are the acceptance criterion in the interface:
 *
 * - `may_join` — a public group, so there is a button
 * - `may_ask` — a discoverable one: found, not joinable, and the only control is
 *   a request that somebody has to answer
 * - `invite_only` — reachable only by holding an invitation, and there is
 *   **nothing to press**, because inventing a button that would always fail is
 *   worse than saying so
 *
 * `unavailable` deliberately does not say why. A member under a sanction hears
 * about it from the surface that owns that conversation, not from every group
 * page they open.
 */
export function GroupControls({
  locale,
  slug,
  standing,
  rulesVersion = null,
}: {
  locale: string;
  slug: string;
  standing: GroupStanding;
  /** The group's current rules version, which every way in asks to accept (T-1023). */
  rulesVersion?: number | null;
}) {
  if (standing === 'owner') {
    return (
      <p className="text-sm text-muted" data-testid="group-owner-note">
        You own this group. Hand it to somebody else before you can leave it.
      </p>
    );
  }

  if (standing === 'moderator' || standing === 'member') {
    return (
      <ActionButton
        action={leaveGroupAction.bind(null, locale, slug)}
        label="Leave group"
        testId="group-leave"
        quiet
      />
    );
  }

  if (standing === 'invited') {
    return (
      <div className="flex flex-wrap gap-3" data-testid="group-invited">
        <ActionButton
          action={acceptGroupInviteAction.bind(null, locale, slug)}
          label="Accept invitation"
          testId="group-accept-invite"
          rulesVersion={rulesVersion}
        />
        <ActionButton
          action={declineGroupInviteAction.bind(null, locale, slug)}
          label="Decline"
          testId="group-decline-invite"
          quiet
        />
      </div>
    );
  }

  if (standing === 'requested') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted" data-testid="group-requested">
          You have asked to join. Somebody who runs the group will answer.
        </p>
        <ActionButton
          action={withdrawGroupRequestAction.bind(null, locale, slug)}
          label="Take it back"
          testId="group-withdraw"
          quiet
        />
      </div>
    );
  }

  if (standing === 'may_join') {
    return (
      <ActionButton
        action={joinGroupAction.bind(null, locale, slug)}
        label="Join group"
        testId="group-join"
        rulesVersion={rulesVersion}
      />
    );
  }

  if (standing === 'may_ask') {
    return <AskToJoin locale={locale} slug={slug} rulesVersion={rulesVersion} />;
  }

  if (standing === 'invite_only') {
    // No button. This group is joined by invitation, and a control that would
    // always be refused is a worse answer than the sentence.
    return (
      <p className="text-sm text-muted" data-testid="group-invite-only">
        This group is joined by invitation.
      </p>
    );
  }

  if (standing === 'unavailable') {
    // Deliberately not why. A member under a sanction hears about it from the
    // surface that owns that conversation, not from every group page.
    return (
      <p className="text-sm text-muted" data-testid="group-unavailable">
        You cannot join this group at the moment.
      </p>
    );
  }

  // A standing this component has not been taught. The guard makes that a
  // failing test; until somebody fixes it, a reader is told the truth rather
  // than shown whichever branch happened to be last.
  return (
    <p className="text-sm text-muted" data-testid="group-standing-unknown">
      There is nothing to do here yet.
    </p>
  );
}

/**
 * Following an invite link (T-1021): one button, whose words say what it will
 * do -- join, or ask -- because the group's visibility decides and the page
 * already knows which.
 */
export function FollowInviteLink({
  locale,
  token,
  follow,
  rulesVersion = null,
}: {
  locale: string;
  token: string;
  follow: 'join' | 'ask';
  rulesVersion?: number | null;
}) {
  return (
    <ActionButton
      action={followInviteLinkAction.bind(null, locale, token)}
      label={follow === 'join' ? 'Join group' : 'Ask to join'}
      testId="invite-link-follow"
      rulesVersion={rulesVersion}
    />
  );
}

/** "I have read them": the new rules are not shown as new again (T-1023). */
export function RulesSeen({ locale, slug }: { locale: string; slug: string }) {
  return (
    <ActionButton
      action={groupRulesSeenAction.bind(null, locale, slug)}
      label="I have read them"
      testId="group-rules-seen"
      quiet
    />
  );
}

/**
 * The owner's rules form (T-1023): publishing writes the next version, and
 * the text of every earlier one stays as it was, because a member accepted
 * exactly those words.
 */
export function GroupRulesForm({
  locale,
  slug,
  current,
}: {
  locale: string;
  slug: string;
  current: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    setGroupRulesAction.bind(null, locale, slug),
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid="group-rules-form">
      <TextArea
        label={current === null ? 'Write the group’s rules' : 'Write a new version of the rules'}
        id="group-rules-body"
        name="body"
        rows={6}
        maxLength={MAX_GROUP_RULES}
        defaultValue={current ?? ''}
        required
        data-testid="group-rules-body"
      />
      <p className="text-sm text-muted">
        Publishing makes a new version. Joining will ask for it to be accepted; members already in
        are shown it once and stay members either way.
      </p>
      <Button
        type="submit"
        variant="secondary"
        pending={pending}
        pendingLabel="Working…"
        data-testid="group-rules-publish"
        className="self-start"
      >
        Publish
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid="group-rules-result">
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </FormStatus>
      )}
    </form>
  );
}

/** The queue, for whoever runs the group. */
export function JoinRequestControls({
  locale,
  slug,
  username,
}: {
  locale: string;
  slug: string;
  username: string;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <ActionButton
        action={answerJoinRequestAction.bind(null, locale, slug, username, true)}
        label="Let them in"
        testId={`group-request-accept-${username}`}
      />
      <ActionButton
        action={answerJoinRequestAction.bind(null, locale, slug, username, false)}
        label="No"
        testId={`group-request-refuse-${username}`}
        quiet
      />
    </div>
  );
}
