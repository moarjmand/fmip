'use client';

import { useActionState } from 'react';
import type { MemberModerationHistory, Sanction } from '@fmip/contracts';
import { liftSanctionAction } from '@/lib/moderation-actions';

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
      <label className="flex flex-col gap-1 text-sm">
        <span className="sr-only">Why it is being lifted</span>
        <textarea
          name="reason"
          rows={2}
          required
          placeholder="Say why it is being lifted. This is recorded."
          className="rounded border border-current/30 bg-transparent p-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        data-testid={`moderation-lift-${sanction.id}`}
        className="self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
      >
        {pending ? 'Recording…' : 'Lift this restriction'}
      </button>
      {state !== null && (
        <p
          role="status"
          className={state.ok ? 'text-sm' : 'text-sm text-red-800 dark:text-red-300'}
        >
          {state.message}
        </p>
      )}
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
          <p className="text-sm opacity-70">None, now or before.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {history.sanctions.map((sanction) => (
              <li
                key={sanction.id}
                className="flex flex-col gap-2 rounded border border-current/20 p-3 text-sm"
              >
                <p>
                  <span className="font-medium">{sanction.scope}</span>
                  <span className="ms-2">{sanctionTerm(sanction)}</span>
                  <span className="ms-2 opacity-70">
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
          <p className="text-sm opacity-70">No decision has been made about them.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {history.decisions.map((decision) => (
              <li key={decision.id}>
                <span className="font-medium">{decision.outcome}</span>
                <span className="ms-2 opacity-70">
                  by {decision.moderator},{' '}
                  <time dateTime={decision.created_at}>{decision.created_at}</time>
                </span>
                <p className="whitespace-pre-wrap opacity-80">{decision.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="moderation-history-reports">
        <h2 className="text-lg font-semibold">Reports about them</h2>
        {history.reports_about_them.length === 0 ? (
          <p className="text-sm opacity-70">Nobody has reported them.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {history.reports_about_them.map((report) => (
              <li key={report.id}>
                <span className="font-medium">{report.reason}</span>
                <span className="ms-2 opacity-70">
                  by {report.reporter},{' '}
                  <time dateTime={report.created_at}>{report.created_at}</time>
                  {report.decision_id === null ? ', open' : ', answered'}
                </span>
                {report.detail !== null && (
                  <p className="whitespace-pre-wrap opacity-80">{report.detail}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
