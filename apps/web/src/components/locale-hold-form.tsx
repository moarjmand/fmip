'use client';

import { useActionState } from 'react';
import { localeHoldAction } from '@/lib/locale-hold-actions';
import { Button, FormStatus, TextField } from '@/components/ui';

/**
 * Hold back a ready language, or release one (T-1163, D-155), with a reason.
 * One form per language row on `/admin`; the API decides and audits.
 */
export function LocaleHoldForm({
  pageLocale,
  target,
  verb,
  name,
}: {
  pageLocale: string;
  target: string;
  verb: 'hold' | 'release';
  name: string;
}) {
  const [state, formAction, pending] = useActionState(
    localeHoldAction.bind(null, pageLocale, target, verb),
    null,
  );
  const label = verb === 'hold' ? `Hold back ${name}` : `Release ${name}`;
  return (
    <form action={formAction} className="flex w-full flex-wrap items-end gap-2">
      <TextField
        label={`Why, for: ${label}`}
        hideLabel
        name="reason"
        size="sm"
        required
        placeholder="Say why. This is recorded."
        className="min-w-48 flex-1"
      />
      <Button
        type="submit"
        size="sm"
        pending={pending}
        pendingLabel="Recording…"
        data-testid={`language-${verb}-${target}`}
      >
        {label}
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} className="w-full">
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}
