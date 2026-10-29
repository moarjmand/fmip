import type {
  CompetitionDirectoryEntry,
  CompetitionDirectoryResponse,
  ScoresResponse,
} from '@fmip/contracts';
import { CompetitionsMenuPanel } from '@/components/competitions-menu-view';
import { EntityImage } from '@/components/entity-image';
import { FreshnessStamp } from '@/components/freshness-stamp';
import Link from '@/components/ui/link';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import {
  type Message,
  type MessageKey,
  attribute,
  interpolate,
  message,
  plural,
} from '@/i18n/messages';
import { type ApiResult, fetchCompetitionDirectory, fetchScores } from '@/lib/api';
import { foldName } from '@/lib/competitions-directory';
import {
  MENU_COLUMNS,
  type MenuRegion,
  type MenuStatus,
  menuCounts,
  menuGroups,
  menuStatus,
  menuStatusText,
  todayGroups,
} from '@/lib/competitions-menu';
import type { CompetitionsMenuView, MenuGroupView } from '@/lib/competitions-menu-state';
import { type KeptAnswer, sharedAnswer, stripBehindAt, stripIsBehind } from '@/lib/live-strip';
import { railFixtures } from '@/lib/matchday-rail';
import { zoneWords } from '@/lib/reader-time-zone';
import { dateIn } from '@/lib/scores';

/**
 * The competitions menu (T-1643, D-301): every competition at once, grouped
 * by region, each with what it is doing today -- the header's Competitions
 * panel from 1024px, and the competitions page's list on a phone.
 *
 * Two answers, each shared between readers for a few seconds as the rail's
 * are (`sharedAnswer`): the directory per language, and today's scores in
 * the reader's zone, asked without the session. Nothing is guessed (rule 3):
 * no directory, no menu (the panel and the page say it could not be read);
 * no scores, no live or today status and no toggles that need them.
 *
 * The header draws only the panel's frame (`CompetitionsMenu`): the list is
 * drawn here when the panel asks for it (`refreshCompetitionsMenu`, a Server
 * Function), so a page that is never opened pays nothing for it, and an
 * opened one is as current as the answers.
 */

const DIRECTORY = new Map<string, KeptAnswer<ApiResult<CompetitionDirectoryResponse>>>();
const TODAY = new Map<string, KeptAnswer<Awaited<ReturnType<typeof fetchScores>>>>();

/** Each group's heading. */
const REGION_KEY: Record<MenuRegion, MessageKey> = {
  'big-five': 'competitionsMenu.region.bigFive',
  'european-cups': 'competitionsMenu.region.europeanCups',
  europe: 'competitionsMenu.region.europe',
  cups: 'competitionsMenu.region.cups',
  national: 'competitionsMenu.region.national',
  asia: 'competitionsMenu.region.asia',
  americas: 'competitionsMenu.region.americas',
  africa: 'competitionsMenu.region.africa',
  oceania: 'competitionsMenu.region.oceania',
  other: 'competitionsMenu.region.other',
};

function langOf(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * The menu's two answers, as they were at `now`: the directory (`null` when
 * it could not be read) and today's scores in the zone (`null` likewise).
 */
export async function menuAnswers(
  locale: string,
  timeZone: string,
  now: number,
): Promise<{
  directory: CompetitionDirectoryEntry[] | null;
  scores: ScoresResponse | null;
}> {
  const lang = langOf(locale);
  const today = dateIn(timeZone, new Date(now));
  const [directory, scores] = await Promise.all([
    sharedAnswer(DIRECTORY, lang, now, fetchCompetitionDirectory).catch(() => null),
    sharedAnswer(TODAY, `${today}|${timeZone}|${lang}`, now, () =>
      fetchScores(
        new URLSearchParams({ from: today, to: today, tz: timeZone }).toString(),
        undefined,
      ),
    ).catch(() => null),
  ]);
  return {
    directory: directory !== null && directory.ok ? directory.data.competitions : null,
    scores: scores !== null && scores.ok ? scores.data : null,
  };
}

/** A row's status after its name: the live dot and count, a time, a day, or FT and the next day. */
function StatusMark({
  status,
  words,
}: {
  status: MenuStatus;
  words: { text: string; next: string | null } | null;
}) {
  if (words === null || status.kind === 'none') return null;
  if (status.kind === 'live') {
    return (
      <span className="menu-status" data-kind="live" data-testid="competitions-menu-status">
        <span aria-hidden="true" className="live-dot size-[7px] rounded-full bg-live" />
        {words.text}
      </span>
    );
  }
  if (status.kind === 'finished') {
    return (
      <span className="menu-status" data-kind="finished" data-testid="competitions-menu-status">
        <span className="font-bold">{words.text}</span>
        {status.next !== null && words.next !== null ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={status.next.at}>{words.next}</time>
          </>
        ) : null}
      </span>
    );
  }
  return (
    <time
      dateTime={status.at}
      className="menu-status"
      data-kind={status.kind}
      data-testid="competitions-menu-status"
    >
      {words.text}
    </time>
  );
}

/**
 * The menu drawn from its answers, a plain function so the spec can hand it
 * answers and a clock (`competitions-menu.spec.tsx`); `null` when the
 * directory could not be read or names nothing. `locale` builds the
 * addresses (the pseudo-locale keeps its own); the words are `lang`'s.
 */
export function menuView({
  locale,
  timeZone,
  directory,
  scores,
  now,
}: {
  locale: string;
  timeZone: string;
  directory: readonly CompetitionDirectoryEntry[] | null;
  scores: ScoresResponse | null;
  now: number;
}): CompetitionsMenuView | null {
  if (directory === null || directory.length === 0) return null;
  const lang = langOf(locale);
  const groups = todayGroups(scores);
  const live = (count: number) => plural(lang, 'shell.rail.live', count).text;
  const finished = message(lang, 'status.fullTime').text;
  const n = (count: number) => formatNumber(lang, count);

  const drawn = menuGroups(directory, lang).map(({ region, competitions }) => {
    const label = message(lang, REGION_KEY[region]);
    return {
      region,
      label,
      rows: competitions.map((entry) => {
        const today = groups.get(entry.id) ?? null;
        const status = menuStatus(today, entry.next_kickoff_at, now, timeZone);
        return {
          id: entry.id,
          fold: foldName(
            [entry.name, entry.short_name ?? '', entry.country?.name ?? '', label.text].join(' '),
          ),
          live: status.kind === 'live',
          today: today !== null,
          node: (
            <Link
              href={`/${locale}/competition/${entry.id}`}
              // A long name is cut short in its track; the whole of it on hover.
              title={entry.name}
              className="menu-row"
              data-testid="competitions-menu-item"
              data-competition={entry.id}
            >
              <EntityImage media={entry.logo} kind="logo" name={entry.name} size={20} />
              <span className="min-w-0 flex-1 truncate">
                <bdi>{entry.name}</bdi>
              </span>
              <StatusMark
                status={status}
                words={menuStatusText(status, lang, timeZone, now, { live, finished })}
              />
            </Link>
          ),
        };
      }),
    } satisfies MenuGroupView;
  });

  const rows = drawn.flatMap((group) => group.rows);
  const counts = menuCounts(rows);
  const filled = (key: MessageKey, params: Record<string, string>): Message => {
    const template = message(lang, key);
    return { ...template, text: interpolate(template.text, params) };
  };
  const behindAt =
    scores === null ? null : stripBehindAt(railFixtures(scores), scores.generated_at);
  return {
    columns: MENU_COLUMNS.map((column) => drawn.filter((group) => column.includes(group.region))),
    counts:
      scores === null
        ? filled('competitionsMenu.countsNoToday', { all: n(counts.all) })
        : filled('competitionsMenu.counts', {
            live: n(counts.live),
            today: n(counts.today),
            all: n(counts.all),
          }),
    show:
      scores === null
        ? null
        : {
            all: filled('competitionsMenu.show.all', { count: n(counts.all) }),
            today: filled('competitionsMenu.show.today', { count: n(counts.today) }),
            live: filled('competitionsMenu.show.live', { count: n(counts.live) }),
          },
    counted: Array.from(
      { length: counts.all + 1 },
      (_, count) => plural(lang, 'competitions.count', count).text,
    ),
    numbers: Array.from({ length: counts.all + 1 }, (_, count) => n(count)),
    noMatch: message(lang, 'competitionsMenu.noMatch'),
    note: filled('competitionsMenu.note', { zone: zoneWords(lang, timeZone) }),
    stamp:
      scores === null ? null : (
        <FreshnessStamp
          checkedAt={scores.generated_at}
          now={now}
          staleAfterMs={
            behindAt === null
              ? Number.POSITIVE_INFINITY
              : Math.max(0, behindAt - Date.parse(scores.generated_at))
          }
          behind={stripIsBehind(railFixtures(scores), scores.generated_at, now)}
          locale={lang}
          words={{
            'freshness.checked': message(lang, 'freshness.checked'),
            'freshness.behind': message(lang, 'freshness.behind'),
          }}
          className="ms-auto"
          testId="competitions-menu-freshness"
        />
      ),
  };
}

/**
 * The menu as it is now, and the directory it was drawn from (`null` when
 * it could not be read): for the panel's Server Function and the
 * competitions page. A plain function, not a component: it reads the clock.
 */
export async function loadCompetitionsMenu(
  locale: string,
  timeZone: string,
): Promise<{ directory: CompetitionDirectoryEntry[] | null; view: CompetitionsMenuView | null }> {
  const now = Date.now();
  const { directory, scores } = await menuAnswers(locale, timeZone, now);
  return { directory, view: menuView({ locale, timeZone, directory, scores, now }) };
}

/** The words every copy of the menu shows before and around its list. */
export function menuFrameWords(locale: string) {
  const lang = langOf(locale);
  return {
    title: message(lang, 'competitionsMenu.title'),
    loading: message(lang, 'competitionsMenu.loading'),
    unreachable: message(lang, 'competitions.unreachable'),
    open: message(lang, 'competitionsMenu.open'),
    filter: attribute(lang, 'competitionsMenu.filter'),
    show: attribute(lang, 'competitionsMenu.show.label'),
  };
}

/**
 * The header's panel (from 1024px), mounted once in `SiteHeader`: its frame
 * and words only. The list arrives when a reader opens it, or points at
 * Competitions first (`warmCompetitionsMenu`).
 */
export function CompetitionsMenu({ locale, timeZone }: { locale: string; timeZone: string }) {
  return (
    <CompetitionsMenuPanel locale={locale} timeZone={timeZone} words={menuFrameWords(locale)} />
  );
}
