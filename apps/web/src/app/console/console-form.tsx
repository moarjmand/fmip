'use client';

import { type ReactNode, useActionState } from 'react';
import type { ConsoleFormState } from '@/lib/console-actions';

const PRIMARY =
  'min-h-touch rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** One of several submit buttons, sent as `name=value` with the form (T-1728). */
export interface ConsoleFormButton {
  name: string;
  value: string;
  label: string;
  className?: string;
}

/**
 * A console form whose action answers with what happened (D-340): the
 * outcome is said under the button, in a live region, and the button waits
 * while the action runs. `buttons` puts several submit buttons in place of
 * the one (a decision's three answers); `submitClassName` restyles the one.
 */
export function ConsoleForm({
  action,
  submit,
  children,
  className = 'flex flex-col gap-3',
  buttons,
  submitClassName = PRIMARY,
}: {
  action: (state: ConsoleFormState, form: FormData) => Promise<ConsoleFormState>;
  submit: string;
  children?: ReactNode;
  className?: string;
  buttons?: ConsoleFormButton[];
  submitClassName?: string;
}) {
  const [state, run, pending] = useActionState(action, { error: null, done: null });
  return (
    <form action={run} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        {buttons === undefined ? (
          <button type="submit" disabled={pending} className={submitClassName}>
            {pending ? '…' : submit}
          </button>
        ) : (
          buttons.map((button) => (
            <button
              key={button.value}
              type="submit"
              name={button.name}
              value={button.value}
              disabled={pending}
              className={button.className ?? PRIMARY}
            >
              {button.label}
            </button>
          ))
        )}
        <p role="status" aria-live="polite" className="text-sm">
          {state.error !== null && <span className="text-danger">{state.error}</span>}
          {state.done !== null && <span className="text-success">{state.done}</span>}
        </p>
      </div>
    </form>
  );
}
