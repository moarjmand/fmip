import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { AuditRecord } from '@fmip/contracts';
import { Card, Notice } from '@/components/ui';
import {
  fetchAdminUsers,
  fetchAudit,
  fetchCareerPoints,
  fetchContributorFlags,
  fetchContributorStatus,
  fetchMe,
  fetchMemberModerationHistory,
  fetchPredictionHistory,
  fetchRating,
  fetchRatingHistory,
} from '@/lib/api';
import {
  MEMBER_SETTLEMENTS,
  exactMember,
  flagsOf,
  isTombstone,
  settlementRows,
  yesNo,
} from '@/lib/member-page';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Metadata> {
  const { locale, username } = await params;
  return pageMetadata({
    locale,
    path: `/admin/members/${username}`,
    title: `Member @${username}`,
    description: "One member's standing in the console.",
    index: false,
  });
}

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  return <p className="text-sm text-muted">{what} could not be read right now.</p>;
}

function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{iso.slice(0, 16).replace('T', ' ')} UTC</time>;
}

function AuditRows({ records }: { records: AuditRecord[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-muted">No audit row names this account as its target.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {records.map((record) => (
        <li key={record.id}>
          <When iso={record.created_at} /> · <code>{record.action}</code> by @
          {record.actor.username}: {record.reason}
        </li>
      ))}
    </ul>
  );
}

/**
 * A member's page in the console (blueprint 16, T-1164), reached from the
 * member search on `/admin`. Administrators only: the account is found
 * through `GET /admin/users`, and a refusal there is the page's refusal. A
 * moderator is pointed to the member's moderation history, which is what the
 * reports queue already shows them. Every section is an answer the API
 * already gives an administrator; the page links to the audited actions that
 * exist and writes nothing itself.
 */
export default async function MemberPage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}) {
  const { locale, username: raw } = await params;
  const username = decodeURIComponent(raw);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/members/${raw}`);

  const search = await fetchAdminUsers(username, cookie);
  const back = (
    <p className="text-sm">
      <Link href={`/${locale}/admin?q=${encodeURIComponent(username)}`} className="underline">
        ← Member search
      </Link>
    </p>
  );

  if (!search.ok && search.status === 403) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        <h1 className="text-2xl font-semibold">Member</h1>
        <Notice tone="warning" data-testid="member-page-forbidden">
          A member&rsquo;s page in the console needs the administrator role. A moderator has{' '}
          <Link
            href={`/${locale}/admin/moderation/${encodeURIComponent(username)}`}
            className="underline"
          >
            this member&rsquo;s moderation history
          </Link>
          .
        </Notice>
      </main>
    );
  }
  if (!search.ok) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        {back}
        <Notice tone="danger" data-testid="member-page-unreachable">
          The member could not be looked up right now.
        </Notice>
      </main>
    );
  }
  const user = exactMember(search.data.users, username);
  if (user === null) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        {back}
        <Notice tone="warning" data-testid="member-page-none">
          No account has the username @{username}.
        </Notice>
      </main>
    );
  }

  const tombstone = isTombstone(user);
  const [audit, moderation, contributor, flags, rating, history, predictions, points] =
    await Promise.all([
      fetchAudit(cookie, user.id),
      fetchMemberModerationHistory(user.username, cookie),
      fetchContributorStatus(user.username, cookie),
      fetchContributorFlags(cookie),
      // A tombstone's rating, history and points are kept for rule 8 and shown
      // nowhere (D-094); the public reads refuse it, so they are not asked.
      tombstone ? null : fetchRating(user.username),
      tombstone ? null : fetchRatingHistory(user.username, cookie),
      tombstone
        ? null
        : fetchPredictionHistory(user.username, `limit=${MEMBER_SETTLEMENTS}&offset=0`, cookie),
      tombstone ? null : fetchCareerPoints(user.username),
    ]);
  const settlements =
    predictions !== null && predictions.ok && predictions.data.kind === 'visible'
      ? settlementRows(predictions.data.items)
      : [];
  const theirFlags = flags.ok ? flagsOf(flags.data.flags, user.username) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      {back}
      <h1 className="text-2xl font-semibold" data-testid="member-page-title">
        @{user.username}
      </h1>

      <Section title="Account" testId="member-account">
        {tombstone && (
          <Notice tone="info" data-testid="member-tombstone">
            A deleted account (D-094): an anonymous tombstone. Its predictions, settlements, rating
            snapshots and points are kept without a name and shown nowhere; the audit rows and
            moderation records about it stay.
          </Notice>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            {user.display_name} · {user.email} ·{' '}
            {user.email_verified ? 'e-mail verified' : 'e-mail unverified'}
          </li>
          <li>
            Status: <span className="font-medium">{user.status}</span> · joined{' '}
            <When iso={user.created_at} />
          </li>
          <li>Roles: {user.roles.length === 0 ? 'none' : user.roles.join(', ')}</li>
        </ul>
        {!tombstone && (
          <p className="text-sm">
            <Link
              href={`/${locale}/admin?q=${encodeURIComponent(user.username)}`}
              className="underline"
            >
              Suspend or reinstate
            </Link>{' '}
            <span className="text-muted">(on the member search, with a reason, audited)</span>
          </p>
        )}
      </Section>

      {!tombstone && (
        <Section title="Rating and tier" testId="member-rating">
          {rating === null || !rating.ok ? (
            <Unavailable what="The rating" />
          ) : rating.data.rating === null ? (
            <p className="text-sm text-muted">No rating yet: nothing of theirs has settled.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                <span className="font-medium">{rating.data.rating.rating}</span> ·{' '}
                {rating.data.rating.tier}
                {rating.data.rating.provisional ? ' · provisional' : ''}
                {rating.data.rating.established ? ' · established' : ''}
              </li>
              <li>
                {rating.data.rating.settled_count} settled · {rating.data.rating.formula_version} ·
                computed <When iso={rating.data.rating.computed_at} />
              </li>
            </ul>
          )}
          {history === null || !history.ok ? (
            <Unavailable what="The rating history" />
          ) : history.data.kind === 'restricted' ? (
            <p className="text-sm text-muted" data-testid="member-history-restricted">
              Their prediction history is {history.data.visibility}, and the rating history follows
              it: the API gives an administrator no more than any other viewer.
            </p>
          ) : history.data.history === null ? (
            <p className="text-sm text-muted">No history yet.</p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p>
                Highest {history.data.history.highest.rating} on {history.data.history.highest.date}
                ; {history.data.history.points.length} days with a settlement.
              </p>
              <ul className="flex flex-col gap-1">
                {history.data.history.by_competition.map((c) => (
                  <li key={c.competition.id}>
                    {c.competition.name}: {c.rating} over {c.settled_count} settled
                    {c.provisional ? ' (provisional)' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {!tombstone && (
        <Section title="Settlements" testId="member-settlements">
          {predictions === null || !predictions.ok ? (
            <Unavailable what="The prediction history" />
          ) : predictions.data.kind === 'restricted' ? (
            <p className="text-sm text-muted">
              Their prediction history is {predictions.data.visibility}; the API gives an
              administrator no more than any other viewer.
            </p>
          ) : settlements.length === 0 ? (
            <p className="text-sm text-muted">
              None of their latest {MEMBER_SETTLEMENTS} predictions has settled.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-muted">
                  <th className="pe-3 text-start font-normal">Match</th>
                  <th className="pe-3 text-start font-normal">Settled</th>
                  <th className="pe-3 text-start font-normal">Outcome</th>
                  <th className="text-start font-normal">Score</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((row) => (
                  <tr key={row.fixtureId}>
                    <td className="pe-3">
                      <Link href={`/${locale}/match/${row.fixtureId}`} className="underline">
                        {row.match}
                      </Link>
                    </td>
                    <td className="pe-3">
                      {row.status === 'void' ? `void (${row.voidReason ?? 'no result'})` : ''}
                      <When iso={row.settledAt} />
                    </td>
                    <td className="pe-3">{yesNo(row.outcomeCorrect)}</td>
                    <td>{yesNo(row.scoreCorrect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {!tombstone && (
        <Section title="Career Points" testId="member-points">
          {points === null || !points.ok ? (
            <Unavailable what="Career Points" />
          ) : (
            <p className="text-sm">
              {points.data.points.total} points · {points.data.points.settled_predictions} settled ·{' '}
              {points.data.points.correct_outcomes} correct outcomes ·{' '}
              {points.data.points.exact_scores} exact scores · streak{' '}
              {points.data.points.current_streak} · {points.data.points.rules_version}
            </p>
          )}
        </Section>
      )}

      <Section title="Eligibility and grants" testId="member-contributor">
        {!contributor.ok ? (
          <Unavailable what="Eligibility and the grant" />
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              {contributor.data.eligibility.qualifies
                ? 'Meets the contributor requirements'
                : 'Does not meet the contributor requirements'}{' '}
              ({contributor.data.eligibility.rules_version})
            </p>
            {contributor.data.eligibility.shortfalls.length > 0 && (
              <ul className="list-disc ps-5">
                {contributor.data.eligibility.shortfalls.map((s) => (
                  <li key={s.requirement}>{s.message}</li>
                ))}
              </ul>
            )}
            {contributor.data.grant === null ? (
              <p className="text-muted">Has never held a contributor grant.</p>
            ) : (
              <Card className="flex flex-col gap-1">
                <p>
                  Grant {contributor.data.grant.standing}, given by @
                  {contributor.data.grant.granted_by} on{' '}
                  <When iso={contributor.data.grant.granted_at} />: {contributor.data.grant.reason}
                </p>
                {contributor.data.grant.history.map((event) => (
                  <p key={`${event.kind}-${event.at}`} className="text-muted">
                    {event.kind} by @{event.actor} on <When iso={event.at} />: {event.reason}
                  </p>
                ))}
              </Card>
            )}
            <p>
              <Link href={`/${locale}/admin/contributors`} className="underline">
                Grant, pause, resume or withdraw
              </Link>{' '}
              <span className="text-muted">(on the contributors page, with a reason, audited)</span>
            </p>
          </div>
        )}
      </Section>

      <Section title="Sanctions and flags" testId="member-sanctions">
        {!moderation.ok ? (
          <Unavailable what="The moderation history" />
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              {moderation.data.reports_about_them.length} open report
              {moderation.data.reports_about_them.length === 1 ? '' : 's'} about them ·{' '}
              {moderation.data.decisions.length} decision
              {moderation.data.decisions.length === 1 ? '' : 's'}
            </p>
            {moderation.data.sanctions.length === 0 ? (
              <p className="text-muted">No sanction, ever.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {moderation.data.sanctions.map((s) => (
                  <li key={s.id}>
                    {s.scope} sanction from <When iso={s.starts_at} />
                    {s.permanent ? ', permanent' : s.ends_at !== null ? ' to ' : ''}
                    {!s.permanent && s.ends_at !== null && <When iso={s.ends_at} />}
                    {s.active ? ' · in force' : ''}
                    {s.lifted_at !== null
                      ? ` · lifted by @${s.lifted_by ?? '?'}: ${s.lift_reason ?? ''}`
                      : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {theirFlags === null ? (
          <Unavailable what="The contributor flags" />
        ) : theirFlags.length === 0 ? (
          <p className="text-sm text-muted">No open contributor flag.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {theirFlags.map((flag) => (
              <li key={flag.id}>
                Flagged <When iso={flag.raised_at} />: below {flag.threshold} since{' '}
                <When iso={flag.below_since} /> (now {flag.rating_now ?? 'unrated'})
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          <Link
            href={`/${locale}/admin/moderation/${encodeURIComponent(user.username)}`}
            className="underline"
          >
            Moderation history, and lifting a sanction
          </Link>{' '}
          <span className="text-muted">(with a reason, audited)</span>
        </p>
      </Section>

      <Section title="Audit rows about this account" testId="member-audit">
        {!audit.ok ? (
          <Unavailable what="The audit log" />
        ) : (
          <AuditRows records={audit.data.records} />
        )}
      </Section>
    </main>
  );
}
