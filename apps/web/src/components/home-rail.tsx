import type {
  CompetitionTable,
  CoverageState,
  FounderAnalysisSummary,
  ModelUpsetResponse,
  NewsStoryCard,
  TeamPage,
  TeamPageFixture,
} from '@fmip/contracts';
import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import { EntityImage } from '@/components/entity-image';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { LinkedSentence } from '@/components/linked-sentence';
import { RuleHeading, zoneName } from '@/components/home-front';
import { MessageText } from '@/components/message-text';
import { NewsCardImage, NewsImageCredit, drawableNewsImage } from '@/components/news-image';
import { CommunityVoice, FounderVoice } from '@/components/voices';
import { Score } from '@/components/score';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { ButtonLink, CoverageBadge, Icon, LinkOut } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import {
  formatDate,
  formatGregorianMonth,
  formatNumber,
  formatVersionStamp,
  localDigits,
} from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type MessageKey, interpolate, message, t } from '@/i18n/messages';
import { kindLabel } from '@/lib/forecast';
import { type AccuracyFigure, type HomeBroadcasts, HOME_TABLE_ROWS } from '@/lib/home';
import { STORY_TYPE_KEY, VERSION_STATUS_KEY, storyHref, versionStatus } from '@/lib/news';
import { formatKickoff } from '@/lib/scores';
import { fromTeamSide } from '@/lib/team';
import { formatFixed, formatPercent, formatSigned } from '@/lib/words';
import { ModelVersion } from '@/components/model-version';

/**
 * The homepage's side column and its news in the Hybrid design (T-1382,
 * D-200; boards h1 and h9): the league table's top five, the model's
 * accuracy, today's broadcasts, the member's teams, the founder's column and
 * the call to pick, and the news. On a phone the column stacks under the
 * main one, in the same order. Server components only.
 */

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);
const MORE = 'inline-flex min-h-touch items-center gap-1.5 text-sm font-bold text-accent';

/** The side column's card: a surface with the hairline, as the canvas draws every block. */
const CARD = 'flex flex-col gap-3 rounded-tile border border-default bg-surface p-4.5';
/** The canvas's small saffron kicker over a card. */
const KICKER = 'text-xs font-extrabold tracking-widest text-live uppercase';

/**
 * The model's tag: turquoise and mono, outlined on the surface rather than on
 * its own tint, where the Day turquoise falls to 4.2:1 (as D-263 found for the
 * lanes).
 */
function ModelTag({ locale }: { locale: Locale }) {
  return (
    <span className="rounded-control border border-model px-2 py-0.5 font-mono text-xs font-semibold text-model uppercase [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
      <Translated locale={locale} message="home.modelTag" />
    </span>
  );
}

const OUTCOMES = ['home', 'draw', 'away'] as const;

/**
 * "Forecast against reality" (T-1516, D-265, D-270): the day's finished match
 * whose result the model's last pre-kick-off version rated least likely,
 * among competitions with full coverage. The score, the three probabilities
 * as a bar with what happened in saffron, the share the model gave it, the
 * version it was, and the way to the match. No answer, and no such match,
 * are each said (rule 3); the card is never an empty frame.
 */
export function UpsetCard({
  answer,
  placement,
  locale,
  timeZone,
}: {
  /** `null`: the API did not answer. */
  answer: ModelUpsetResponse | null;
  /** Where on the page this copy sits: after the hero on a phone, in the side column on a desktop. */
  placement: 'main' | 'side';
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const upset = answer?.upset ?? null;
  const state = answer === null ? 'unreachable' : answer.coverage;
  const finished = answer?.finished_matches ?? 0;
  return (
    <section
      aria-labelledby={`home-upset-${placement}`}
      className={cx(CARD, placement === 'main' ? 'lg:hidden' : 'hidden lg:flex')}
      data-testid="home-upset"
      data-placement={placement}
      data-state={state}
    >
      <h2 id={`home-upset-${placement}`} className={KICKER}>
        <Translated locale={l} message="home.upset.title" />
      </h2>
      {answer === null || upset === null ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {answer !== null && (
            <CoverageBadge
              state="not_supplied"
              label={<Translated locale={l} message={COVERAGE_KEY.not_supplied} />}
            />
          )}
          <Translated
            locale={l}
            message={
              answer === null
                ? 'home.upset.unreachable'
                : answer.reason === 'no_covered_forecast'
                  ? 'home.upset.noForecast'
                  : 'home.upset.noFinished'
            }
          />
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-x-2.5 text-lg font-bold font-stretch-semi-condensed">
            <bdi>{upset.home_team.short_name ?? upset.home_team.name}</bdi>
            <Score
              home={upset.score.home}
              away={upset.score.away}
              locale={l}
              className="text-2xl font-extrabold font-stretch-condensed"
              testId="home-upset-score"
            />
            <bdi>{upset.away_team.short_name ?? upset.away_team.name}</bdi>
          </p>
          <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-pill">
            {OUTCOMES.map((outcome) => (
              <span
                key={outcome}
                data-outcome={outcome}
                data-happened={outcome === upset.outcome ? '' : undefined}
                className={cx(
                  outcome === upset.outcome
                    ? 'bg-accent'
                    : outcome === 'draw'
                      ? 'bg-model/55'
                      : 'bg-model/25',
                )}
                style={{
                  flexGrow: Math.max(upset.probabilities[outcome] * 100, 1.5),
                  flexBasis: 0,
                }}
              />
            ))}
          </div>
          <p className="text-sm leading-relaxed text-muted" data-testid="home-upset-gave">
            <MessageText
              message={{
                ...message(l, upset.outcome === 'draw' ? 'home.upset.gaveDraw' : 'home.upset.gave'),
                text: interpolate(
                  t(l, upset.outcome === 'draw' ? 'home.upset.gaveDraw' : 'home.upset.gave'),
                  {
                    team:
                      upset.outcome === 'away'
                        ? (upset.away_team.short_name ?? upset.away_team.name)
                        : (upset.home_team.short_name ?? upset.home_team.name),
                    pct: formatPercent(l, upset.probability * 100, 0),
                  },
                ),
              }}
            />{' '}
            <Translated locale={l} message="home.upset.among" count={finished} />
          </p>
          <p className="flex flex-wrap gap-x-2 font-mono text-xs text-model [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
            <span dir="ltr">
              <ModelVersion version={upset.forecast.model_version} />
            </span>
            <span>
              {interpolate(t(l, 'home.upset.version'), {
                version: formatNumber(l, upset.forecast.version_number),
                kind: kindLabel(upset.forecast.kind, l),
                time: `${formatVersionStamp(l, upset.forecast.computed_at, timeZone)} ${zoneName(l, timeZone)}`,
              })}
            </span>
          </p>
          <Link href={`/${locale}/match/${upset.fixture_id}`} className={MORE}>
            <Translated locale={l} message="home.upset.link" />
            <Icon name="forward" />
          </Link>
        </>
      )}
    </section>
  );
}

/**
 * The table excerpt (T-1516): the first competition's top six with its
 * season, coverage and when it was last updated (rule 4), each club opening
 * its page, and the way to the whole table.
 */
export function TableExcerpt({
  page,
  locale,
  timeZone,
}: {
  page: CompetitionTable;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const rows = (page.table.data ?? []).slice(0, HOME_TABLE_ROWS);
  const name =
    page.competition.localised_name ?? page.competition.short_name ?? page.competition.name;
  const n = (value: number) => formatNumber(l, value);
  const state: CoverageState = page.table.coverage;
  const updated = page.table.last_updated_at;
  const head = 'pb-2 text-xs font-semibold text-caption';
  const column = (short: MessageKey, long: MessageKey) => (
    <abbr title={t(l, long)} className="no-underline">
      <Translated locale={l} message={short} />
    </abbr>
  );
  return (
    <section
      aria-labelledby="home-table-title"
      data-testid="home-table"
      className="overflow-hidden rounded-tile border border-default bg-surface"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-default px-4 py-3.5">
        <EntityImage media={page.competition.logo} kind="logo" name={name} size={20} />
        <h2 id="home-table-title" className="text-sm font-extrabold">
          <bdi>{name}</bdi>
        </h2>
        <span className="text-xs text-caption">
          <bdi>{localDigits(l, page.season.label)}</bdi>
        </span>
        <CoverageBadge
          state={state}
          label={<Translated locale={l} message={COVERAGE_KEY[state]} />}
        />
        {updated !== null && (
          <span
            className="ms-auto font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
            data-testid="home-table-updated"
          >
            <MessageText
              message={{
                ...message(l, 'home.live.updated'),
                text: interpolate(t(l, 'home.live.updated'), {
                  time: `${formatDate(l, updated, timeZone, { day: 'numeric', month: 'short' })} ${formatKickoff(l, updated, timeZone)}`,
                }),
              }}
            />
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">
          <Translated locale={l} message="home.table.none" />
        </p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">
            <MessageText
              message={{
                ...message(l, 'home.table.caption'),
                text: interpolate(t(l, 'home.table.caption'), { competition: name }),
              }}
            />
          </caption>
          <thead>
            <tr>
              <th scope="col" className={cx(head, 'w-10 ps-4 pt-2.5 text-start')}>
                #
              </th>
              <th scope="col" className={cx(head, 'pt-2.5 text-start')}>
                <Translated locale={l} message="home.table.team" />
              </th>
              <th scope="col" className={cx(head, 'w-8 pt-2.5 text-end')}>
                {column('competitionPage.col.played', 'competitionPage.col.playedTitle')}
              </th>
              <th scope="col" className={cx(head, 'w-12 pt-2.5 text-end')}>
                {column(
                  'competitionPage.col.goalDifference',
                  'competitionPage.col.goalDifferenceTitle',
                )}
              </th>
              <th scope="col" className={cx(head, 'w-12 pe-4 pt-2.5 text-end')}>
                {column('competitionPage.col.points', 'competitionPage.col.pointsTitle')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.team.id} className="border-t border-default">
                <td className="py-2 ps-4 text-caption">{n(row.position)}</td>
                <td>
                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                    <EntityImage
                      media={row.team.crest}
                      kind="crest"
                      name={row.team.name}
                      size={20}
                    />
                    {/* Each club opens its page, as on the full table (T-1479). */}
                    {/* T-1541: the link is the row's height, 44px, a phone's touch target. */}
                    <Link
                      href={`/${l}/team/${row.team.id}`}
                      className="inline-flex min-h-touch min-w-0 items-center hover:underline"
                    >
                      <bdi>{row.team.name}</bdi>
                    </Link>
                  </span>
                </td>
                <td className="py-2 text-end text-muted">{n(row.played)}</td>
                <td className="py-2 text-end text-muted">
                  {/* The sign stays before the digits; the cell keeps the page's alignment. */}
                  <span dir="ltr">{formatSigned(l, row.goal_difference, 0)}</span>
                </td>
                <td className="py-2 pe-4 text-end font-extrabold">{n(row.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link
        href={`/${locale}/competition/${page.competition.id}`}
        className={cx(MORE, 'border-t border-default px-4')}
      >
        <Translated locale={l} message="home.table.full" />
        <Icon name="forward" />
      </Link>
    </section>
  );
}

/**
 * The model's month in figures (T-1369, D-187; T-1516, D-270): the newest
 * month with a match scored, named; how often its favourite won and on how
 * many matches; how much better its ranked probability score was than a
 * blind three-way guess on the same matches, with both scores; the same
 * share per competition, the most accurate first; and, when any of those is
 * below the minimum, that it is too few to call (rule 3). The versions it is
 * from and when it was last updated close it.
 */
export function MonthFigures({
  figure,
  reachable,
  locale,
  timeZone,
}: {
  figure: AccuracyFigure | null;
  reachable: boolean;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const m = figure?.metrics ?? null;
  const skill =
    m !== null && m.rps !== null && m.uniform_rps !== null && m.uniform_rps > 0
      ? (1 - m.rps / m.uniform_rps) * 100
      : null;
  const limited =
    figure !== null &&
    (figure.metrics.coverage === 'limited' ||
      figure.competitions.some((c) => c.metrics.coverage === 'limited'));
  return (
    <section
      aria-labelledby="home-accuracy-title"
      className={CARD}
      data-testid="home-accuracy"
      data-state={
        !reachable ? 'unreachable' : figure === null ? 'not_supplied' : figure.metrics.coverage
      }
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <ModelTag locale={l} />
        <h2 id="home-accuracy-title" className="text-sm font-extrabold">
          {figure === null ? (
            <Translated locale={l} message="home.accuracy.heading" />
          ) : (
            <MessageText
              message={{
                ...message(l, 'home.month.title'),
                text: interpolate(t(l, 'home.month.title'), {
                  month: formatGregorianMonth(l, figure.period),
                }),
              }}
            />
          )}
        </h2>
      </div>
      {!reachable ? (
        <p className="text-sm text-muted">
          <Translated locale={l} message="home.accuracy.unreachable" />
        </p>
      ) : figure === null || m === null || m.accuracy === null ? (
        <p className="text-sm text-muted">
          <Translated locale={l} message="modelAccuracy.notSupplied" />
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <p className="flex flex-col gap-0.5" data-testid="home-month-favourite">
              <b className="text-display-1 leading-none font-extrabold font-stretch-condensed tabular-nums">
                {formatPercent(l, m.accuracy * 100)}
              </b>
              <span className="text-xs text-caption">
                <Translated locale={l} message="home.month.favourite" count={m.matches} />
              </span>
            </p>
            {skill !== null && m.rps !== null && m.uniform_rps !== null && (
              <p className="flex flex-col gap-0.5" data-testid="home-month-skill">
                <b className="text-display-1 leading-none font-extrabold font-stretch-condensed text-model tabular-nums">
                  {formatPercent(l, Math.abs(skill), 0)}
                </b>
                <span className="text-xs text-caption">
                  {interpolate(t(l, skill >= 0 ? 'home.month.better' : 'home.month.worse'), {
                    rps: formatFixed(l, m.rps, 3),
                    uniform: formatFixed(l, m.uniform_rps, 3),
                  })}
                </span>
              </p>
            )}
          </div>
          {figure.competitions.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm tabular-nums">
              {figure.competitions.map((c) => {
                // T-1540: how many matches each share is on, and one under the
                // minimum dimmed and named, so it never reads as a full figure.
                const thin = c.metrics.coverage === 'limited';
                return (
                  <li
                    key={c.id}
                    className="grid grid-cols-[minmax(0,1fr)_5.5rem_3.25rem] items-center gap-2.5"
                    data-testid="home-month-league"
                    data-coverage={c.metrics.coverage}
                  >
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <bdi className="truncate">{c.name}</bdi>
                      <span className="shrink-0 text-xs text-caption">
                        <Translated
                          locale={l}
                          message="home.month.leagueMatches"
                          count={c.metrics.matches}
                        />
                        {thin && (
                          <span className="sr-only">
                            {' '}
                            <Translated locale={l} message="status.coverage.limited" />
                          </span>
                        )}
                      </span>
                    </span>
                    <span aria-hidden="true" className="h-1.5 rounded-pill bg-surface-raised">
                      <span
                        className={cx(
                          'block h-1.5 rounded-pill',
                          thin ? 'bg-model/40' : 'bg-model',
                        )}
                        style={{ inlineSize: `${(c.metrics.accuracy ?? 0) * 100}%` }}
                      />
                    </span>
                    <span className={cx('text-end', thin && 'text-caption')}>
                      {formatPercent(l, (c.metrics.accuracy ?? 0) * 100)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {limited && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-caption">
              <CoverageBadge
                state="limited"
                label={<Translated locale={l} message="status.coverage.limited" />}
              />
              {interpolate(t(l, 'home.month.limited'), {
                minimum: formatNumber(l, figure.minimumMatches),
              })}
            </p>
          )}
          <p className="flex flex-wrap gap-x-2 font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
            {/* Named (T-1479): two bare version strings read as noise. */}
            {figure.modelVersions.length > 0 && (
              <span className="font-sans">
                <Translated locale={l} message="home.accuracy.versions" />
              </span>
            )}
            {figure.modelVersions.map((version) => (
              <span key={version} dir="ltr" className="text-model">
                <ModelVersion version={version} />
              </span>
            ))}
            {figure.lastUpdatedAt !== null && (
              <MessageText
                message={{
                  ...message(l, 'home.accuracy.updated'),
                  text: interpolate(t(l, 'home.accuracy.updated'), {
                    date: formatDate(l, figure.lastUpdatedAt, timeZone, {
                      day: 'numeric',
                      month: 'short',
                    }),
                  }),
                }}
              />
            )}
          </p>
        </>
      )}
      <Link href={`/${locale}/model-accuracy`} className={MORE}>
        <Translated locale={l} message="home.month.link" />
        <Icon name="forward" />
      </Link>
    </section>
  );
}

/**
 * Today's live broadcasts (D-200): per match still to come or in play, who
 * shows it in the reader's territory, each a link-out naming its host; the
 * listings' sources and when they were last checked under the list (rule 4).
 */
export function Broadcasts({
  broadcasts,
  locale,
  timeZone,
}: {
  broadcasts: HomeBroadcasts;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  const say = (key: 'home.watch.none' | 'home.watch.notSupplied', territory: string) => (
    <MessageText message={{ ...message(l, key), text: interpolate(t(l, key), { territory }) }} />
  );
  return (
    <section
      aria-labelledby="home-watch-title"
      data-testid="home-broadcasts"
      data-state={broadcasts.state}
    >
      <RuleHeading
        id="home-watch-title"
        title={<Translated locale={l} message="home.watch.title" />}
        aside={zoneName(l, timeZone)}
      />
      {broadcasts.state === 'unreachable' ? (
        <p className="text-sm text-muted" data-testid="home-viewing-unreachable">
          <Translated locale={l} message="home.watch.unreachable" />
        </p>
      ) : broadcasts.state === 'ask' ? (
        // Once for the list, not the same question on every line (D-115).
        <p className="text-sm" data-testid="home-viewing-ask">
          <LinkedSentence
            sentence={message(l, 'home.watch.ask')}
            link={message(l, 'viewing.choose')}
            href={`/${locale}/watch`}
          />
        </p>
      ) : broadcasts.state === 'none' ? (
        <p className="text-sm text-muted">
          {say(
            broadcasts.supplied ? 'home.watch.none' : 'home.watch.notSupplied',
            broadcasts.territory,
          )}
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {broadcasts.rows.map(({ card, options }) => (
              <li
                key={card.id}
                className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2.5 border-b border-default py-1.5"
              >
                <span className="pt-1.5 font-mono [:root:is(:lang(fa),:lang(ar))_&]:font-sans text-xs text-caption">
                  {formatKickoff(l, card.kickoff_at, timeZone)}
                </span>
                <span className="min-w-0">
                  <Link
                    href={`/${locale}/match/${card.id}`}
                    className="inline-flex min-h-8 items-center text-sm font-semibold hover:underline"
                  >
                    <bdi>{card.home.name}</bdi>&nbsp;
                    <Translated locale={l} message="home.versus" />
                    &nbsp;<bdi>{card.away.name}</bdi>
                  </Link>
                  <span className="flex flex-wrap items-center gap-x-3">
                    <span className="text-xs text-caption">
                      <Translated locale={l} message="scores.card.watch" />
                    </span>
                    {options.map((option) => (
                      <LinkOut
                        key={option.id}
                        href={option.url}
                        host={option.broadcaster.name}
                        className="text-sm text-accent"
                      />
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p
            className="mt-2 flex items-center gap-1.5 text-xs text-caption"
            data-testid="home-broadcasts-checked"
          >
            <Icon name="clock" size={14} />
            <MessageText
              message={{
                ...message(l, 'home.watch.sources'),
                text: interpolate(t(l, 'home.watch.sources'), {
                  sources: broadcasts.sources.join(', '),
                  territory: broadcasts.territory,
                  time:
                    broadcasts.checkedAt === null
                      ? '—'
                      : `${formatDate(l, broadcasts.checkedAt, timeZone, { day: 'numeric', month: 'short' })} ${formatKickoff(l, broadcasts.checkedAt, timeZone)}`,
                }),
              }}
            />
          </p>
        </>
      )}
    </section>
  );
}

/** "Next · v Esteghlal · today 17:00 · match centre" and "Last · W 2–1 v Mes · 2 Oct". */
function TeamLine({
  kind,
  fixture,
  teamId,
  locale,
  timeZone,
}: {
  kind: 'next' | 'last';
  fixture: TeamPageFixture | null;
  teamId: string;
  locale: Locale;
  timeZone: string;
}) {
  const label = (
    <b className="text-fg">
      <Translated
        locale={locale}
        message={kind === 'next' ? 'home.teams.next' : 'home.teams.last'}
      />
    </b>
  );
  if (fixture === null) {
    return (
      <span className="block text-sm text-muted">
        {label} ·{' '}
        <Translated
          locale={locale}
          message={kind === 'next' ? 'home.teams.noNext' : 'home.teams.noLast'}
        />
      </span>
    );
  }
  const side = fromTeamSide(fixture, teamId);
  const when = `${formatDate(locale, fixture.kickoff_at, timeZone, { day: 'numeric', month: 'short' })} ${formatKickoff(locale, fixture.kickoff_at, timeZone)}`;
  return (
    <span className="block text-sm text-muted" data-testid={`home-team-${kind}`}>
      {label} ·{' '}
      {kind === 'last' && side.result !== null && fixture.score !== null && (
        <>
          <b className="text-fg">
            <Translated
              locale={locale}
              message={
                side.result === 'W'
                  ? 'matchCentre.form.won'
                  : side.result === 'D'
                    ? 'matchCentre.form.drawn'
                    : 'matchCentre.form.lost'
              }
            />
          </b>{' '}
          <Score
            home={side.home ? fixture.score.home : fixture.score.away}
            away={side.home ? fixture.score.away : fixture.score.home}
            locale={locale}
          />{' '}
        </>
      )}
      <Translated locale={locale} message={side.home ? 'teamPage.home' : 'teamPage.away'} />{' '}
      <bdi>{side.opponent}</bdi> · <time dateTime={fixture.kickoff_at}>{when}</time> ·{' '}
      <Link href={`/${locale}/match/${fixture.id}`} className="underline">
        <Translated locale={locale} message="home.teams.matchCentre" />
      </Link>
    </span>
  );
}

/**
 * "My teams" for a member (D-200): each followed team's next match and last
 * result, from the team's own page; a team whose page did not answer says so.
 */
export function MyTeams({
  teams,
  followsNone,
  locale,
  timeZone,
}: {
  teams: { id: string; name: string; page: TeamPage | null }[] | null;
  /** The member follows no team: a sentence and the way to follow one. */
  followsNone: boolean;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  return (
    <section aria-labelledby="home-teams-title" data-testid="home-my-teams">
      <RuleHeading
        id="home-teams-title"
        title={<Translated locale={l} message="home.teams.title" />}
      />
      {teams === null ? (
        <p className="text-sm text-muted">
          <Translated locale={l} message="home.teams.unreachable" />
        </p>
      ) : followsNone ? (
        <p className="text-sm text-muted">
          <Translated locale={l} message="home.teams.none" />
        </p>
      ) : (
        <ul className="flex flex-col">
          {teams.map(({ id, name, page }) => (
            <li
              key={id}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-2.5 border-b border-default py-2.5"
            >
              {page?.team.crest !== undefined ? (
                <EntityImage media={page.team.crest} kind="crest" name={name} size={22} />
              ) : (
                <span aria-hidden="true" className="size-7 rounded-full bg-surface-raised" />
              )}
              <span className="min-w-0">
                <Link
                  href={`/${locale}/team/${id}`}
                  className="text-base font-bold hover:underline"
                >
                  <bdi>{page?.team.localised_name ?? name}</bdi>
                </Link>
                {page === null ? (
                  <span className="block text-sm text-muted">
                    <Translated locale={l} message="home.teams.pageUnreachable" />
                  </span>
                ) : (
                  <>
                    <TeamLine
                      kind="next"
                      fixture={page.next_match}
                      teamId={id}
                      locale={l}
                      timeZone={timeZone}
                    />
                    <TeamLine
                      kind="last"
                      fixture={page.previous_match}
                      teamId={id}
                      locale={l}
                      timeZone={timeZone}
                    />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap gap-x-4">
        <Link href={`/${locale}/following`} className={MORE}>
          <Translated locale={l} message="home.teams.manage" />
          <Icon name="forward" />
        </Link>
      </p>
    </section>
  );
}

/**
 * The founder's column and the call to pick, side by side under the key
 * matches (board h1): the founder's upcoming analyses in their lane, and the
 * community's lane saying how the spread works with the way to the picks.
 * Two products, two lanes, two components (rule 6).
 */
export function ColumnAndPicks({
  analyses,
  locale,
  timeZone,
}: {
  analyses: FounderAnalysisSummary[] | null;
  locale: string;
  /** The reader's zone, for each analysed match's kick-off (T-1542). */
  timeZone: string;
}) {
  const l = asLocale(locale);
  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <FounderVoice locale={l}>
        {analyses === null || analyses.length === 0 ? (
          <p className="text-sm text-muted" data-testid="home-founder-none">
            <Translated locale={l} message="home.founder.none" />
          </p>
        ) : (
          <FounderAnalysisFeed
            analyses={analyses}
            locale={locale}
            timeZone={timeZone}
            heading={<Translated locale={l} message="home.founder.heading" />}
          />
        )}
      </FounderVoice>
      <CommunityVoice locale={l}>
        <p className="text-sm text-muted">
          <Translated locale={l} message="home.community.body" />
        </p>
        <ButtonLink
          href={`/${locale}/predictions`}
          variant="secondary"
          size="md"
          className="self-start"
        >
          <Translated locale={l} message="home.community.cta" />
        </ButtonLink>
      </CommunityVoice>
    </div>
  );
}

/**
 * The news (blueprint 3, D-061, D-177): licensed sources, each credited by
 * name, the photo with its credit and licence where the licence covers it,
 * whose words a version is, and a line when the feeds are behind (rule 4).
 */
export function NewsGrid({
  stories,
  stale,
  locale,
  timeZone,
}: {
  stories: NewsStoryCard[];
  stale: boolean;
  locale: string;
  timeZone: string;
}) {
  const l = asLocale(locale);
  return (
    <section aria-labelledby="home-news-title" data-testid="home-news">
      <RuleHeading
        id="home-news-title"
        size="lg"
        title={<Translated locale={l} message="home.news.title" />}
        aside={<Translated locale={l} message="home.news.credited" />}
      />
      {stale && (
        <p className="mb-3 text-sm text-warning" data-testid="home-news-stale">
          <Translated locale={l} message="news.stale" />
        </p>
      )}
      <ul className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story) => (
          <li
            key={story.story_id}
            className="flex min-w-0 flex-col gap-1.5"
            data-testid="home-story"
          >
            <NewsCardImage image={story.image} />
            {drawableNewsImage(story.image) && <NewsImageCredit image={story.image} locale={l} />}
            {story.type.data !== null && (
              <span className="text-xs font-bold tracking-widest text-accent uppercase">
                <Translated locale={l} message={STORY_TYPE_KEY[story.type.data.type]} />
              </span>
            )}
            <h3 className="font-serif text-2xl font-semibold" lang={story.language}>
              <Link href={storyHref(locale, story.story_id)} className="hover:underline">
                {story.headline}
              </Link>
            </h3>
            <p className="text-sm text-muted">
              <bdi>{story.source.name}</bdi>
              {story.published_at !== null && (
                <>
                  {' · '}
                  <time dateTime={story.published_at}>
                    {formatDate(l, story.published_at, timeZone, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </time>
                </>
              )}
              {story.origin !== 'publisher' && (
                <>
                  {' · '}
                  <Translated locale={l} message={VERSION_STATUS_KEY[versionStatus(story)]} />
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The guest's two lines (T-523): what FMIP is, and what an account adds. */
export function GuestWelcome({ locale, children }: { locale: string; children: ReactNode }) {
  const l = asLocale(locale);
  return (
    <section
      aria-label={t(l, 'home.welcome.label')}
      className="flex flex-col gap-2 rounded-tile border border-default bg-surface px-4 py-3.5 text-sm"
    >
      {children}
    </section>
  );
}
