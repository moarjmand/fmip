'use client';

import { type ReactNode, useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import { Button, FormStatus } from '@/components/ui';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One poll form (T-643): whatever fields the server rendered as children, a
 * submit button, and the API's answer beside it. The same shape as the group
 * controls, so it works without JavaScript; the words arrive already chosen
 * from the catalogue by the server component that renders it.
 */
export function GroupPollForm({
  action,
  submit,
  working,
  testId,
  quiet,
  children,
}: {
  action: BoundAction;
  submit: ReactNode;
  working: ReactNode;
  testId: string;
  quiet?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid={testId}>
      {children}
      <Button
        type="submit"
        variant={quiet === true ? 'secondary' : 'primary'}
        pending={pending}
        pendingLabel={working}
        data-testid={`${testId}-submit`}
        className="self-start"
      >
        {submit}
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid={`${testId}-result`}>
          {state.ok ? (state.message ?? '') : state.message}
        </FormStatus>
      )}
    </form>
  );
}
