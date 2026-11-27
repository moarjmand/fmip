'use client';

import { useActionState } from 'react';
import type { MemberModerationHistory, QueuedAppeal, Sanction } from '@fmip/contracts';
import Link from '@/components/ui/link';
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
      {/* T-1973: the member reads this on their account, beside the restriction. */}
      <TextArea
        label="Why it is being lifted (the member reads this)"
        hideLabel
        name="reason"
        rows={2}
        required
        placeholder="Say why it is being lifted. This is recorded."
        hint="Shown to the member on their account; your name is not. Do not name or hint at who reported them."
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

/**
 * Members' appeals of sanctions and decisions (T-1973), newest first: in the
 * queue for every member, and on one member's history page for theirs. What
 * was appealed, the decision's reason, the appeal's words and when. A
 * moderator answers a sanction's appeal by lifting it, or a decision's by a
 * new decision; the appeal itself stays as written.
 */
export function MemberAppeals({
  locale,
  appeals,
  showMember = false,
}: {
  locale: string;
  appeals: QueuedAppeal[];
  /** In the queue, each appeal names its member and links to their history. */
  showMember?: boolean;
}) {
  if (appeals.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="moderation-appeals-empty">
        No appeal has been written.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="moderation-appeals">
      {appeals.map((appeal) => (
        <li
          key={appeal.id}
          className="flex flex-col gap-1 rounded border border-default p-3 text-sm"
          data-testid="moderation-appeal"
        >
          <p className="flex flex-wrap items-baseline gap-x-2">
            {showMember && (
              <Link
                href={`/${locale}/admin/moderation/${encodeURIComponent(appeal.username)}`}
                className="font-medium underline"
              >
                @{appeal.username}
              </Link>
            )}
            <span className="font-medium">
              {appeal.sanction_id === null
                ? appeal.outcome
                : `${appeal.scope ?? 'restriction'} (${appeal.active === true ? 'in force' : 'not in force'})`}
            </span>
            <span className="text-muted">
              appealed <time dateTime={appeal.created_at}>{appeal.created_at}</time>
            </span>
          </p>
          <p className="text-muted">
            Decision&apos;s reason:{' '}
            <span className="whitespace-pre-wrap">{appeal.decision_reason}</span>
          </p>
          <p className="whitespace-pre-wrap" data-testid="moderation-appeal-body">
            {appeal.body}
          </p>
        </li>
      ))}
    </ul>
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

      <section className="flex flex-col gap-2" data-testid="moderation-history-appeals">
        <h2 className="text-lg font-semibold">Their appeals</h2>
        <MemberAppeals locale={locale} appeals={history.appeals} />
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
