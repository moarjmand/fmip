import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import type { TeamSeasonCount, TeamSeasonStats, TeamSeasonStatsLine } from '@fmip/contracts';
import { Coverage, Panel } from '@/components/competition-page';
import { Stamp } from '@/components/stamp';
import { Translated } from '@/components/translated';
import { inlineTargetClasses } from '@/components/ui';
import { formatNumber, localDigits } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { say } from '@/lib/competition';
import {
  type FormResult,
  latestForm,
  minuteRows,
  scoreText,
  teamSeasonHref,
} from '@/lib/team-season-stats';

/**
 * The team page's season statistics (T-1437, D-228): one competition's
 * season as the provider counts it, chosen from the seasons it has, with
 * whose numbers they are and when they were fetched. Nothing is shown as a
 * figure that the provider did not give: a missing count is a dash, a season
 * never asked about or answered empty says so, and goals by minute and
 * penalties a shoot-out polluted are withheld with the reason (rule 3).
 */

const RESULT_KEY: Record<FormResult, MessageKey> = {
  W: 'matchCentre.form.won',
  D: 'matchCentre.form.drawn',
  L: 'matchCentre.form.lost',
};
const RESULT_TONE: Record<FormResult, string> = {
  W: 'bg-success text-canvas',
  D: 'bg-canvas text-fg',
  L: 'bg-danger text-canvas',
};

/** A figure, or a dash for one not supplied (explained under the panel). */
function Figure({ locale, value }: { locale: string; value: number | null }) {
  return value === null ? (
    <span className="text-muted" data-supplied="false">
      –
    </span>
  ) : (
    <span data-supplied="true">{formatNumber(locale, value)}</span>
  );
}

const TILES: readonly [MessageKey, keyof TeamSeasonStatsLine][] = [
  ['teamPage.seasonStats.played', 'played'],
  ['teamPage.seasonStats.wins', 'wins'],
  ['teamPage.seasonStats.draws', 'draws'],
  ['teamPage.seasonStats.losses', 'losses'],
  ['teamPage.seasonStats.goalsFor', 'goals_for'],
  ['teamPage.seasonStats.goalsAgainst', 'goals_against'],
  ['teamPage.seasonStats.cleanSheets', 'clean_sheets'],
  ['teamPage.seasonStats.failedToScore', 'failed_to_score'],
];

function Tile({
  locale,
  label,
  count,
}: {
  locale: string;
  label: MessageKey;
  count: TeamSeasonCount;
}) {
  const part = (n: number | null) => (n === null ? '–' : formatNumber(locale, n));
  return (
    <div
      className="flex flex-col gap-0.5 rounded border border-default p-2"
      data-testid="season-stat-tile"
    >
      <span className="text-xs text-muted">
        <Translated locale={locale} message={label} />
      </span>
      <span className="text-xl font-bold tabular-nums">
        <Figure locale={locale} value={count.total} />
      </span>
      <span className="text-xs text-muted tabular-nums">
        {say(locale, 'teamPage.seasonStats.homeAway', {
          home: part(count.home),
          away: part(count.away),
        })}
      </span>
    </div>
  );
}

function Heading({ locale, message }: { locale: string; message: MessageKey }) {
  return (
    <h3 className="text-sm font-bold">
      <Translated locale={locale} message={message} />
    </h3>
  );
}

function FormStrip({ locale, form }: { locale: string; form: string | null }) {
  const results = latestForm(form);
  if (results.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5" data-testid="season-stats-form">
      <Heading locale={locale} message="teamPage.seasonStats.form" />
      <ol className="flex flex-wrap gap-1">
        {results.map((r, i) => (
          <li
            key={i}
            className={`flex size-6 items-center justify-center rounded text-xs font-semibold ${RESULT_TONE[r]}`}
          >
            <Translated locale={locale} message={RESULT_KEY[r]} />
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">
        <Translated locale={locale} message="teamPage.seasonStats.formNote" />
      </p>
    </section>
  );
}

function ByMinute({
  locale,
  line,
  source,
}: {
  locale: string;
  line: TeamSeasonStatsLine;
  source: string;
}) {
  const rows = minuteRows(line.goals_for_by_minute, line.goals_against_by_minute);
  return (
    <section className="flex flex-col gap-1.5" data-testid="season-stats-minutes">
      <Heading locale={locale} message="teamPage.seasonStats.byMinute" />
      {line.bands_withheld ? (
        <p className="text-sm text-muted" data-testid="season-stats-withheld">
          {say(locale, 'teamPage.seasonStats.bandsWithheld', { source })}
        </p>
      ) : line.goals_for_by_minute === null && line.goals_against_by_minute === null ? (
        <p className="text-sm text-muted">
          {say(locale, 'teamPage.seasonStats.bandsNone', { source })}
        </p>
      ) : (
        <>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-strong text-xs text-muted">
                <th scope="col" className="py-1 pe-2 text-start font-bold">
                  <Translated locale={locale} message="teamPage.seasonStats.minutes" />
                </th>
                <th scope="col" className="py-1 pe-2 text-start font-bold">
                  <Translated locale={locale} message="teamPage.seasonStats.scored" />
                </th>
                <th scope="col" className="py-1 text-start font-bold">
                  <Translated locale={locale} message="teamPage.seasonStats.conceded" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.from}-${r.to}`}
                  className="border-b border-default last:border-b-0"
                  data-testid="season-stats-band"
                >
                  <th scope="row" className="py-1 pe-2 text-start font-normal text-muted">
                    <bdi>
                      {say(locale, 'teamPage.seasonStats.band', {
                        from: localDigits(locale, String(r.from)),
                        to: localDigits(locale, String(r.to)),
                      })}
                    </bdi>
                  </th>
                  <td className="w-[40%] py-1 pe-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 rounded bg-success"
                        style={{ inlineSize: `${r.scoredWidth}%` }}
                      />
                      {formatNumber(locale, r.scored)}
                    </span>
                  </td>
                  <td className="w-[40%] py-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 rounded bg-danger"
                        style={{ inlineSize: `${r.concededWidth}%` }}
                      />
                      {formatNumber(locale, r.conceded)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">
            {say(locale, 'teamPage.seasonStats.bandsNote', { source })}
          </p>
        </>
      )}
    </section>
  );
}

function Pairs({ locale, rows }: { locale: string; rows: [MessageKey, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">
            <Translated locale={locale} message={label} />
          </dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Result({ locale, text }: { locale: string; text: string | null }) {
  return text === null ? (
    <span className="text-muted">
      <Translated locale={locale} message="teamPage.seasonStats.noResult" />
    </span>
  ) : (
    <bdi>{text}</bdi>
  );
}

function Details({
  locale,
  line,
  source,
}: {
  locale: string;
  line: TeamSeasonStatsLine;
  source: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <section className="flex flex-col gap-1.5" data-testid="season-stats-biggest">
        <Heading locale={locale} message="teamPage.seasonStats.biggestWin" />
        <Pairs
          locale={locale}
          rows={[
            [
              'teamPage.seasonStats.atHome',
              <Result key="h" locale={locale} text={scoreText(locale, line.biggest_win.home)} />,
            ],
            [
              'teamPage.seasonStats.awayFrom',
              <Result key="a" locale={locale} text={scoreText(locale, line.biggest_win.away)} />,
            ],
          ]}
        />
        <Heading locale={locale} message="teamPage.seasonStats.biggestDefeat" />
        <Pairs
          locale={locale}
          rows={[
            [
              'teamPage.seasonStats.atHome',
              <Result key="h" locale={locale} text={scoreText(locale, line.biggest_defeat.home)} />,
            ],
            [
              'teamPage.seasonStats.awayFrom',
              <Result key="a" locale={locale} text={scoreText(locale, line.biggest_defeat.away)} />,
            ],
          ]}
        />
      </section>
      <section className="flex flex-col gap-1.5">
        <Heading locale={locale} message="teamPage.seasonStats.longestRuns" />
        <Pairs
          locale={locale}
          rows={[
            [
              'teamPage.seasonStats.runWins',
              <Figure key="w" locale={locale} value={line.longest_run.wins} />,
            ],
            [
              'teamPage.seasonStats.runDraws',
              <Figure key="d" locale={locale} value={line.longest_run.draws} />,
            ],
            [
              'teamPage.seasonStats.runLosses',
              <Figure key="l" locale={locale} value={line.longest_run.losses} />,
            ],
          ]}
        />
        {!line.bands_withheld && (
          <>
            <Heading locale={locale} message="teamPage.seasonStats.penalties" />
            <Pairs
              locale={locale}
              rows={[
                [
                  'teamPage.seasonStats.penaltiesScored',
                  <Figure key="s" locale={locale} value={line.penalties.scored} />,
                ],
                [
                  'teamPage.seasonStats.penaltiesMissed',
                  <Figure key="m" locale={locale} value={line.penalties.missed} />,
                ],
              ]}
            />
          </>
        )}
      </section>
      <section
        className="flex flex-col gap-1.5 sm:col-span-2"
        data-testid="season-stats-formations"
      >
        <Heading locale={locale} message="teamPage.seasonStats.formations" />
        {line.formations.length === 0 ? (
          <p className="text-sm text-muted">
            {say(locale, 'teamPage.seasonStats.noFormations', { source })}
          </p>
        ) : (
          <table className="w-full max-w-sm text-sm tabular-nums">
            <thead>
              <tr className="border-b border-strong text-xs text-muted">
                <th scope="col" className="py-1 pe-2 text-start font-bold">
                  <Translated locale={locale} message="teamPage.seasonStats.formation" />
                </th>
                <th scope="col" className="py-1 text-end font-bold">
                  <Translated locale={locale} message="teamPage.seasonStats.matches" />
                </th>
              </tr>
            </thead>
            <tbody>
              {line.formations.map((f) => (
                <tr key={f.formation} className="border-b border-default last:border-b-0">
                  <td className="py-1 pe-2">
                    <bdi dir="ltr">{localDigits(locale, f.formation)}</bdi>
                  </td>
                  <td className="py-1 text-end">{formatNumber(locale, f.played)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function TeamSeasonStatsPanel({
  data,
  teamId,
  locale,
  timeZone,
}: {
  data: TeamSeasonStats;
  teamId: string;
  locale: string;
  timeZone: string;
}) {
  const source = data.source_name;
  const line = data.stats.data;
  const choiceName = (c: NonNullable<TeamSeasonStats['selected']>) =>
    say(locale, 'teamPage.seasonStats.option', {
      competition: c.competition.short_name ?? c.competition.name,
      season: localDigits(locale, c.label),
    });
  const listed =
    data.selected !== null && data.seasons.some((s) => s.season_id === data.selected?.season_id);
  return (
    <Panel
      testId="season-stats"
      title={say(locale, 'teamPage.seasonStats.title', { source })}
      aside={<Coverage locale={locale} state={data.stats.coverage} />}
    >
      <p className="text-sm text-muted">{say(locale, 'teamPage.seasonStats.note', { source })}</p>
      {(data.seasons.length > 1 ||
        (data.selected !== null && !listed && data.seasons.length > 0)) && (
        <nav aria-label={say(locale, 'teamPage.seasonStats.seasons')}>
          <ul className="flex flex-wrap gap-1.5 text-sm">
            {data.seasons.map((s) => {
              const current = s.season_id === data.selected?.season_id;
              return (
                <li key={s.season_id}>
                  <Link
                    href={teamSeasonHref(locale, teamId, s.season_id)}
                    aria-current={current ? 'page' : undefined}
                    className={inlineTargetClasses(
                      `rounded-full border px-2.5 py-0.5 ${current ? 'border-strong font-bold' : 'border-default text-muted hover:underline'}`,
                    )}
                    data-testid="season-stats-choice"
                  >
                    {choiceName(s)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {data.selected === null ? (
        <p className="text-sm text-muted" data-testid="season-stats-empty">
          <Translated locale={locale} message="teamPage.seasonStats.noSeason" />
        </p>
      ) : (
        <>
          <h3 className="text-base font-bold" data-testid="season-stats-selected">
            {choiceName(data.selected)}
          </h3>
          {line === null ? (
            <p className="text-sm text-muted" data-testid="season-stats-empty">
              {say(
                locale,
                data.asked ? 'teamPage.seasonStats.none' : 'teamPage.seasonStats.notAsked',
                {
                  source,
                },
              )}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TILES.map(([label, key]) => (
                  <Tile
                    key={key}
                    locale={locale}
                    label={label}
                    count={line[key] as TeamSeasonCount}
                  />
                ))}
              </div>
              <FormStrip locale={locale} form={line.form} />
              <ByMinute locale={locale} line={line} source={source} />
              <Details locale={locale} line={line} source={source} />
              <p className="text-xs text-muted">
                {say(locale, 'teamPage.seasonStats.dash', { source })}
              </p>
            </>
          )}
        </>
      )}
      {data.stats.last_updated_at !== null && (
        <p className="text-xs text-muted" data-testid="season-stats-fetched">
          {say(locale, 'playerPage.provider.fetched', { source })}{' '}
          <Stamp iso={data.stats.last_updated_at} locale={locale} timeZone={timeZone} />
        </p>
      )}
    </Panel>
  );
}
