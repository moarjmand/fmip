import type {
  CompetitionTable,
  CoverageState,
  FounderAnalysisSummary,
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
import { CommunityLane, FounderLane } from '@/components/product-lanes';
import { Score } from '@/components/score';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { ButtonLink, CoverageBadge, Icon, LinkOut } from '@/components/ui';
import { formatDate, formatGregorianMonth, formatNumber, localDigits } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import type { AccuracyFigure, HomeBroadcasts } from '@/lib/home';
import { STORY_TYPE_KEY, VERSION_STATUS_KEY, storyHref, versionStatus } from '@/lib/news';
import { formatKickoff } from '@/lib/scores';
import { fromTeamSide } from '@/lib/team';
import { formatFixed, formatSigned } from '@/lib/words';

/**
 * The homepage's side column and its news in the Hybrid design (T-1382,
 * D-200; boards h1 and h9): the league table's top five, the model's
 * accuracy, today's broadcasts, the member's teams, the founder's column and
 * the call to pick, and the news. On a phone the column stacks under the
 * main one, in the same order. Server components only.
 */

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);
const MORE = 'inline-flex min-h-touch items-center gap-1.5 text-sm font-bold text-accent';

/** "Pro League · top five", the table's coverage, five rows and the way to the whole table. */
export function TableTopFive({ page, locale }: { page: CompetitionTable; locale: string }) {
  const l = asLocale(locale);
  const rows = (page.table.data ?? []).slice(0, 5);
  const name =
    page.competition.localised_name ?? page.competition.short_name ?? page.competition.name;
  const n = (value: number) => formatNumber(l, value);
  const state: CoverageState = page.table.coverage;
  return (
    <section aria-labelledby="home-table-title" data-testid="home-table">
      <RuleHeading
        id="home-table-title"
        title={
          <MessageText
            message={{
              ...message(l, 'home.table.title'),
              text: interpolate(t(l, 'home.table.title'), { competition: name }),
            }}
          />
        }
      />
      <p className="-mt-1.5 mb-2 flex flex-wrap items-center gap-2 text-sm text-caption">
        <bdi>{localDigits(l, page.season.label)}</bdi>
        <CoverageBadge
          state={state}
          label={<Translated locale={l} message={COVERAGE_KEY[state]} />}
        />
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          <Translated locale={l} message="home.table.none" />
        </p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead className="sr-only">
            <tr>
              <th scope="col">#</th>
              <th scope="col">
                <Translated locale={l} message="home.table.team" />
              </th>
              <th scope="col">
                <Translated locale={l} message="home.table.played" />
              </th>
              <th scope="col">
                <Translated locale={l} message="home.table.goalDifference" />
              </th>
              <th scope="col">
                <Translated locale={l} message="home.table.points" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.team.id} className="border-b border-default">
                <td className="w-6 py-2 text-caption">{n(row.position)}</td>
                <td className="py-2">
                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                    <EntityImage
                      media={row.team.crest}
                      kind="crest"
                      name={row.team.name}
                      size={20}
                    />
                    <bdi>{row.team.name}</bdi>
                  </span>
                </td>
                <td className="w-8 py-2 text-end text-muted">{n(row.played)}</td>
                <td className="w-12 py-2 text-end text-muted">
                  {/* The sign stays before the digits; the cell keeps the page's alignment. */}
                  <span dir="ltr">{formatSigned(l, row.goal_difference, 0)}</span>
                </td>
                <td className="w-9 py-2 text-end font-bold">{n(row.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link href={`/${locale}/competition/${page.competition.id}`} className={MORE}>
        <Translated locale={l} message="home.table.full" />
        <Icon name="forward" />
      </Link>
    </section>
  );
}

/**
 * The model's accuracy in the side column (T-1369, D-187): the newest period
 * with a match scored -- a week since T-1414, the design's "accuracy last
 * week", named by its Monday so an older week is never read as the last one
 * -- as RPS with the uniform guess beside it, the sample and its coverage
 * (a week is often `limited`, and says so), the versions and the last update.
 */
export function AccuracyCard({
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
  return (
    <section
      aria-labelledby="home-accuracy-title"
      className="border border-default border-t-3 border-t-model bg-surface px-4 py-3.5"
      data-testid="home-accuracy"
      data-state={
        !reachable ? 'unreachable' : figure === null ? 'not_supplied' : figure.metrics.coverage
      }
    >
      <h2
        id="home-accuracy-title"
        className="flex items-center gap-2 text-sm font-extrabold text-model"
      >
        <Icon name="model" />
        {figure === null ? (
          <Translated locale={l} message="home.accuracy.heading" />
        ) : (
          <MessageText
            message={
              figure.periodKind === 'week'
                ? {
                    ...message(l, 'home.accuracy.titleWeek'),
                    text: interpolate(t(l, 'home.accuracy.titleWeek'), {
                      date: formatDate(l, `${figure.periodStart}T00:00:00Z`, 'UTC', {
                        day: 'numeric',
                        month: 'short',
                      }),
                    }),
                  }
                : {
                    ...message(l, 'home.accuracy.title'),
                    text: interpolate(t(l, 'home.accuracy.title'), {
                      month: formatGregorianMonth(l, figure.period),
                    }),
                  }
            }
          />
        )}
      </h2>
      {!reachable ? (
        <p className="mt-2 text-sm text-muted">
          <Translated locale={l} message="home.accuracy.unreachable" />
        </p>
      ) : figure === null || figure.metrics.rps === null ? (
        <p className="mt-2 text-sm text-muted">
          <Translated locale={l} message="modelAccuracy.notSupplied" />
        </p>
      ) : (
        <>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <b
              className="font-sans text-display-2 leading-none font-black font-stretch-condensed tabular-nums"
              dir="ltr"
            >
              {formatFixed(l, figure.metrics.rps, 3)}
            </b>
            <span className="text-sm text-muted">
              <Translated locale={l} message="home.accuracy.rps" />
            </span>
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <Translated locale={l} message="home.accuracy.sample" count={figure.metrics.matches} />
            {figure.metrics.uniform_rps !== null && (
              <MessageText
                message={{
                  ...message(l, 'home.accuracy.baseline'),
                  text: interpolate(t(l, 'home.accuracy.baseline'), {
                    rps: formatFixed(l, figure.metrics.uniform_rps, 3),
                  }),
                }}
              />
            )}
            <CoverageBadge
              state={figure.metrics.coverage}
              label={<Translated locale={l} message={COVERAGE_KEY[figure.metrics.coverage]} />}
            />
          </p>
          <p className="mt-1 flex flex-wrap gap-x-2 font-mono [:root:is(:lang(fa),:lang(ar))_&]:font-sans text-xs text-caption">
            {figure.modelVersions.map((version) => (
              <span key={version} dir="ltr" className="text-model">
                {version}
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
        <Translated locale={l} message="home.accuracy.link" />
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
}: {
  analyses: FounderAnalysisSummary[] | null;
  locale: string;
}) {
  const l = asLocale(locale);
  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <FounderLane locale={l}>
        {analyses === null || analyses.length === 0 ? (
          <p className="text-sm text-muted" data-testid="home-founder-none">
            <Translated locale={l} message="home.founder.none" />
          </p>
        ) : (
          <FounderAnalysisFeed
            analyses={analyses}
            locale={locale}
            timeZone="UTC"
            heading={<Translated locale={l} message="home.founder.heading" />}
          />
        )}
      </FounderLane>
      <CommunityLane locale={l}>
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
      </CommunityLane>
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
      className="flex flex-col gap-2 border border-default bg-surface px-4 py-3.5 text-sm"
    >
      {children}
    </section>
  );
}
