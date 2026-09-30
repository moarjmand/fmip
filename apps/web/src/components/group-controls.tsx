import type { GroupStanding } from '@fmip/contracts';
import { MAX_GROUP_RULES } from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';
import type { ActionState } from '@/lib/auth-actions';
import {
  acceptGroupInviteAction,
  appealGroupClosureAction,
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
import { CommunityAction } from '@/components/community-action';
import { Translated } from '@/components/translated';
import { TextArea } from '@/components/ui';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/*
 * Server components since T-1308: the words are chosen from the catalogue here
 * and handed to the client form (`CommunityAction`) already resolved, so the
 * catalogues stay on the server (T-1040). Each control is still its own form
 * over a server action, the same shape as `friend-controls.tsx`, for the same
 * reason: each works without JavaScript, and a failure is shown beside the
 * thing that failed.
 */

function working(locale: string) {
  return <Translated locale={locale} message="groupsPage.control.working" />;
}

function done(locale: string) {
  return <Translated locale={locale} message="groupsPage.control.done" />;
}

/**
 * The rules a member accepts to get in (T-1023): a box they tick, and the
 * version they were shown, so what they accept is the text on the screen.
 * Nothing at all when the group has no rules.
 */
function AcceptRules({ locale, version }: { locale: string; version: number | null | undefined }) {
  if (version === null || version === undefined) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="hidden" name="rules_version" value={version} />
      <input type="checkbox" name="accept_rules" required data-testid="group-accept-rules" />
      <Translated locale={locale} message="groupsPage.control.acceptRules" />
    </label>
  );
}

function ActionButton({
  locale,
  action,
  label,
  testId,
  quiet,
  rulesVersion,
}: {
  locale: string;
  action: BoundAction;
  label: MessageKey;
  testId: string;
  quiet?: boolean;
  rulesVersion?: number | null;
}) {
  return (
    <CommunityAction
      action={action}
      submit={<Translated locale={locale} message={label} />}
      working={working(locale)}
      done={done(locale)}
      variant={quiet ? 'secondary' : 'primary'}
      testId={testId}
    >
      <AcceptRules locale={locale} version={rulesVersion} />
    </CommunityAction>
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
  return (
    <CommunityAction
      action={askToJoinGroupAction.bind(null, locale, slug)}
      submit={<Translated locale={locale} message="groupsPage.control.ask" />}
      working={working(locale)}
      done={done(locale)}
      variant="primary"
      formClassName="flex flex-col gap-2"
      formTestId="group-ask-form"
      testId="group-ask"
    >
      <TextArea
        label={<Translated locale={locale} message="groupsPage.control.askNote" />}
        id="group-note"
        name="note"
        rows={2}
        maxLength={300}
        data-testid="group-note"
      />
      <AcceptRules locale={locale} version={rulesVersion} />
    </CommunityAction>
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
        <Translated locale={locale} message="groupsPage.control.owner" />
      </p>
    );
  }

  if (standing === 'moderator' || standing === 'member') {
    return (
      <ActionButton
        locale={locale}
        action={leaveGroupAction.bind(null, locale, slug)}
        label="groupsPage.control.leave"
        testId="group-leave"
        quiet
      />
    );
  }

  if (standing === 'invited') {
    return (
      <div className="flex flex-wrap gap-3" data-testid="group-invited">
        <ActionButton
          locale={locale}
          action={acceptGroupInviteAction.bind(null, locale, slug)}
          label="groupsPage.control.acceptInvite"
          testId="group-accept-invite"
          rulesVersion={rulesVersion}
        />
        <ActionButton
          locale={locale}
          action={declineGroupInviteAction.bind(null, locale, slug)}
          label="groupsPage.control.decline"
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
          <Translated locale={locale} message="groupsPage.control.requested" />
        </p>
        <ActionButton
          locale={locale}
          action={withdrawGroupRequestAction.bind(null, locale, slug)}
          label="groupsPage.control.withdraw"
          testId="group-withdraw"
          quiet
        />
      </div>
    );
  }

  if (standing === 'may_join') {
    return (
      <ActionButton
        locale={locale}
        action={joinGroupAction.bind(null, locale, slug)}
        label="groupsPage.control.join"
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
        <Translated locale={locale} message="groupsPage.control.inviteOnly" />
      </p>
    );
  }

  if (standing === 'unavailable') {
    // Deliberately not why. A member under a sanction hears about it from the
    // surface that owns that conversation, not from every group page.
    return (
      <p className="text-sm text-muted" data-testid="group-unavailable">
        <Translated locale={locale} message="groupsPage.control.unavailable" />
      </p>
    );
  }

  // A standing this component has not been taught. The guard makes that a
  // failing test; until somebody fixes it, a reader is told the truth rather
  // than shown whichever branch happened to be last.
  return (
    <p className="text-sm text-muted" data-testid="group-standing-unknown">
      <Translated locale={locale} message="groupsPage.control.unknown" />
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
      locale={locale}
      action={followInviteLinkAction.bind(null, locale, token)}
      label={follow === 'join' ? 'groupsPage.control.join' : 'groupsPage.control.ask'}
      testId="invite-link-follow"
      rulesVersion={rulesVersion}
    />
  );
}

/** "I have read them": the new rules are not shown as new again (T-1023). */
export function RulesSeen({ locale, slug }: { locale: string; slug: string }) {
  return (
    <ActionButton
      locale={locale}
      action={groupRulesSeenAction.bind(null, locale, slug)}
      label="groupsPage.control.rulesSeen"
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
  return (
    <CommunityAction
      action={setGroupRulesAction.bind(null, locale, slug)}
      submit={<Translated locale={locale} message="groupsPage.rules.publish" />}
      working={working(locale)}
      done={done(locale)}
      variant="secondary"
      formClassName="flex flex-col gap-2"
      formTestId="group-rules-form"
      testId="group-rules-publish"
      resultTestId="group-rules-result"
    >
      <TextArea
        label={
          <Translated
            locale={locale}
            message={current === null ? 'groupsPage.rules.write' : 'groupsPage.rules.writeNew'}
          />
        }
        id="group-rules-body"
        name="body"
        rows={6}
        maxLength={MAX_GROUP_RULES}
        defaultValue={current ?? ''}
        required
        data-testid="group-rules-body"
      />
      <p className="text-sm text-muted">
        <Translated locale={locale} message="groupsPage.rules.hint" />
      </p>
    </CommunityAction>
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
        locale={locale}
        action={answerJoinRequestAction.bind(null, locale, slug, username, true)}
        label="groupsPage.control.letIn"
        testId={`group-request-accept-${username}`}
      />
      <ActionButton
        locale={locale}
        action={answerJoinRequestAction.bind(null, locale, slug, username, false)}
        label="groupsPage.control.refuse"
        testId={`group-request-refuse-${username}`}
        quiet
      />
    </div>
  );
}

/**
 * The owner's appeal of a closure (T-1025; T-211's notes, on the decision
 * that closed it). Here rather than beside the administrators' forms since
 * T-1308, so its words come from the catalogue on the server.
 */
export function GroupAppealForm({ locale, slug }: { locale: string; slug: string }) {
  return (
    <CommunityAction
      action={appealGroupClosureAction.bind(null, locale, slug)}
      submit={<Translated locale={locale} message="groupsPage.appeal.send" />}
      done={<Translated locale={locale} message="groupsPage.appeal.sent" />}
      variant="secondary"
      formClassName="flex flex-col gap-2"
      formTestId="group-appeal-form"
      testId="group-appeal-submit"
      resultTestId="group-appeal-result"
    >
      <TextArea
        label={<Translated locale={locale} message="groupsPage.appeal.body" />}
        id="group-appeal-body"
        name="body"
        rows={4}
        maxLength={4000}
        required
      />
    </CommunityAction>
  );
}
