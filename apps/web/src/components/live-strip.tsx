import type { ScoreCard, ScoresGroup } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { EntityImage } from '@/components/entity-image';
import { LiveStripAge } from '@/components/live-strip-age';
import { MessageText } from '@/components/message-text';
import { LtrNumeric, ScorePair } from '@/components/score';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type Message, interpolate, message } from '@/i18n/messages';
import { fetchScores } from '@/lib/api';
import {
  type ChipState,
  type KeptAnswer,
  chipState,
  sharedAnswer,
  stripBehindAt,
  stripGroup,
  stripIsBehind,
} from '@/lib/live-strip';
import { type StatusKey, dateIn } from '@/lib/scores';

/**
 * The live strip (T-1381, D-199): under the header on every page, today's
 * matches of the first competition that has one, as a row of score chips
 * that scrolls sideways. Each chip opens its match.
 *
 * One request, without the session (the strip is the same for every reader
 * in a zone), shared between pages for a few seconds (`sharedAnswer`). When
 * the API cannot answer, or nothing is played today, there is no strip at
 * all: never an empty box that looks like a quiet day (rule 3). When the
 * answer may be behind, the strip says so (rule 4, `LiveStripAge`).
 *
 * The strip is on white in both themes and both modes, as the header is on
 * paper: `data-mode="editorial"` keeps the light values, `bg-surface` paints
 * the white.
 */

const KEPT = new Map<string, KeptAnswer<Awaited<ReturnType<typeof fetchScores>>>>();

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

type StripProps = Parameters<typeof LiveStripView>[0];

/**
 * The strip's data, or `null` for no strip: the API could not answer, or
 * nothing is played today. A plain function, not a component: it reads the
 * clock, once per request.
 */
async function loadStrip(locale: string, timeZone: string): Promise<StripProps | null> {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const today = dateIn(timeZone, new Date());
  const answer = await sharedAnswer(KEPT, `${today}|${timeZone}|${lang}`, Date.now(), () =>
    fetchScores(
      new URLSearchParams({ from: today, to: today, tz: timeZone }).toString(),
      undefined,
    ),
  ).catch(() => null);
  if (answer === null || !answer.ok) return null;
  const group = stripGroup(answer.data);
  if (group === null) return null;

  const now = Date.now();
  const words = Object.fromEntries(STATUS_KEYS.map((key) => [key, message(lang, key)])) as Record<
    StatusKey,
    Message
  >;
  const label = message(lang, 'shell.strip.label');
  return {
    locale: lang,
    group,
    chips: group.fixtures.map((card) => ({
      card,
      state: chipState(card, lang, timeZone, now, words),
    })),
    label: {
      ...label,
      text: interpolate(label.text, {
        competition: group.competition.short_name ?? group.competition.name,
      }),
    },
    versus: message(lang, 'shell.strip.versus'),
    note: message(lang, 'shell.strip.behind'),
    behindAt: stripBehindAt(group.fixtures, answer.data.generated_at),
    behind: stripIsBehind(group.fixtures, answer.data.generated_at, now),
  };
}

export async function LiveStrip({ locale, timeZone }: { locale: string; timeZone: string }) {
  const props = await loadStrip(locale, timeZone);
  return props === null ? null : <LiveStripView {...props} />;
}

/** The strip drawn from its parts: what `live-strip.spec.tsx` renders. */
export function LiveStripView({
  locale,
  group,
  chips,
  label,
  versus,
  note,
  behindAt,
  behind,
}: {
  locale: string;
  group: ScoresGroup;
  chips: readonly { card: ScoreCard; state: ChipState }[];
  /** "Today · Pro League", resolved, with its marking. */
  label: Message;
  /** What stands between two names before a score exists: "v", "–" in Persian. */
  versus: Message;
  note: Message;
  behindAt: number | null;
  behind: boolean;
}) {
  const labelId = 'live-strip-label';
  return (
    <nav
      aria-labelledby={labelId}
      data-mode="editorial"
      data-testid="live-strip"
      data-competition={group.competition.id}
      className="border-b border-default bg-surface"
    >
      <div className="page-frame flex items-center gap-3 py-2">
        {/* The design gives a phone no room for it; a screen reader still hears it. */}
        <span
          id={labelId}
          className="sr-only text-xs font-bold tracking-widest whitespace-nowrap text-caption uppercase md:not-sr-only md:shrink-0"
          data-testid="live-strip-label"
        >
          <MessageText message={label} />
        </span>
        <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto" data-testid="live-strip-chips">
          {chips.map(({ card, state }) => (
            <li key={card.id} className="shrink-0">
              <ScoreChip locale={locale} card={card} state={state} versus={versus} />
            </li>
          ))}
        </ul>
        <LiveStripAge behindAt={behindAt} initiallyBehind={behind} note={note} />
      </div>
    </nav>
  );
}

/** Persian and Arabic draw their digits in the interface face; Geist Mono has none. */
const ARABIC_SCRIPT = new Set(['fa', 'ar']);

/**
 * One score chip: 44px, radius 10, white in both themes. Status first, then
 * the home side, the score or "v", the away side, laid from the inline start,
 * so on `/fa` the home team is on the right with its goals beside it, the
 * pair isolated in the page's direction (`ScorePair`, D-193).
 */
export function ScoreChip({
  locale,
  card,
  state,
  versus,
}: {
  locale: string;
  card: ScoreCard;
  state: ChipState;
  versus: Message;
}) {
  const name = (team: ScoreCard['home']) => team.short_name ?? team.name;
  const goals = 'font-sans text-xl leading-none font-black font-stretch-condensed tabular-nums';
  return (
    <Link
      href={`/${locale}/match/${card.id}`}
      data-testid="strip-chip"
      data-kind={state.kind}
      className="flex h-11 items-center gap-2 rounded-control border border-default bg-surface px-3 whitespace-nowrap text-fg hover:border-strong"
    >
      <ChipStatus locale={locale} card={card} state={state} />
      <EntityImage media={card.home.crest} kind="crest" name={card.home.name} size={20} />
      <bdi className="text-sm font-semibold" data-testid="strip-home">
        {name(card.home)}
      </bdi>
      {state.score === null ? (
        <span className="px-0.5 text-sm text-caption">
          <MessageText message={versus} />
        </span>
      ) : (
        <ScorePair locale={locale} className="inline-flex items-center gap-1" testId="strip-score">
          <b className={goals}>{formatNumber(locale, state.score.home)}</b>
          <span className="text-sm text-caption">–</span>
          <b className={goals}>{formatNumber(locale, state.score.away)}</b>
        </ScorePair>
      )}
      <bdi className="text-sm font-semibold" data-testid="strip-away">
        {name(card.away)}
      </bdi>
      <EntityImage media={card.away.crest} kind="crest" name={card.away.name} size={20} />
    </Link>
  );
}

function ChipStatus({
  locale,
  card,
  state,
}: {
  locale: string;
  card: ScoreCard;
  state: ChipState;
}) {
  switch (state.kind) {
    case 'before':
      return (
        <time
          dateTime={card.kickoff_at}
          className={`text-xs text-caption ${ARABIC_SCRIPT.has(locale) ? 'font-sans' : 'font-mono'}`}
          data-testid="strip-status"
        >
          {state.status}
        </time>
      );
    case 'live':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs font-bold text-live"
          data-testid="strip-status"
        >
          <span aria-hidden="true" className="live-dot size-[7px] rounded-full bg-live" />
          <LtrNumeric>{state.status}</LtrNumeric>
        </span>
      );
    case 'behind':
      return (
        <span className="text-xs font-bold text-warning" data-testid="strip-status">
          {state.status}
        </span>
      );
    case 'final':
    case 'off':
      return (
        <span
          className="text-xs font-bold tracking-wide text-caption uppercase"
          data-testid="strip-status"
        >
          {state.status}
        </span>
      );
  }
}
