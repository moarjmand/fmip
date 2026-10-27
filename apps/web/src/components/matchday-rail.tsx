import {
  type CompetitionDirectoryEntry,
  type CompetitionDirectoryResponse,
  NO_MEDIA,
  type ScoresResponse,
} from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import { RailDrawer } from '@/components/live-strip';
import { MatchdayRailView } from '@/components/matchday-rail-view';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type Message, attribute, interpolate, message, plural } from '@/i18n/messages';
import { type ApiResult, fetchCompetitionDirectory, fetchScores } from '@/lib/api';
import { barName } from '@/lib/competitions-directory';
import {
  type KeptAnswer,
  chipState,
  sharedAnswer,
  stripBehindAt,
  stripIsBehind,
} from '@/lib/live-strip';
import {
  type RailLeague,
  type RailStatus,
  drawerFixtures,
  openLeague,
  railLeagues,
  railStatusText,
} from '@/lib/matchday-rail';
import { type StatusKey, dateIn } from '@/lib/scores';

/**
 * The matchday rail (T-1624, D-292): the one bar under the header on every
 * page, in place of the competitions bar (T-1433, T-1513) and the live strip
 * (T-1381) that sat under it. A chip per league -- its logo, its short name
 * and what it is doing today -- ordered by what is happening now
 * (`railLeagues`), "My teams" first for a member, "All competitions" last,
 * and a drawer with one league's matches today.
 *
 * Two requests, both shared between pages for a few seconds (`sharedAnswer`)
 * as the two bars' were: the directory per language, and today's scores in
 * the reader's zone, asked without the session (the same for every reader in
 * a zone). Rendered on the server with the header, so it is there at first
 * paint, the default drawer included. Nothing is guessed (rule 3): when the
 * directory cannot be read the rail is the leagues playing today and "All
 * competitions"; when today's scores cannot be read, or nothing is played,
 * there is no drawer and no status that needs them.
 */

const DIRECTORY = new Map<string, KeptAnswer<ApiResult<CompetitionDirectoryResponse>>>();
const TODAY = new Map<string, KeptAnswer<Awaited<ReturnType<typeof fetchScores>>>>();

const STATUS_KEYS: readonly StatusKey[] = [
  'status.live',
  'status.behind',
  'status.fullTime',
  'status.afterExtraTime',
  'status.penalties',
  'status.postponed',
  'status.suspended',
  'status.cancelled',
  'status.abandoned',
  'status.awarded',
];

async function loadDirectory(lang: Locale): Promise<CompetitionDirectoryEntry[]> {
  const answer = await sharedAnswer(DIRECTORY, lang, Date.now(), fetchCompetitionDirectory).catch(
    () => null,
  );
  return answer !== null && answer.ok ? answer.data.competitions : [];
}

async function loadToday(
  lang: Locale,
  timeZone: string,
  today: string,
): Promise<ScoresResponse | null> {
  const answer = await sharedAnswer(TODAY, `${today}|${timeZone}|${lang}`, Date.now(), () =>
    fetchScores(
      new URLSearchParams({ from: today, to: today, tz: timeZone }).toString(),
      undefined,
    ),
  ).catch(() => null);
  return answer !== null && answer.ok ? answer.data : null;
}

/** A chip's status after its name: the live dot and count, or a time. */
function StatusMark({ status, text }: { status: RailStatus; text: string | null }) {
  if (text === null || status.kind === 'none') return null;
  if (status.kind === 'live') {
    return (
      <span className="rail-status" data-kind="live" data-testid="rail-status">
        <span aria-hidden="true" className="live-dot size-[7px] rounded-full bg-live" />
        {text}
      </span>
    );
  }
  return (
    <time
      dateTime={status.at}
      className="rail-status tabular-nums"
      data-kind={status.kind}
      data-testid="rail-status"
    >
      {text}
    </time>
  );
}

/** The member's star, a line icon in the text colour. */
function Star() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-accent"
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
    </svg>
  );
}

/**
 * The rail drawn from its answers, a plain function so the spec can hand it
 * answers and a clock (`matchday-rail.spec.tsx`). `locale` builds the
 * addresses (the pseudo-locale keeps its own); the words are `lang`'s.
 */
export function railView({
  locale,
  timeZone,
  signedIn,
  directory,
  scores,
  now,
}: {
  locale: string;
  timeZone: string;
  signedIn: boolean;
  directory: readonly CompetitionDirectoryEntry[];
  scores: ScoresResponse | null;
  now: number;
}): Parameters<typeof MatchdayRailView>[0] {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const leagues = railLeagues(directory, scores, now, timeZone);
  const words = Object.fromEntries(STATUS_KEYS.map((key) => [key, message(lang, key)])) as Record<
    StatusKey,
    Message
  >;
  const live = (count: number) => plural(lang, 'shell.rail.live', count).text;
  const filled = (key: 'shell.strip.label' | 'shell.rail.open', league: RailLeague): Message => {
    const template = message(lang, key);
    return { ...template, text: interpolate(template.text, { competition: barName(league) }) };
  };
  const drawer = (league: RailLeague) => {
    const group = league.today;
    if (group === null || scores === null) return [];
    return [
      [
        league.id,
        <RailDrawer
          key={league.id}
          locale={locale}
          competition={league.id}
          chips={drawerFixtures(group.fixtures).map((card) => ({
            card,
            state: chipState(card, lang, timeZone, now, words),
          }))}
          label={filled('shell.strip.label', league)}
          open={filled('shell.rail.open', league)}
          versus={message(lang, 'shell.strip.versus')}
          note={message(lang, 'shell.strip.behind')}
          behindAt={stripBehindAt(group.fixtures, scores.generated_at)}
          behind={stripIsBehind(group.fixtures, scores.generated_at, now)}
        />,
      ] as const,
    ];
  };
  return {
    locale,
    items: leagues.map((league) => ({
      id: league.id,
      label: barName(league),
      icon: (
        <EntityImage media={league.logo ?? NO_MEDIA} kind="logo" name={barName(league)} size={20} />
      ),
      status: (
        <StatusMark
          status={league.status}
          text={railStatusText(league.status, lang, timeZone, now, live)}
        />
      ),
      today: league.today !== null,
    })),
    drawers: Object.fromEntries(leagues.flatMap(drawer)),
    initial: openLeague(leagues),
    myTeams: signedIn ? { label: message(lang, 'shell.rail.myTeams'), icon: <Star /> } : null,
    all: message(lang, 'competitions.bar.all'),
    navLabel: attribute(lang, 'competitions.bar.label'),
  };
}

/**
 * The rail's answers and the moment they are judged at. A plain function,
 * not a component: it reads the clock, once per request.
 */
async function loadRail(rail: { locale: string; timeZone: string; signedIn: boolean }) {
  const lang = isLocale(rail.locale) ? rail.locale : DEFAULT_LOCALE;
  const now = Date.now();
  const [directory, scores] = await Promise.all([
    loadDirectory(lang),
    loadToday(lang, rail.timeZone, dateIn(rail.timeZone, new Date(now))),
  ]);
  return railView({ ...rail, directory, scores, now });
}

export async function MatchdayRail(props: { locale: string; timeZone: string; signedIn: boolean }) {
  return <MatchdayRailView {...await loadRail(props)} />;
}
