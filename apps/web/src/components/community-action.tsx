'use client';

import { type ReactNode, useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import { Button, FormStatus } from '@/components/ui';

type BoundAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One control, its own form, and whatever the API said about it (T-1308).
 *
 * The client half of the community surfaces' controls -- friends, groups,
 * conversations. A form each rather than one form with several submit
 * buttons, so each control works on its own without JavaScript and a failure
 * is shown beside the thing that failed.
 *
 * Every word arrives as a prop, already resolved on the server by whoever
 * renders this (`Translated`), because the catalogues never reach a client
 * bundle (T-1040). What the API says comes back in `state.message` and is
 * shown as it came.
 *
 * `result="failure-inline"` is for the small inline controls (a pin, a
 * follow): a success needs no sentence there, the page re-renders with it.
 */
export function CommunityAction({
  action,
  submit,
  working,
  done,
  testId,
  resultTestId,
  formTestId,
  variant,
  size,
  pressed,
  buttonClassName = 'self-start',
  formClassName = 'flex flex-col gap-1',
  result = 'block',
  inlineClassName,
  children,
}: {
  action: BoundAction;
  submit: ReactNode;
  /** Shown on the button while the action runs; omitted, the label stays. */
  working?: ReactNode;
  /** Said on a success the API sent no sentence for. */
  done?: ReactNode;
  testId: string;
  resultTestId?: string;
  formTestId?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'xs' | 'sm' | 'md';
  pressed?: boolean;
  buttonClassName?: string;
  formClassName?: string;
  result?: 'block' | 'failure-inline';
  inlineClassName?: string;
  /** The fields, above the button. */
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={formClassName} data-testid={formTestId}>
      {children}
      <Button
        type="submit"
        variant={variant}
        size={size}
        pending={pending}
        pendingLabel={working}
        aria-pressed={pressed}
        data-testid={testId}
        className={buttonClassName}
      >
        {submit}
      </Button>
      {state !== null &&
        (result === 'block' ? (
          <FormStatus ok={state.ok} data-testid={resultTestId ?? `${testId}-result`}>
            {state.ok ? (state.message ?? done) : state.message}
          </FormStatus>
        ) : (
          !state.ok && (
            <FormStatus ok={false} as="span" size="xs" className={inlineClassName}>
              {' '}
              {state.message}
            </FormStatus>
          )
        ))}
    </form>
  );
}

/**
 * A small pill of a control -- a reaction -- as a form of its own: pressed or
 * not, with a refusal said beside it and a success left to the re-render.
 */
export function CommunityChip({
  action,
  pressed,
  className,
  testId,
  children,
}: {
  action: BoundAction;
  pressed: boolean;
  className: string;
  testId: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        aria-pressed={pressed}
        className={className}
        data-testid={testId}
      >
        {children}
      </button>
      {state !== null && !state.ok && (
        <FormStatus ok={false} as="span" size="xs">
          {' '}
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}
