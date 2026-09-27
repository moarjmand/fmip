'use client';

import { useActionState } from 'react';
import type { MemberModerationHistory, Sanction } from '@fmip/contracts';
import { liftSanctionAction } from '@/lib/moderation-actions';
import { Button, FormStatus, TextArea } from '@/components/ui';

/**
 * Everything about one member's standing, on one page (T-611).
 *
 * Reports, decisions and sanctions together, because a moderator deciding on
 * the third report about somebody should see the first two and what was done
 * about them. A sanction in force can be lifted here, with a reason; the API
 * records who lifted it and why (rule 10).
 */

function Lift({
  locale,
  username,
  sanction,
}: {
  locale: string;
  username: string;
  sanction: Sanction;
}) {
  const [state, formAction, pending] = useActionState(
    liftSanctionAction.bind(null, locale, username, sanction.id),
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <TextArea
        label="Why it is being lifted"
        hideLabel
        name="reason"
        rows={2}
        required
        placeholder="Say why it is being lifted. This is recorded."
      />
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Recording…"
        data-testid={`moderation-lift-${sanction.id}`}
        className="self-start"
      >
        Lift this restriction
      </Button>
      {state !== null && <FormStatus ok={state.ok}>{state.message}</FormStatus>}
    </form>
  );
}

function sanctionTerm(sanction: Sanction): string {
  if (sanction.permanent) return 'permanent';
  return `until ${sanction.ends_at ?? 'unknown'}`;
}

export function MemberModerationHistoryView({
  locale,
  history,
}: {
  locale: string;
  history: MemberModerationHistory;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2" data-testid="moderation-history-sanctions">
        <h2 className="text-lg font-semibold">Restrictions</h2>
        {history.sanctions.length === 0 ? (
          <p className="text-sm text-muted">None, now or before.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {history.sanctions.map((sanction) => (
              <li
                key={sanction.id}
                className="flex flex-col gap-2 rounded border border-default p-3 text-sm"
              >
                <p>
                  <span className="font-medium">{sanction.scope}</span>
                  <span className="ms-2">{sanctionTerm(sanction)}</span>
                  <span className="ms-2 text-muted">
                    {sanction.active
                      ? 'in force'
                      : sanction.lifted_at !== null
                        ? `lifted ${sanction.lifted_at} by ${sanction.lifted_by ?? 'unknown'}: ${sanction.lift_reason ?? ''}`
                        : 'ended'}
                  </span>
                </p>
                {sanction.active && (
                  <Lift locale={locale} username={history.username} sanction={sanction} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="moderation-history-decisions">
        <h2 className="text-lg font-semibold">Decisions</h2>
        {history.decisions.length === 0 ? (
          <p className="text-sm text-muted">No decision has been made about them.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {history.decisions.map((decision) => (
              <li key={decision.id}>
                <span className="font-medium">{decision.outcome}</span>
                <span className="ms-2 text-muted">
                  by {decision.moderator},{' '}
                  <time dateTime={decision.created_at}>{decision.created_at}</time>
                </span>
                <p className="whitespace-pre-wrap text-muted">{decision.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="moderation-history-reports">
        <h2 className="text-lg font-semibold">Reports about them</h2>
        {history.reports_about_them.length === 0 ? (
          <p className="text-sm text-muted">Nobody has reported them.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {history.reports_about_them.map((report) => (
              <li key={report.id}>
                <span className="font-medium">{report.reason}</span>
                <span className="ms-2 text-muted">
                  by {report.reporter},{' '}
                  <time dateTime={report.created_at}>{report.created_at}</time>
                  {report.decision_id === null ? ', open' : ', answered'}
                </span>
                {report.detail !== null && (
                  <p className="whitespace-pre-wrap text-muted">{report.detail}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
