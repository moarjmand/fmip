'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type {
  DataQualityCheck,
  DataQualityCount,
  DataQualityFinding,
  DataQualityFixtureRef,
  DataQualityReport,
} from '@fmip/contracts';
import { refetchAction, reviewBatchAction, reviewFindingAction } from '@/lib/data-quality-actions';
import { Button, Card, FormStatus, Notice, TextArea } from '@/components/ui';

/**
 * Data-quality findings over the stored feed (T-820, T-821): when each check
 * last ran, open findings per competition and check, and each open finding
 * with links to the match or team it names. A finding can be marked reviewed
 * with a reason (audited), one at a time or every open one of a check in a
 * season at once (T-912, one audit row per batch). The feed can be asked again
 * for one match or for a check's matches in a season (T-913, audited); nothing
 * here edits the feed.
 */

export const CHECK_LABEL: Record<DataQualityCheck, string> = {
  finished_without_score: 'Finished without a full-time score',
  goals_disagree: 'Goals in the timeline disagree with the score',
  live_overrun: 'Still live long after kick-off',
  lineup_not_eleven: 'A line-up that is not eleven',
  fixture_mapped_twice: 'One fixture with two ids from one provider',
  duplicate_fixture: 'One match stored twice',
  table_disagrees: "The provider's table disagrees with ours",
};

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="tabular-nums">
      {iso.slice(0, 16).replace('T', ' ')} UTC
    </time>
  );
}

function MatchLink({ locale, fixture }: { locale: string; fixture: DataQualityFixtureRef }) {
  return (
    <Link href={`/${locale}/match/${fixture.id}`} className="font-medium underline">
      {fixture.home} – {fixture.away}
      <span className="ms-1 font-normal text-muted">
        ({fixture.status}, <When iso={fixture.kickoff_at} />)
      </span>
    </Link>
  );
}

function ReviewForm({ locale, id }: { locale: string; id: number }) {
  const [state, formAction, pending] = useActionState(
    reviewFindingAction.bind(null, locale, id),
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <TextArea
        label="Why it is reviewed"
        hideLabel
        name="reason"
        rows={2}
        required
        placeholder="Say what was checked, or who was asked. This is recorded."
      />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        pending={pending}
        pendingLabel="Recording…"
        data-testid={`finding-review-${id}`}
        className="self-start"
      >
        Mark reviewed
      </Button>
      {state !== null && <FormStatus ok={state.ok}>{state.message}</FormStatus>}
    </form>
  );
}

/**
 * Every open, unreviewed finding of one check in one season, reviewed with one
 * reason. Shown only where there is something left to review in the group.
 */
function BatchReviewForm({
  locale,
  count,
  seasonId,
}: {
  locale: string;
  count: DataQualityCount;
  seasonId: string;
}) {
  const [state, formAction, pending] = useActionState(
    reviewBatchAction.bind(null, locale, count.check, seasonId),
    null,
  );
  const waiting = count.open - count.reviewed;
  const testId = `batch-review-${count.check}-${seasonId}`;
  return (
    <details className="w-full text-sm" data-testid={testId}>
      <summary className="cursor-pointer underline">Review all {waiting} with one reason</summary>
      <form action={formAction} className="mt-1 flex flex-col gap-1">
        <TextArea
          label={`Why all ${waiting} are reviewed`}
          hideLabel
          name="reason"
          rows={2}
          required
          placeholder="Say what was checked, or who was asked. This is recorded once for the batch."
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          pending={pending}
          pendingLabel="Recording…"
          data-testid={`${testId}-submit`}
          className="self-start"
        >
          Mark {waiting} reviewed
        </Button>
        {state !== null && <FormStatus ok={state.ok}>{state.message}</FormStatus>}
      </form>
    </details>
  );
}

/** Asks the feed again for one match, or for a check's matches in a season (T-913). */
function RefetchForm({
  locale,
  target,
  label,
  testId,
}: {
  locale: string;
  target: { fixture_id: string } | { check: DataQualityCheck; season_id: string };
  label: string;
  testId: string;
}) {
  const [state, formAction, pending] = useActionState(
    refetchAction.bind(null, locale, target),
    null,
  );
  return (
    <details className="w-full text-sm" data-testid={testId}>
      <summary className="cursor-pointer underline">{label}</summary>
      <form action={formAction} className="mt-1 flex flex-col gap-1">
        <TextArea
          label="Why the feed is asked again"
          hideLabel
          name="reason"
          rows={2}
          required
          placeholder="Say what looks wrong. This is recorded, and the request counts against the day's budget."
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          pending={pending}
          pendingLabel="Queuing…"
          data-testid={`${testId}-submit`}
          className="self-start"
        >
          Ask the feed again
        </Button>
        {state !== null && <FormStatus ok={state.ok}>{state.message}</FormStatus>}
      </form>
    </details>
  );
}

/** What became of the newest re-ask of the finding's match (T-913). */
function AskedAgain({ asked }: { asked: NonNullable<DataQualityFinding['asked_again']> }) {
  if (asked.fetched_at === null) {
    return (
      <>
        Asked again on <When iso={asked.requested_at} />, waiting for the feed.
      </>
    );
  }
  return asked.changed === true ? (
    <>
      Asked again on <When iso={asked.fetched_at} />: the answer changed, and still disagrees.
    </>
  ) : (
    <>
      Asked again on <When iso={asked.fetched_at} />, unchanged.
    </>
  );
}

function FindingCard({ locale, finding }: { locale: string; finding: DataQualityFinding }) {
  return (
    <Card as="li" className="flex flex-col gap-2 text-sm" data-testid={`finding-${finding.id}`}>
      <p className="flex flex-wrap gap-x-2">
        {finding.competition !== null && (
          <Link href={`/${locale}/competition/${finding.competition.id}`} className="underline">
            {finding.competition.name}
          </Link>
        )}
        {finding.season !== null && <span className="text-muted">{finding.season.label}</span>}
      </p>
      {finding.fixture !== null && (
        <p>
          <MatchLink locale={locale} fixture={finding.fixture} />
        </p>
      )}
      {finding.related_fixture !== null && (
        <p>
          and <MatchLink locale={locale} fixture={finding.related_fixture} />
        </p>
      )}
      {finding.team !== null && (
        <p>
          <Link href={`/${locale}/team/${finding.team.id}`} className="underline">
            {finding.team.name}
          </Link>
        </p>
      )}
      <p>{finding.detail}</p>
      <p className="text-xs text-muted">
        First seen <When iso={finding.first_seen_at} />, last seen{' '}
        <When iso={finding.last_seen_at} />
      </p>
      {finding.asked_again !== null && (
        <p className="text-xs text-muted" data-testid={`finding-asked-again-${finding.id}`}>
          <AskedAgain asked={finding.asked_again} />
        </p>
      )}
      {finding.fixture !== null && finding.asked_again?.fetched_at !== null && (
        <RefetchForm
          locale={locale}
          target={{ fixture_id: finding.fixture.id }}
          label="Ask the feed again for this match"
          testId={`finding-refetch-${finding.id}`}
        />
      )}
      {finding.reviewed === null ? (
        <ReviewForm locale={locale} id={finding.id} />
      ) : (
        <p className="text-muted" data-testid={`finding-reviewed-${finding.id}`}>
          Reviewed by {finding.reviewed.by ?? 'a removed account'} (
          <When iso={finding.reviewed.at} />
          ): {finding.reviewed.reason}
        </p>
      )}
    </Card>
  );
}

export function DataQualityAdmin({
  locale,
  report,
}: {
  locale: string;
  report: DataQualityReport | null;
}) {
  if (report === null) {
    return (
      <Notice tone="danger" data-testid="data-quality-unreachable">
        The data-quality findings cannot be shown right now.
      </Notice>
    );
  }
  const notCurrent = report.checks.filter((c) => c.freshness !== 'current');
  const byCheck = new Map<DataQualityCheck, DataQualityFinding[]>();
  for (const finding of report.findings) {
    byCheck.set(finding.check, [...(byCheck.get(finding.check) ?? []), finding]);
  }

  return (
    <div className="flex flex-col gap-8">
      {notCurrent.length > 0 && (
        <Notice tone="warning" data-testid="data-quality-not-current">
          Not checked lately, so no findings from these does not mean none:{' '}
          {notCurrent
            .map(
              (c) =>
                `${CHECK_LABEL[c.check]} (${c.checked_at === null ? 'never run' : `last run ${c.checked_at.slice(0, 16).replace('T', ' ')} UTC`})`,
            )
            .join('; ')}
          .
        </Notice>
      )}

      <section className="flex flex-col gap-2" data-testid="data-quality-checks">
        <h2 className="text-lg font-semibold">Checks</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {report.checks.map((c) => (
            <li key={c.check} className="flex flex-wrap justify-between gap-x-4">
              <span>{CHECK_LABEL[c.check]}</span>
              <span className="text-muted">
                {c.open} open · {c.checked_at === null ? 'never run' : <When iso={c.checked_at} />}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          {report.open_total} open in all, {report.resolved_last_day} resolved in the last day.
        </p>
        <p className="text-xs text-muted" data-testid="data-quality-refetch">
          {report.refetch.pending} match{report.refetch.pending === 1 ? '' : 'es'} waiting to be
          asked again, {report.refetch.fetched_today} asked since 00:00 UTC.
        </p>
      </section>

      <section className="flex flex-col gap-2" data-testid="data-quality-by-competition">
        <h2 className="text-lg font-semibold">Open, by competition and season</h2>
        {report.counts.length === 0 ? (
          <p className="text-sm text-muted">No open findings.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {report.counts.map((c) => (
              <li
                key={`${c.competition?.id ?? 'none'}:${c.season?.id ?? 'none'}:${c.check}`}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1"
              >
                <span>
                  {c.competition === null ? 'No competition' : c.competition.name}
                  {c.season !== null && ` ${c.season.label}`} · {CHECK_LABEL[c.check]}
                </span>
                <span className="tabular-nums text-muted">
                  {c.open} open{c.reviewed > 0 ? `, ${c.reviewed} reviewed` : ''}
                </span>
                {c.season !== null && c.open > c.reviewed && (
                  <BatchReviewForm locale={locale} count={c} seasonId={c.season.id} />
                )}
                {c.season !== null && c.check !== 'table_disagrees' && (
                  <RefetchForm
                    locale={locale}
                    target={{ check: c.check, season_id: c.season.id }}
                    label={`Ask the feed again for every match behind these ${c.open}`}
                    testId={`batch-refetch-${c.check}-${c.season.id}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-6" data-testid="data-quality-findings">
        <h2 className="text-lg font-semibold">Open findings</h2>
        {report.findings.length < report.open_total && (
          <p className="text-sm text-muted">
            The newest {report.findings.length} of {report.open_total}.
          </p>
        )}
        {report.findings.length === 0 ? (
          <p className="text-sm text-muted">None open.</p>
        ) : (
          [...byCheck.entries()].map(([check, findings]) => (
            <div key={check} className="flex flex-col gap-2">
              <h3 className="font-medium">
                {CHECK_LABEL[check]} ({findings.length})
              </h3>
              <ul className="flex flex-col gap-3">
                {findings.map((finding) => (
                  <FindingCard key={finding.id} locale={locale} finding={finding} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
