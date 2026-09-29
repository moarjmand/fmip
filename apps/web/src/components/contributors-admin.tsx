'use client';

import { useActionState, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  ContributorCandidate,
  ContributorFlagListResponse,
  GrantStanding,
} from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import {
  contributorEventAction,
  dismissContributorFlagAction,
  grantContributorAction,
} from '@/lib/contributor-actions';
import { FLAG_NOTHING_PAUSED, flagSummary, periodLine } from '@/lib/contributor-flags';
import { Button, Card, FormStatus, Notice, TextArea, TextField } from '@/components/ui';

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
  placeholder = 'Say why. The member can read it.',
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  testId: string;
  children?: ReactNode;
  placeholder?: string;
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
        placeholder={placeholder}
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

function Candidate({ locale, entry }: { locale: string; entry: ContributorCandidate }) {
  const { eligibility, grant } = entry;
  return (
    <Card as="li" data-testid="contributor-entry">
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
    </Card>
  );
}

/**
 * Contributors below the threshold for the sustained period (T-1031, D-137).
 * A flag is a question for a person: nothing was paused, and the two answers
 * are the existing Pause on the member's entry or a dismissal with a reason.
 */
function ContributorFlags({
  locale,
  flags,
  now,
}: {
  locale: string;
  /** Null when the flags could not be fetched: said, not shown as none. */
  flags: ContributorFlagListResponse | null;
  now: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="contributor-flags">
      <h2 className="text-lg font-semibold">Flagged below the threshold</h2>
      {flags === null ? (
        <Notice tone="danger" data-testid="contributor-flags-unreachable">
          The contributor flags cannot be shown right now.
        </Notice>
      ) : (
        <>
          <p className="text-sm text-muted">{periodLine(flags.period_days, flags.threshold)}</p>
          {flags.flags.length === 0 ? (
            <p className="text-sm text-muted" data-testid="contributor-flags-empty">
              No contributor is flagged.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {flags.flags.map((flag) => (
                <Card as="li" key={flag.id} data-testid="contributor-flag">
                  <p>
                    <Link
                      href={`/${locale}/u/${encodeURIComponent(flag.username)}`}
                      className="font-medium underline"
                    >
                      @{flag.username}
                    </Link>{' '}
                    <span className="text-sm text-muted">({flag.standing})</span>
                  </p>
                  <p className="text-sm">{flagSummary(flag, new Date(now))}</p>
                  <p className="text-sm text-muted">{FLAG_NOTHING_PAUSED}</p>
                  <ReasonForm
                    action={dismissContributorFlagAction.bind(null, locale, flag.id)}
                    label="Dismiss"
                    testId={`contributor-flag-dismiss-${flag.username}`}
                    placeholder="Say why. It is recorded with the flag."
                  />
                </Card>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function ContributorsAdmin({
  locale,
  entries,
  reachable,
  flags = null,
  now = new Date(0).toISOString(),
}: {
  locale: string;
  entries: ContributorCandidate[];
  reachable: boolean;
  /** The open flags (T-1031); null when they could not be fetched. */
  flags?: ContributorFlagListResponse | null;
  /** When the page was assembled, so the day counts do not differ between server and browser. */
  now?: string;
}) {
  if (!reachable) {
    return (
      <Notice tone="danger" data-testid="contributors-unreachable">
        The contributor list cannot be shown right now.
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ContributorFlags locale={locale} flags={flags} now={now} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Grant by username</h2>
        <ReasonForm
          action={grantContributorAction.bind(null, locale)}
          label="Grant"
          testId="contributor-grant-by-username"
        >
          <TextField label="Username" name="username" required />
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
