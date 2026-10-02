import {
  BROADCASTER_KINDS,
  VIEWING_ACCESS,
  type Broadcaster,
  type ViewingCompetition,
  type ViewingUpcomingResponse,
} from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { ViewingBulkForm, ViewingReasonForm } from '@/components/viewing-console-forms';
import { Button, Card, Notice, Select, TextField } from '@/components/ui';
import {
  addConsoleBroadcasterAction,
  addViewingDefaultAction,
  declareConsoleCoverageAction,
  removeConsoleListingAction,
  removeViewingDefaultAction,
} from '@/lib/viewing-console-actions';
import {
  ACCESS_LABEL,
  CONSOLE_DAYS_MAX,
  KIND_LABEL,
  consoleTime,
  coverageLabel,
  isCovered,
  matchLabel,
  type ConsoleQuery,
} from '@/lib/viewing-console';

/**
 * The Watch listings console (T-1361) over the desk's API (T-313, T-1360):
 * pick a territory and a competition; declare the season's coverage there;
 * keep the broadcasters; add and remove standing defaults; and list the next
 * days' matches in bulk, or take one listing down. Everything is a server
 * action; nothing is shown as listed that the API did not say is.
 */

const section = 'flex flex-col gap-3';

/** What the API said about the chosen competition's upcoming window. */
export type UpcomingView =
  | { state: 'none' }
  | { state: 'unknown' }
  | { state: 'failed'; message: string }
  | { state: 'shown'; data: ViewingUpcomingResponse };

function competitionOption(c: ViewingCompetition): string {
  const season = c.season === null ? 'no current season' : c.season.label;
  const defaults = c.defaults === 1 ? '1 default' : `${c.defaults} defaults`;
  return `${c.name} — ${season} · ${coverageLabel(c.coverage)} · ${defaults}`;
}

function Picker({
  locale,
  query,
  competitions,
}: {
  locale: string;
  query: ConsoleQuery;
  competitions: ViewingCompetition[];
}) {
  return (
    <form
      method="get"
      action={`/${locale}/admin/viewing`}
      className="flex flex-wrap items-end gap-3"
      data-testid="viewing-console-picker"
    >
      <TextField
        label="Territory"
        name="territory"
        size="sm"
        defaultValue={query.territory}
        hint="Two letters (ISO 3166-1)"
        maxLength={2}
        controlClassName="w-20"
      />
      <Select
        label="Competition"
        name="competition"
        size="sm"
        defaultValue={query.competition ?? ''}
        className="min-w-64 flex-1"
      >
        <option value="">Choose a competition</option>
        {competitions.map((c) => (
          <option key={c.id} value={c.id}>
            {competitionOption(c)}
          </option>
        ))}
      </Select>
      <TextField
        label="Days ahead"
        name="days"
        type="number"
        size="sm"
        min={1}
        max={CONSOLE_DAYS_MAX}
        defaultValue={query.days}
        controlClassName="w-20"
      />
      <Button type="submit" size="sm">
        Show
      </Button>
    </form>
  );
}

function Coverage({
  locale,
  territory,
  data,
}: {
  locale: string;
  territory: string;
  data: ViewingUpcomingResponse;
}) {
  return (
    <section className={section} data-testid="viewing-console-coverage">
      <h2 className="text-lg font-semibold">Coverage in {territory}</h2>
      {data.season === null ? (
        <p className="text-sm text-muted" data-testid="viewing-console-no-season">
          {data.competition.name} has no current season, so there is nothing to declare.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {data.season.label}: watching is{' '}
            <strong data-testid="viewing-console-coverage-state">
              {coverageLabel(data.coverage)}
            </strong>
            . Defaults and bulk listing need it covered or partly covered.
          </p>
          <ActionForm
            action={declareConsoleCoverageAction.bind(null, locale, data.season.id, territory)}
            fields={[
              {
                name: 'module',
                label: 'Module',
                type: 'select',
                options: [
                  { value: 'viewing', label: 'Where to watch' },
                  { value: 'highlights', label: 'Highlights' },
                ],
              },
              {
                name: 'state',
                label: 'State',
                type: 'select',
                options: [
                  { value: 'available', label: 'Covered' },
                  { value: 'limited', label: 'Partly covered' },
                  { value: 'not_supplied', label: 'Not covered' },
                ],
              },
              {
                name: 'note',
                label: 'Note',
                type: 'text',
                required: true,
                hint: 'Which public schedule this is based on. Recorded.',
              },
            ]}
            submitLabel="Declare"
            testId="viewing-console-coverage-form"
          />
        </>
      )}
    </section>
  );
}

function Defaults({
  locale,
  territory,
  data,
  broadcasters,
}: {
  locale: string;
  territory: string;
  data: ViewingUpcomingResponse;
  broadcasters: Broadcaster[];
}) {
  return (
    <section className={section} data-testid="viewing-console-defaults">
      <h2 className="text-lg font-semibold">Defaults</h2>
      <p className="text-sm text-muted">
        A default lists every match of {data.competition.name} in {territory} on one service, at one
        page. Removing it takes down its listings for matches not yet played.
      </p>
      {data.defaults.length === 0 ? (
        <p className="text-sm text-muted" data-testid="viewing-console-no-defaults">
          No default stands for this competition in {territory}.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.defaults.map((d) => (
            <Card
              as="li"
              key={d.id}
              padding="sm"
              className="flex flex-col gap-2 text-sm"
              data-testid={`viewing-default-${d.id}`}
            >
              <p>
                <span className="font-medium">
                  <bdi>{d.broadcaster.name}</bdi>
                </span>{' '}
                · {ACCESS_LABEL[d.access]} ·{' '}
                <a href={d.url} className="underline" rel="noreferrer" target="_blank">
                  {d.url}
                </a>
              </p>
              <p className="text-muted">
                {d.note} · {d.listings === 1 ? '1 listing' : `${d.listings} listings`} · since{' '}
                <time dateTime={d.created_at}>{consoleTime(d.created_at)}</time>
              </p>
              <ViewingReasonForm
                action={removeViewingDefaultAction.bind(null, locale, d.id)}
                submitLabel="Remove default"
                testId={`viewing-default-remove-${d.id}`}
              />
            </Card>
          ))}
        </ul>
      )}
      <h3 className="font-semibold">Add a default</h3>
      {!isCovered(data.coverage) ? (
        <Notice tone="info" data-testid="viewing-console-default-needs-coverage">
          A default needs this season declared covered in {territory} first.
        </Notice>
      ) : broadcasters.length === 0 ? (
        <p className="text-sm text-muted">Add a broadcaster first.</p>
      ) : (
        <ActionForm
          action={addViewingDefaultAction.bind(null, locale, data.competition.id, territory)}
          fields={[
            {
              name: 'broadcaster_id',
              label: 'Service',
              type: 'select',
              options: broadcasters.map((b) => ({ value: b.id, label: b.name })),
            },
            {
              name: 'access',
              label: 'Access',
              type: 'select',
              options: VIEWING_ACCESS.map((a) => ({ value: a, label: ACCESS_LABEL[a] })),
            },
            { name: 'url', label: 'Official page', type: 'url', required: true },
            {
              name: 'note',
              label: 'Note',
              type: 'text',
              required: true,
              hint: 'Which public schedule this is based on. Recorded.',
            },
          ]}
          submitLabel="Add default"
          testId="viewing-console-default-form"
        />
      )}
    </section>
  );
}

function Upcoming({
  locale,
  territory,
  data,
  broadcasters,
}: {
  locale: string;
  territory: string;
  data: ViewingUpcomingResponse;
  broadcasters: Broadcaster[];
}) {
  const listed = data.fixtures.flatMap((fixture) =>
    fixture.options.map((option) => ({ fixture, option })),
  );
  return (
    <section className={section} data-testid="viewing-console-upcoming">
      <h2 className="text-lg font-semibold">Next {data.days} days</h2>
      {data.fixtures.length === 0 ? (
        <p className="text-sm text-muted" data-testid="viewing-console-no-fixtures">
          No match of {data.competition.name} in the next {data.days} days.
        </p>
      ) : (
        <>
          {data.fixtures.some((f) => !f.covered) && (
            <p className="text-sm text-muted" data-testid="viewing-console-uncovered">
              A match whose season is not covered in {territory} cannot be ticked: declare coverage
              first.
            </p>
          )}
          <ViewingBulkForm
            locale={locale}
            territory={territory}
            fixtures={data.fixtures}
            broadcasters={broadcasters}
          />
        </>
      )}
      {listed.length > 0 && (
        <>
          <h3 className="font-semibold">Take a listing down</h3>
          <ul className="flex flex-col gap-3">
            {listed.map(({ fixture, option }) => (
              <Card
                as="li"
                key={option.id}
                id={`remove-${option.id}`}
                padding="sm"
                className="flex flex-col gap-2 text-sm"
              >
                <p>
                  <bdi>{matchLabel(fixture)}</bdi> · <bdi>{option.broadcaster.name}</bdi> ·{' '}
                  {ACCESS_LABEL[option.access]}
                  {option.from_default ? ' · from a default' : ''}
                </p>
                <ViewingReasonForm
                  action={removeConsoleListingAction.bind(null, locale, fixture.id, option.id)}
                  submitLabel="Remove listing"
                  testId={`viewing-listing-remove-${option.id}`}
                />
              </Card>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Broadcasters({
  locale,
  broadcasters,
}: {
  locale: string;
  broadcasters: Broadcaster[] | null;
}) {
  return (
    <section className={section} data-testid="viewing-console-broadcasters">
      <h2 className="text-lg font-semibold">Broadcasters</h2>
      {broadcasters === null ? (
        <Notice tone="danger">The broadcasters cannot be read right now.</Notice>
      ) : broadcasters.length === 0 ? (
        <p className="text-sm text-muted">No broadcaster yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {broadcasters.map((b) => (
            <li key={b.id}>
              <bdi>{b.name}</bdi> · {KIND_LABEL[b.kind]}
              {b.homepage_url !== null && (
                <>
                  {' · '}
                  <a href={b.homepage_url} className="underline" rel="noreferrer" target="_blank">
                    {b.homepage_url}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ActionForm
        action={addConsoleBroadcasterAction.bind(null, locale)}
        fields={[
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'homepage_url', label: 'Homepage', type: 'url' },
          {
            name: 'kind',
            label: 'Kind',
            type: 'select',
            options: BROADCASTER_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
          },
        ]}
        submitLabel="Add broadcaster"
        testId="viewing-console-broadcaster-form"
      />
    </section>
  );
}

export function ViewingConsole({
  locale,
  query,
  competitions,
  broadcasters,
  upcoming,
}: {
  locale: string;
  query: ConsoleQuery;
  competitions: ViewingCompetition[];
  broadcasters: Broadcaster[] | null;
  upcoming: UpcomingView;
}) {
  const known = broadcasters ?? [];
  return (
    <div className="flex flex-col gap-8" data-testid="viewing-console">
      <Picker locale={locale} query={query} competitions={competitions} />
      {upcoming.state === 'none' && (
        <p className="text-sm text-muted" data-testid="viewing-console-choose">
          Choose a competition to see its coverage, its defaults and its next matches in{' '}
          {query.territory}.
        </p>
      )}
      {upcoming.state === 'unknown' && (
        <Notice tone="warning" data-testid="viewing-console-unknown">
          That competition is not among the active ones.
        </Notice>
      )}
      {upcoming.state === 'failed' && (
        <Notice tone="danger" data-testid="viewing-console-failed">
          {upcoming.message}
        </Notice>
      )}
      {upcoming.state === 'shown' && (
        <>
          <Coverage locale={locale} territory={query.territory} data={upcoming.data} />
          <Defaults
            locale={locale}
            territory={query.territory}
            data={upcoming.data}
            broadcasters={known}
          />
          <Upcoming
            locale={locale}
            territory={query.territory}
            data={upcoming.data}
            broadcasters={known}
          />
        </>
      )}
      <Broadcasters locale={locale} broadcasters={broadcasters} />
    </div>
  );
}
