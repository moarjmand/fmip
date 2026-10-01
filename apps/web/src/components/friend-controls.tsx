import type { FriendStatus } from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import {
  acceptFriendRequestAction,
  blockAction,
  sendFriendRequestAction,
  unblockAction,
  unfriendAction,
  withdrawFriendRequestAction,
} from '@/lib/friend-actions';
import type { MessageKey } from '@/i18n/messages';
import { CommunityAction } from '@/components/community-action';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One button, its own form, and whatever the API said about it.
 *
 * A form each rather than one form with several submit buttons, so that each
 * control works on its own without JavaScript and so a failure is shown beside
 * the thing that failed. A server component (T-1308): the words are chosen from
 * the catalogue here and handed to the client form already resolved.
 */
function ActionButton({
  locale,
  action,
  label,
  testId,
  quiet,
}: {
  locale: string;
  action: BoundAction;
  label: MessageKey;
  testId: string;
  quiet?: boolean;
}) {
  return (
    <CommunityAction
      action={action}
      submit={<Translated locale={locale} message={label} />}
      working={<Translated locale={locale} message="friendsPage.control.working" />}
      done={<Translated locale={locale} message="friendsPage.control.done" />}
      variant={quiet ? 'secondary' : 'primary'}
      testId={testId}
    />
  );
}

/**
 * What the viewer can do about another member (blueprint 8.1, T-202).
 *
 * The controls follow `FriendStatus` exactly, and two of the states are worth
 * reading closely.
 *
 * **`blocked` is the viewer's own block**, so it is named plainly: it is their
 * action and theirs to undo.
 *
 * **`unavailable` means the viewer cannot reach this member and does not say
 * why.** Today the only thing that produces it is the other member having
 * blocked them, so somebody determined can infer it — and the alternative was
 * worse. The choices were: show "Add friend" and let it fail (the same
 * inference, one click later, after leading the member into a dead end); accept
 * the request and never deliver it (telling the sender something untrue about
 * their own action, which is the failure rule 3 exists for); or say plainly
 * that a request cannot be sent and not say why. The third is the one that does
 * not lie to anybody, and it is what the API's own wording does.
 *
 * The block control stays available in every state, including `unavailable`. A
 * member's exit is never taken away because of something the other member did.
 */
export function FriendControls({
  locale,
  username,
  status,
}: {
  locale: string;
  username: string;
  /** `null` for a guest: nobody has a standing with anybody until they sign in. */
  status: FriendStatus | null;
}) {
  if (status === null || status === 'self') return null;

  const bind = (
    action: (
      locale: string,
      username: string,
      state: ActionState,
      formData: FormData,
    ) => Promise<ActionState>,
  ): BoundAction => action.bind(null, locale, username);

  const block = (
    <ActionButton
      locale={locale}
      action={bind(blockAction)}
      label="friendsPage.control.block"
      testId="friend-block"
      quiet
    />
  );

  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="friend-controls">
      {status === 'none' && (
        <>
          <ActionButton
            locale={locale}
            action={bind(sendFriendRequestAction)}
            label="friendsPage.control.add"
            testId="friend-add"
          />
          {block}
        </>
      )}

      {status === 'request_sent' && (
        <>
          <p className="text-sm text-muted" data-testid="friend-state">
            <Translated locale={locale} message="friendsPage.control.sent" />
          </p>
          <ActionButton
            locale={locale}
            action={bind(withdrawFriendRequestAction)}
            label="friendsPage.control.cancel"
            testId="friend-cancel"
            quiet
          />
          {block}
        </>
      )}

      {status === 'request_received' && (
        <>
          <p className="text-sm text-muted" data-testid="friend-state">
            <Said locale={locale} message="friendsPage.control.received" params={{ username }} />
          </p>
          <ActionButton
            locale={locale}
            action={bind(acceptFriendRequestAction)}
            label="friendsPage.control.accept"
            testId="friend-accept"
          />
          <ActionButton
            locale={locale}
            action={bind(withdrawFriendRequestAction)}
            label="friendsPage.control.decline"
            testId="friend-decline"
            quiet
          />
          {block}
        </>
      )}

      {status === 'friends' && (
        <>
          <p className="text-sm text-muted" data-testid="friend-state">
            <Translated locale={locale} message="friendsPage.control.friends" />
          </p>
          <ActionButton
            locale={locale}
            action={bind(unfriendAction)}
            label="friendsPage.control.remove"
            testId="friend-remove"
            quiet
          />
          {block}
        </>
      )}

      {status === 'blocked' && (
        <>
          <p className="text-sm text-muted" data-testid="friend-state">
            <Said locale={locale} message="friendsPage.control.youBlocked" params={{ username }} />
          </p>
          <ActionButton
            locale={locale}
            action={bind(unblockAction)}
            label="friendsPage.control.unblock"
            testId="friend-unblock"
            quiet
          />
        </>
      )}

      {status === 'unavailable' && (
        <>
          <p className="text-sm text-muted" data-testid="friend-state">
            <Said locale={locale} message="friendsPage.control.unavailable" params={{ username }} />
          </p>
          {block}
        </>
      )}
    </div>
  );
}
