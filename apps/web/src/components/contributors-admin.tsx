'use client';

import { useActionState, type ReactNode } from 'react';
import Link from 'next/link';
import type { ContributorCandidate, GrantStanding } from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import { contributorEventAction, grantContributorAction } from '@/lib/contributor-actions';

/**
 * Contributors (blueprint 9.4, T-612).
 *
 * **Eligibility and the grant stay two things on the page, as in the
 * contract.** What the platform computed (the four requirements and what is
 * missing) is shown beside what a person decided (the grant, its approver,
 * its history); nothing here merges them into one "approved" flag.
 */

type Event = 'pause' | 'resume' | 'withdraw';

/** Which actions a standing allows is shown here for convenience; the API refuses the rest. */
const EVENTS_FOR: Record<GrantStanding, Event[]> = {
  active: ['pause', 'withdraw'],
  paused: ['resume', 'withdraw'],
  withdrawn: [],
};

const EVENT_LABELS: Record<Event, string> = {
  pause: 'Pause',
  resume: 'Resume',
  withdraw: 'Withdraw',
};

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
      <label className="flex flex-col gap-1 text-sm">
        <span className="sr-only">Why, for {label}</span>
        <textarea
          name="reason"
          rows={2}
          required
          placeholder="Say why. The member can read it."
          className="rounded border border-strong bg-transparent p-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        data-testid={testId}
        className="self-start rounded border border-strong px-3 py-1 text-sm disabled:opacity-50"
      >
        {pending ? 'Recording…' : label}
      </button>
      {state !== null && (
        <p role="status" className={state.ok ? 'text-sm' : 'text-sm text-danger'}>
          {state.message}
        </p>
      )}
    </form>
  );
}

function Candidate({ locale, entry }: { locale: string; entry: ContributorCandidate }) {
  const { eligibility, grant } = entry;
  return (
    <li
      className="flex flex-col gap-3 rounded border border-default p-4"
      data-testid="contributor-entry"
    >
      <p>
        <Link
          href={`/${locale}/u/${encodeURIComponent(entry.username)}`}
          className="font-medium underline"
        >
          @{entry.username}
        </Link>
      </p>

      <div className="text-sm" data-testid="contributor-eligibility">
        <p className="font-medium">
          Computed: {eligibility.qualifies ? 'meets all four requirements' : 'does not qualify yet'}
        </p>
        <p className="text-muted">
          rating {eligibility.rating ?? 'none yet'}, {eligibility.settled_count} settled, e-mail{' '}
          {eligibility.email_verified ? 'verified' : 'not verified'}
          {eligibility.under_sanction ? ', under a restriction now' : ''}
        </p>
        {eligibility.shortfalls.length > 0 && (
          <ul className="list-disc ps-5 text-muted">
            {eligibility.shortfalls.map((shortfall) => (
              <li key={shortfall.requirement}>{shortfall.message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-sm" data-testid="contributor-grant">
        {grant === null ? (
          <p className="font-medium">Decided: never granted</p>
        ) : (
          <>
            <p className="font-medium">
              Decided: {grant.standing}, granted by {grant.granted_by} on{' '}
              <time dateTime={grant.granted_at}>{grant.granted_at}</time>
            </p>
            <p className="whitespace-pre-wrap text-muted">{grant.reason}</p>
            {grant.history.length > 0 && (
              <ul className="ps-3 text-muted">
                {grant.history.map((event) => (
                  <li key={`${event.kind}-${event.at}`}>
                    {event.kind} by {event.actor}, <time dateTime={event.at}>{event.at}</time>:{' '}
                    {event.reason}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        {grant === null || grant.standing === 'withdrawn' ? (
          <ReasonForm
            action={grantContributorAction.bind(null, locale)}
            label="Grant"
            testId={`contributor-grant-${entry.username}`}
          >
            <input type="hidden" name="username" value={entry.username} />
          </ReasonForm>
        ) : (
          EVENTS_FOR[grant.standing].map((event) => (
            <ReasonForm
              key={event}
              action={contributorEventAction.bind(null, locale, entry.username, event)}
              label={EVENT_LABELS[event]}
              testId={`contributor-${event}-${entry.username}`}
            />
          ))
        )}
      </div>
    </li>
  );
}

export function ContributorsAdmin({
  locale,
  entries,
  reachable,
}: {
  locale: string;
  entries: ContributorCandidate[];
  reachable: boolean;
}) {
  if (!reachable) {
    return (
      <p role="alert" data-testid="contributors-unreachable">
        The contributor list cannot be shown right now.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Grant by username</h2>
        <ReasonForm
          action={grantContributorAction.bind(null, locale)}
          label="Grant"
          testId="contributor-grant-by-username"
        >
          <label className="flex flex-col gap-1 text-sm">
            Username
            <input
              name="username"
              required
              className="rounded border border-strong bg-transparent p-2"
            />
          </label>
        </ReasonForm>
      </section>

      {entries.length === 0 ? (
        <p className="text-sm text-muted" data-testid="contributors-empty">
          Nobody qualifies or holds a grant yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="contributors">
          {entries.map((entry) => (
            <Candidate key={entry.username} locale={locale} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
