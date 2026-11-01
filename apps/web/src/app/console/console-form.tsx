'use client';

import { type ReactNode, useActionState } from 'react';
import type { ConsoleFormState } from '@/lib/console-actions';

/**
 * A console form whose action answers with what happened (D-340): the
 * outcome is said under the button, in a live region, and the button waits
 * while the action runs.
 */
export function ConsoleForm({
  action,
  submit,
  children,
  className = 'flex flex-col gap-3',
}: {
  action: (state: ConsoleFormState, form: FormData) => Promise<ConsoleFormState>;
  submit: string;
  children: ReactNode;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, { error: null, done: null });
  return (
    <form action={run} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-touch rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
        >
          {pending ? '…' : submit}
        </button>
        <p role="status" aria-live="polite" className="text-sm">
          {state.error !== null && <span className="text-danger">{state.error}</span>}
          {state.done !== null && <span className="text-success">{state.done}</span>}
        </p>
      </div>
    </form>
  );
}
