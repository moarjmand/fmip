import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import type {
  MatchViewing,
  ScoreCard as ScoreCardData,
  Territory,
  ViewingTerritory,
} from '@fmip/contracts';
import { DayStrip } from '@/components/day-strip';
import { FilledMessage } from '@/components/filled-message';
import { GROUP_BLOCK, GROUP_HEADING, GROUP_LIST, GroupTitle } from '@/components/match-group';
import { MessageText } from '@/components/message-text';
import { ScoreCard } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { TerritoryChooser } from '@/components/viewing-panel';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { attribute, interpolate, message } from '@/i18n/messages';
import {
  fetchMe,
  fetchScores,
  fetchTerritories,
  fetchViewingBatch,
  fetchViewingTerritory,
} from '@/lib/api';
import { apiQuery, dayStrip, formatStamp, readScoresQuery } from '@/lib/scores';
import { say } from '@/lib/competition';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { territoryName } from '@/lib/territory';
import {
  highlightsState,
  optionsState,
  readTerritoryQuery,
  serviceNames,
  watchHref,
  withTerritory,
} from '@/lib/viewing';
import { scoresWords } from '@/lib/words-server';
import { Notice } from '@/components/ui';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { zoneWords } from '@/lib/reader-time-zone';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/watch',
    title: `${say(locale, 'viewing.pageTitle')} · Stadiomind`,
    description: say(locale, 'watch.metaDescription'),
  });
}

/**
 * The Watch page (blueprint 11, T-314; rebuilt in T-1792, D-394, board
 * P8-7): the day's matches, each with where it can be watched in the
 * viewer's territory -- the member's stored one (T-312) or the one a guest
 * picks here, which then travels with every link on the page.
 *
 * It is drawn with the matches page's own pieces, not copies: the day strip
 * (`DayStrip`), the competition blocks (`match-group.tsx`) and the rows
 * (`ScoreCard`), with the row's end cell holding the viewing answer instead
 * of the model's (Watch is not a forecast surface). The territory is asked
 * once, at the top, in one line ("Watching from · Not chosen · Choose"), a
 * guest's list opening under it in a native `<details>`; before a choice one
 * sentence says what the page needs and the rows carry no answer. After it,
 * each row says one of the four answers in words (rule 3): the official
 * services, nothing listed, not covered, or not loaded. The day comes from
 * the scores page's own question, in the same zone; the answers from one
 * batch request. The list's load time, and the oldest confirmation of a
 * listing shown, close the page (rule 4). No script of its own.
 */
export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readScoresQuery(query, (await pageTimeZone(locale, me)).timeZone);
  const territory = readTerritoryQuery(query);
  const [scores, territories] = await Promise.all([
    fetchScores(apiQuery(q), cookie),
    me === null ? fetchTerritories() : Promise.resolve(null),
  ]);
  // One clock for the page: when the list was made. A row whose feed fell
  // behind by then says so (T-083), and each stamp says its day unless it is that day.
  const now = scores.ok ? Date.parse(scores.data.generated_at) : undefined;
  const groups = scores.ok ? scores.data.groups : [];
  const cards: ScoreCardData[] = groups.flatMap((group) => group.fixtures);
  const batch =
    cards.length > 0
      ? await fetchViewingBatch(
          cards.map((card) => card.id),
          territory,
          cookie,
        )
      : null;
  const answers = new Map<string, MatchViewing>(
    batch !== null && batch.ok ? batch.data.fixtures.map((v) => [v.fixture_id, v]) : [],
  );
  // The bar shows on an empty day too, so it needs the territory state
  // without a match to ask about: the batch's answer when there was one, else
  // the member's stored choice, else the code a guest carried, named from the
  // list they choose from. Never anything inferred.
  const chosen: ViewingTerritory =
    batch !== null && batch.ok
      ? batch.data.territory
      : me !== null
        ? ((await fetchViewingTerritory(cookie)) ?? { state: 'not_chosen' })
        : guestChoice(territory, territories);
  const strip = dayStrip(q, locale, {
    yesterday: say(locale, 'scores.yesterday'),
    today: say(locale, 'scores.today'),
    tomorrow: say(locale, 'scores.tomorrow'),
  });
  const guestTerritory = me === null ? territory : undefined;
  const words = scoresWords(locale);
  // The oldest confirmation among the listings shown, so no older listing
  // sits under a newer time (rule 4).
  // Each listing's own time, not the module's: the module carries the newest
  // fetch among its rows, which would put an older listing under it.
  const confirmed = [...answers.values()]
    .flatMap((v) => (v.options.data ?? []).map((o) => o.last_updated_at))
    .filter((at): at is string => typeof at === 'string' && at !== '')
    .sort()[0];
  const stamp = (iso: string) => (
    <time dateTime={iso}>{formatStamp(locale, iso, q.timezone, now)}</time>
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6 lg:py-5">
      <h1 className="text-2xl font-extrabold font-stretch-semi-expanded" data-testid="title">
        <Translated locale={locale} message="viewing.pageTitle" />
      </h1>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="viewing.pageLead" />
      </p>

      <DayStrip
        days={strip}
        href={(date) => watchHref(locale, q, guestTerritory, { date })}
        label={attribute(l, 'watch.day')}
      />

      <TerritoryBar
        locale={l}
        chosen={chosen}
        signedIn={me !== null}
        territories={territories}
        hidden={{ date: q.date, ...(q.explicitTimezone ? { tz: q.timezone } : {}) }}
      />

      <p className="text-xs text-caption" data-testid="timezone">
        {say(locale, 'watch.timesIn', {
          zone: q.timezone,
          zoneName: zoneWords(locale, q.timezone),
        })}
      </p>

      {!scores.ok ? (
        <Notice tone="danger" data-testid="watch-unreachable">
          <Translated locale={locale} message="scores.unreachable" />
        </Notice>
      ) : cards.length === 0 ? (
        <p className="text-muted" data-testid="watch-empty">
          <Translated locale={locale} message="viewing.noMatches" />
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="watch-list">
          {batch !== null && !batch.ok && (
            <Notice tone="danger" data-testid="watch-viewing-unreachable">
              <Translated locale={locale} message="viewing.unreachable" />
            </Notice>
          )}
          {groups.map((group) => (
            <section
              key={group.competition.id}
              className={GROUP_BLOCK}
              data-testid="competition-group"
            >
              <div className={GROUP_HEADING}>
                <GroupTitle
                  locale={locale}
                  competition={group.competition}
                  country={group.country}
                />
              </div>
              <ul className={GROUP_LIST}>
                {group.fixtures.map((card) => (
                  <ScoreCard
                    key={card.id}
                    card={card}
                    timeZone={q.timezone}
                    locale={locale}
                    now={now}
                    href={withTerritory(`/${locale}/match/${card.id}`, guestTerritory)}
                    aside={
                      <WatchAnswer
                        locale={l}
                        viewing={answers.get(card.id)}
                        finished={card.status === 'finished'}
                      />
                    }
                    words={words}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {scores.ok && (
        <p className="text-xs text-muted" data-testid="watch-freshness">
          <FilledMessage
            message={message(l, 'scores.loadedAt')}
            params={{ time: stamp(scores.data.generated_at) }}
          />
          {confirmed !== undefined && (
            <>
              {' '}
              <FilledMessage
                message={message(l, 'watch.confirmedSince')}
                params={{ time: stamp(confirmed) }}
              />
            </>
          )}
        </p>
      )}
    </main>
  );
}

/**
 * Who the answers are for, asked once (D-394): "Watching from · Iran ·
 * Change territory" in one 48px line. A member's territory lives in settings
 * (T-312), so the line links there; a guest's line is the summary of a
 * native disclosure whose panel is the existing chooser (`TerritoryChooser`,
 * a GET form), so the pick goes into the address. Under it, one sentence:
 * what the page needs, or where its answers come from.
 */
function TerritoryBar({
  locale,
  chosen,
  signedIn,
  territories,
  hidden,
}: {
  locale: Locale;
  chosen: ViewingTerritory;
  signedIn: boolean;
  territories: Territory[] | null;
  hidden: Record<string, string>;
}) {
  const isChosen = chosen.state === 'chosen';
  const action = isChosen ? 'viewing.change' : 'viewing.choose';
  const line = (
    <>
      <span className="text-muted">
        <Translated locale={locale} message="watch.from" />
      </span>
      <span aria-hidden="true" className="text-caption">
        ·
      </span>
      <span className="font-semibold" data-testid="watch-territory-name">
        {isChosen ? (
          <bdi>{territoryName(locale, chosen.territory)}</bdi>
        ) : (
          <Translated locale={locale} message="viewing.notChosen" />
        )}
      </span>
    </>
  );
  const row = 'flex min-h-12 flex-wrap items-center gap-x-2 text-sm';
  const act = 'ms-auto inline-flex min-h-11 items-center font-semibold underline';
  return (
    <section
      className="flex flex-col rounded-lg border border-default bg-surface px-4 pb-2"
      data-testid="watch-territory"
      data-state={chosen.state}
    >
      {signedIn ? (
        <div className={row}>
          {line}
          <Link href={`/${locale}/settings#territory`} className={act}>
            <Translated locale={locale} message={action} />
          </Link>
        </div>
      ) : territories === null ? (
        <div className={row}>{line}</div>
      ) : (
        <details data-testid="watch-territory-choose">
          <summary className={`${row} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            {line}
            <span className={act}>
              <Translated locale={locale} message={action} />
            </span>
          </summary>
          <div className="pb-2">
            <TerritoryChooser
              locale={locale}
              viewing={{ fixture_id: '', territory: chosen, options: NONE, highlights: NONE }}
              signedIn={false}
              href={`/${locale}/watch`}
              territories={territories}
              hidden={hidden}
            />
          </div>
        </details>
      )}
      <p className="text-xs text-muted" data-testid="watch-need">
        <Translated locale={locale} message={isChosen ? 'watch.needChosen' : 'watch.need'} />
      </p>
    </section>
  );
}

/**
 * The row's end cell (D-394): one answer in words, never an empty cell that
 * reads as one (rule 3). No territory: nothing, because the bar above says
 * what is needed. Not loaded, not covered, nothing listed, or "Official:"
 * and the services; after full time, the official highlights when listed.
 * The row links to the match, whose Watch section has each service's link.
 */
function WatchAnswer({
  locale,
  viewing,
  finished,
}: {
  locale: Locale;
  viewing: MatchViewing | undefined;
  finished: boolean;
}) {
  const cell = 'col-start-3 row-span-2 row-start-1 min-w-0 text-end text-xs @xl:col-span-2';
  if (viewing === undefined) {
    return (
      <span className={`${cell} text-muted`} data-testid="watch-answer" data-state="not_loaded">
        <Translated locale={locale} message="watch.row.notLoaded" />
      </span>
    );
  }
  const state = optionsState(viewing);
  const highlight =
    finished && ['page', 'embed'].includes(highlightsState(viewing)) ? (
      <span className="block text-muted" data-testid="watch-answer-highlights">
        <Translated locale={locale} message="viewing.highlightsPage" />
      </span>
    ) : null;
  if (state === 'ask') {
    return <span className={cell} data-testid="watch-answer" data-state="ask" />;
  }
  if (state === 'listed' && viewing.options.data !== null) {
    // One name per service: a service listed twice (free and registration) is one name.
    const options = viewing.options.data.filter(
      (option, index, all) =>
        all.findIndex((o) => o.broadcaster.id === option.broadcaster.id) === index,
    );
    const resolved = message(locale, 'watch.row.official');
    return (
      <span className={cell} data-testid="watch-answer" data-state="listed">
        <MessageText
          className="block font-semibold"
          message={{
            ...resolved,
            text: interpolate(resolved.text, { services: serviceNames(locale, options) }),
          }}
        />
        {highlight}
      </span>
    );
  }
  return (
    <span className={`${cell} text-muted`} data-testid="watch-answer" data-state={state}>
      <Translated
        locale={locale}
        message={state === 'not_supplied' ? 'watch.row.notCovered' : 'watch.row.nothingListed'}
      />
      {highlight}
    </span>
  );
}

const NONE = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

/** A guest's carried code as a territory, when the list they chose from has it. */
function guestChoice(code: string | undefined, territories: Territory[] | null): ViewingTerritory {
  const found = code === undefined ? undefined : territories?.find((t) => t.code === code);
  return found === undefined ? { state: 'not_chosen' } : { state: 'chosen', territory: found };
}
