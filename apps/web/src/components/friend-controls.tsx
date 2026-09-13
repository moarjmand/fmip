'use client';

import { useActionState } from 'react';
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

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One button, its own form, and whatever the API said about it.
 *
 * A form each rather than one form with several submit buttons, so that each
 * control works on its own without JavaScript and so a failure is shown beside
 * the thing that failed.
 */
function ActionButton({
  action,
  label,
  testId,
  quiet,
}: {
  action: BoundAction;
  label: string;
  testId: string;
  quiet?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={pending}
        data-testid={testId}
        className={
          quiet
            ? 'self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50'
            : 'self-start rounded bg-current px-3 py-1 text-sm font-medium text-white disabled:opacity-50 dark:text-black'
        }
      >
        {pending ? 'Working…' : label}
      </button>
      {state !== null && (
        <p
          role="status"
          className={`text-sm ${state.ok ? 'opacity-70' : 'text-red-800'}`}
          data-testid={`${testId}-result`}
        >
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </p>
      )}
    </form>
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
    <ActionButton action={bind(blockAction)} label="Block" testId="friend-block" quiet />
  );

  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="friend-controls">
      {status === 'none' && (
        <>
          <ActionButton
            action={bind(sendFriendRequestAction)}
            label="Add friend"
            testId="friend-add"
          />
          {block}
        </>
      )}

      {status === 'request_sent' && (
        <>
          <p className="text-sm opacity-70" data-testid="friend-state">
            Friend request sent.
          </p>
          <ActionButton
            action={bind(withdrawFriendRequestAction)}
            label="Cancel request"
            testId="friend-cancel"
            quiet
          />
          {block}
        </>
      )}

      {status === 'request_received' && (
        <>
          <p className="text-sm opacity-70" data-testid="friend-state">
            @{username} asked to be your friend.
          </p>
          <ActionButton
            action={bind(acceptFriendRequestAction)}
            label="Accept"
            testId="friend-accept"
          />
          <ActionButton
            action={bind(withdrawFriendRequestAction)}
            label="Decline"
            testId="friend-decline"
            quiet
          />
          {block}
        </>
      )}

      {status === 'friends' && (
        <>
          <p className="text-sm opacity-70" data-testid="friend-state">
            You are friends.
          </p>
          <ActionButton
            action={bind(unfriendAction)}
            label="Remove friend"
            testId="friend-remove"
            quiet
          />
          {block}
        </>
      )}

      {status === 'blocked' && (
        <>
          <p className="text-sm opacity-70" data-testid="friend-state">
            You blocked @{username}. They are not told.
          </p>
          <ActionButton
            action={bind(unblockAction)}
            label="Unblock"
            testId="friend-unblock"
            quiet
          />
        </>
      )}

      {status === 'unavailable' && (
        <>
          <p className="text-sm opacity-70" data-testid="friend-state">
            You cannot send @{username} a friend request.
          </p>
          {block}
        </>
      )}
    </div>
  );
}
