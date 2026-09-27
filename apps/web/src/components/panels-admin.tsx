'use client';

import { useActionState, type ReactNode } from 'react';
import Link from 'next/link';
import type { PanelRecord } from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import { closePanelAction, openPanelAction } from '@/lib/panel-admin-actions';
import { Button, Card, FormStatus, Notice, TextArea, TextField } from '@/components/ui';

/**
 * Featured matches (blueprint 10.2, T-613): which fixtures have a public
 * discussion, who opened it and why, and opening or closing one with a reason.
 * Closing keeps what was posted readable; the API says so and does so.
 */

function ReasonForm({
  action,
  label,
  testId,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  testId: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      {children}
      <TextArea
        label={`Why, for ${label}`}
        hideLabel
        name="reason"
        rows={2}
        required
        placeholder="Say why. This is recorded."
      />
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Recording…"
        data-testid={testId}
        className="self-start"
      >
        {label}
      </Button>
      {state !== null && <FormStatus ok={state.ok}>{state.message}</FormStatus>}
    </form>
  );
}

export function PanelsAdmin({
  locale,
  panels,
  reachable,
}: {
  locale: string;
  panels: PanelRecord[];
  reachable: boolean;
}) {
  if (!reachable) {
    return (
      <Notice tone="danger" data-testid="panels-unreachable">
        The featured matches cannot be shown right now.
      </Notice>
    );
  }
  const open = panels.filter((panel) => panel.closed_at === null);
  const closed = panels.filter((panel) => panel.closed_at !== null);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Feature a match</h2>
        <ReasonForm
          action={openPanelAction.bind(null, locale)}
          label="Open the discussion"
          testId="panel-open"
        >
          <TextField label="The match page's address, or the match id" name="match" required />
        </ReasonForm>
      </section>

      <section className="flex flex-col gap-2" data-testid="panels-open">
        <h2 className="text-lg font-semibold">Open now</h2>
        {open.length === 0 ? (
          <p className="text-sm text-muted">No match is featured right now.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((panel) => (
              <Card as="li" key={panel.fixture_id} className="text-sm">
                <p>
                  <Link
                    href={`/${locale}/match/${panel.fixture_id}`}
                    className="font-medium underline"
                  >
                    {panel.home} – {panel.away}
                  </Link>
                  <span className="ms-2 text-muted">
                    kick-off <time dateTime={panel.kickoff_at}>{panel.kickoff_at}</time>,{' '}
                    {panel.posts} post{panel.posts === 1 ? '' : 's'}
                  </span>
                </p>
                <p className="text-muted">
                  Opened by {panel.opened_by}: {panel.reason}
                </p>
                <ReasonForm
                  action={closePanelAction.bind(null, locale, panel.fixture_id)}
                  label="Close the discussion"
                  testId={`panel-close-${panel.fixture_id}`}
                />
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="panels-closed">
        <h2 className="text-lg font-semibold">Closed</h2>
        {closed.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {closed.map((panel) => (
              <li key={panel.fixture_id}>
                <Link href={`/${locale}/match/${panel.fixture_id}`} className="underline">
                  {panel.home} – {panel.away}
                </Link>
                <span className="ms-2 text-muted">
                  closed by {panel.closed_by ?? 'unknown'}: {panel.close_reason ?? ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
