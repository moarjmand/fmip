'use client';

import { type ReactNode, useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import { FormStatus } from '@/components/ui/notice';

/**
 * The only client code of the pick control (T-1738, D-359): a `<form>` bound
 * to the prediction's server action, and what the action answered. Every
 * control inside is the server's markup, handed in as `children`; the saved
 * state itself is not kept here -- the action revalidates the page and the
 * server draws the control again from the stored pick.
 *
 * While the action runs the form is `aria-busy`, and the caller's classes dim
 * it and stop a second tap; nothing is `disabled`, so the pressed button
 * keeps the keyboard's focus. Without JavaScript the form posts and the page
 * comes back with the same answer (React's own progressive enhancement).
 */
export function PickForm({
  action,
  className,
  testId,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      aria-busy={pending ? true : undefined}
      className={className}
      data-testid={testId}
    >
      {children}
      {/* A refusal is shown; a success is only announced, because the page
          the action revalidated already says "Saved" in the server's markup. */}
      {state !== null && state.message !== undefined && (
        <FormStatus
          ok={state.ok}
          className={state.ok ? 'sr-only' : undefined}
          data-testid="pick-state"
        >
          {state.message}
        </FormStatus>
      )}
      {/* The API's own word on each refused field (a score that disagrees
          with the outcome, a fourth reason), in the order it gave them. */}
      {state !== null &&
        !state.ok &&
        Object.entries(state.fields ?? {}).map(([name, text]) => (
          <FormStatus key={name} ok={false} data-field={name}>
            {text}
          </FormStatus>
        ))}
    </form>
  );
}
