import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { COVERAGE_STATES } from '@fmip/contracts';
import { ActionForm, type Field } from '@/components/action-form';
import { setCoverageAction, setUserStatusAction } from '@/lib/admin-actions';
import { fetchAdminOverview, fetchAdminUsers, fetchAudit } from '@/lib/api';
import { moduleState } from '@/lib/match';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

// An operator's page: never indexed.
export const metadata: Metadata = {
  title: 'Administration · FMIP',
  robots: { index: false, follow: false },
};

const MODULES = [
  'scores',
  'incidents',
  'lineups',
  'statistics',
  'standings',
  'availability',
  'advanced_statistics',
];
const PROVIDERS = ['api_football', 'football_data_org', 'highlightly'];

/**
 * The minimal administration area (blueprint 16, T-070, D-046): coverage per
 * current season, live-data freshness, ingest failures, the rating rules in
 * force, member search, and the two audited actions — an account's status
 * and a season's declared coverage — each with a reason. The API decides who
 * is an administrator; this page only renders what it was allowed to fetch.
 */
export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const cookie = await sessionCookieHeader();
  const overview = await fetchAdminOverview(cookie);
  if (!overview.ok) {
    if (overview.status === 401) redirect(`/${locale}/login`);
    // Members without the role are not told the area exists.
    if (overview.status === 403) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Administration</h1>
        <p role="alert">The service is unreachable right now.</p>
      </main>
    );
  }
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q;
  const q = (rawQ ?? '').trim();
  const [users, audit] = await Promise.all([
    q.length >= 2 ? fetchAdminUsers(q, cookie) : Promise.resolve(null),
    fetchAudit(cookie),
  ]);
  const data = overview.data;
  const seasons = new Map<string, string>();
  for (const row of data.freshness)
    seasons.set(row.season.id, `${row.competition.name} ${row.season.label}`);
  for (const row of data.coverage)
    seasons.set(row.season.id, `${row.competition.name} ${row.season.label}`);

  const coverageFields: Field[] = [
    {
      name: 'season_id',
      label: 'Season',
      type: 'select',
      required: true,
      options: [...seasons].map(([id, label]) => ({ value: id, label })),
    },
    {
      name: 'module',
      label: 'Module',
      type: 'select',
      required: true,
      options: MODULES.map((m) => ({ value: m, label: m })),
    },
    {
      name: 'state',
      label: 'Declared state',
      type: 'select',
      required: true,
      options: COVERAGE_STATES.map((s) => ({ value: s, label: s })),
    },
    {
      name: 'provider',
      label: 'Provider',
      type: 'select',
      options: [{ value: '', label: 'none' }, ...PROVIDERS.map((p) => ({ value: p, label: p }))],
      hint: 'Available, limited or delayed data came from a provider: name it.',
    },
    {
      name: 'note',
      label: 'Note',
      hint: 'Shown to operators, e.g. "line-ups arrive ~45 min late".',
    },
    {
      name: 'reason',
      label: 'Reason for this change',
      required: true,
      hint: 'Recorded in the audit log with the previous value.',
    },
  ];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        Administration
      </h1>

      <section className="flex flex-col gap-2" data-testid="admin-ingestion">
        <h2 className="text-lg font-semibold">Ingestion</h2>
        <ul className="text-sm">
          <li>
            Last run:{' '}
            {data.ingestion.last_run === null
              ? 'none recorded'
              : `${data.ingestion.last_run.provider} ${data.ingestion.last_run.job} — ${data.ingestion.last_run.status} at ${data.ingestion.last_run.finished_at ?? data.ingestion.last_run.started_at}`}
          </li>
          <li>
            Last failure:{' '}
            {data.ingestion.last_failure === null
              ? 'none among recent runs'
              : `${data.ingestion.last_failure.provider} ${data.ingestion.last_failure.job} — ${data.ingestion.last_failure.error ?? data.ingestion.last_failure.status}`}
          </li>
          <li>Failed or partial in the last 24 h: {data.ingestion.failed_last_24h}</li>
          <li>Running now: {data.ingestion.running}</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2" data-testid="admin-freshness">
        <h2 className="text-lg font-semibold">Live-data freshness (current seasons)</h2>
        {data.freshness.length === 0 ? (
          <p className="text-sm opacity-70">No current season.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-current/20">
                  <th scope="col" className="py-1 pe-2 text-start">
                    Season
                  </th>
                  <th scope="col" className="py-1 pe-2 text-end">
                    Fixtures
                  </th>
                  <th scope="col" className="py-1 pe-2 text-end">
                    Live
                  </th>
                  <th scope="col" className="py-1 pe-2 text-end">
                    Live behind
                  </th>
                  <th scope="col" className="py-1 text-start">
                    Last change
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.freshness.map((row) => (
                  <tr key={row.season.id} className="border-b border-current/10">
                    <td className="py-1 pe-2">
                      {row.competition.name} {row.season.label}
                    </td>
                    <td className="py-1 pe-2 text-end tabular-nums">{row.fixtures}</td>
                    <td className="py-1 pe-2 text-end tabular-nums">{row.live}</td>
                    <td
                      className={`py-1 pe-2 text-end tabular-nums ${row.live_behind > 0 ? 'font-semibold' : ''}`}
                    >
                      {row.live_behind}
                    </td>
                    <td className="py-1">{row.last_change_at ?? 'none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="admin-coverage">
        <h2 className="text-lg font-semibold">Coverage (current seasons)</h2>
        {data.coverage.length === 0 ? (
          <p className="text-sm opacity-70">No coverage declared for any current season.</p>
        ) : (
          <ul className="text-sm">
            {data.coverage.map((row) => (
              <li key={`${row.season.id}:${row.module}`} data-testid="coverage-row">
                {row.competition.name} {row.season.label} · {row.module}:{' '}
                {moduleState({ coverage: row.state, last_updated_at: null, data: null })}
                {row.provider !== null ? ` (${row.provider})` : ''}
                {row.note !== null ? ` — ${row.note}` : ''}
              </li>
            ))}
          </ul>
        )}
        <h3 className="font-medium">Declare coverage</h3>
        <ActionForm
          action={setCoverageAction.bind(null, locale)}
          fields={coverageFields}
          submitLabel="Set coverage (audited)"
          testId="coverage-form"
        />
      </section>

      <section className="flex flex-col gap-2" data-testid="admin-rating">
        <h2 className="text-lg font-semibold">Rating configuration in force</h2>
        <p className="text-sm opacity-70">
          Read-only: a change is a new version in code (D-035, D-036), which keeps every stored
          rating explainable.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['formula', 'points', 'eligibility', 'leaderboard'] as const).map((key) => (
            <pre
              key={key}
              className="overflow-x-auto rounded border border-current/20 p-2 text-xs"
              data-testid={`rating-${key}`}
            >
              {JSON.stringify(data.rating[key], null, 2)}
            </pre>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" data-testid="admin-users">
        <h2 className="text-lg font-semibold">Members</h2>
        <form action={`/${locale}/admin`} method="get" role="search" className="flex gap-2">
          <label htmlFor="admin-user-search" className="sr-only">
            Search members
          </label>
          <input
            id="admin-user-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Username, e-mail or display name"
            className="grow rounded border border-current/30 bg-transparent px-3 py-2"
            data-testid="user-search"
          />
          <button type="submit" className="rounded border border-current/30 px-3 py-2">
            Search
          </button>
        </form>
        {users === null ? (
          <p className="text-sm opacity-70">Type at least two characters to search.</p>
        ) : !users.ok ? (
          <p role="alert" className="text-sm">
            The search could not be run right now.
          </p>
        ) : users.data.users.length === 0 ? (
          <p className="text-sm opacity-70">No member matches “{q}”.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-current/10">
            {users.data.users.map((user) => (
              <li key={user.id} className="flex flex-col gap-2 py-3" data-testid="admin-user">
                <p className="text-sm">
                  <span className="font-medium">@{user.username}</span> · {user.display_name} ·{' '}
                  {user.email}
                  {user.email_verified ? ' · verified' : ' · unverified'} · {user.status}
                  {user.roles.length > 0 ? ` · ${user.roles.join(', ')}` : ''}
                </p>
                <ActionForm
                  action={setUserStatusAction.bind(null, locale)}
                  fields={[
                    { name: 'user_id', type: 'hidden', label: 'Member id', defaultValue: user.id },
                    {
                      name: 'status',
                      label: 'Account status',
                      type: 'select',
                      defaultValue: user.status === 'suspended' ? 'active' : 'suspended',
                      options: [
                        { value: 'suspended', label: 'Suspend' },
                        { value: 'active', label: 'Reinstate' },
                      ],
                    },
                    { name: 'reason', label: 'Reason', required: true },
                  ]}
                  submitLabel="Apply (audited)"
                  testId={`status-form-${user.username}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="admin-audit">
        <h2 className="text-lg font-semibold">Audit log</h2>
        {!audit.ok ? (
          <p role="alert" className="text-sm">
            The audit log could not be read right now.
          </p>
        ) : audit.data.records.length === 0 ? (
          <p className="text-sm opacity-70">No administrative action recorded yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-current/10 text-sm">
            {audit.data.records.map((record) => (
              <li key={record.id} className="py-2" data-testid="audit-record">
                <time dateTime={record.created_at}>{record.created_at}</time> · @
                {record.actor.username} · {record.action} · {record.target_type} {record.target_id}{' '}
                — {record.reason}
                <span className="block text-xs opacity-70">
                  {JSON.stringify(record.previous)} → {JSON.stringify(record.next)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
