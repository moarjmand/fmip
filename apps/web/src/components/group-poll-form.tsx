'use client';

import { type ReactNode, useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';

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
      <button
        type="submit"
        disabled={pending}
        data-testid={`${testId}-submit`}
        className={
          quiet
            ? 'self-start rounded border border-strong px-3 py-1 text-sm disabled:opacity-50'
            : 'self-start rounded bg-accent px-3 py-1 text-sm font-medium text-on-accent disabled:opacity-50'
        }
      >
        {pending ? working : submit}
      </button>
      {state !== null && (
        <p
          role="status"
          className={`text-sm ${state.ok ? 'text-muted' : 'text-danger'}`}
          data-testid={`${testId}-result`}
        >
          {state.ok ? (state.message ?? '') : state.message}
        </p>
      )}
    </form>
  );
}
