import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { shootoutStart } from '@/lib/match';
import { shortName } from '@/lib/person-name';
import { formatKickoff } from '@/lib/scores';
import { fill, formatMinute } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { Module } from '@/components/match-centre-cards';
import { type MatchHero, IncidentMark, IncidentText } from '@/components/match-centre-view';
import { MessageText } from '@/components/message-text';
import { Score } from '@/components/score';
import { cx } from '@/components/ui/cx';

/**
 * A finished match's key events and its shoot-out (T-1798, T-1799; D-396,
 * D-397; board P9-3), drawn on the server and handed to the match centre as
 * its `keyEvents` slot and the band's `penalties`, so none of it is in the
 * page's JavaScript (the match centre's first-load budget, T-808). Since
 * T-1811 (D-409) it is drawn in play too: the page passes it for a live,
 * suspended or finished match (`drawsKeyEvents`), and the live page draws it
 * again through `refreshLiveModules` when the stream brings an event; a
 * match that kicks off or ends while the page is open is drawn again by the
 * status change's refresh.
 *
 * No directive: a server module. It reuses the client view's incident row
 * pieces (`IncidentText`, `IncidentMark`), which costs the client nothing.
 */

const say = (locale: string, key: MessageKey) =>
  message(isLocale(locale) ? locale : DEFAULT_LOCALE, key);

/**
 * The band's sentence and the compact bar's mark for a finished match
 * decided on penalties (D-396): the winner is the side with more shoot-out
 * goals, from `scores.penalties` alone; a level score names no winner and
 * the sentence says so (rule 3). `undefined` for any other match.
 */
export function shootoutHero(
  locale: string,
  f: Pick<MatchCentre['fixture'], 'status' | 'scores' | 'home' | 'away'>,
): MatchHero['penalties'] {
  const p = f.scores.penalties;
  if (f.status !== 'finished' || p === null) return undefined;
  const won = p.home === p.away ? null : p.home > p.away ? 'home' : 'away';
  const line = (
    <p className="text-center text-sm font-bold text-fg" data-testid="shootout-winner">
      {won === null ? (
        <MessageText message={say(locale, 'matchCentre.shootoutWinnerUnknown')} />
      ) : (
        <FilledMessage
          message={say(locale, 'matchCentre.shootoutWin')}
          params={{
            team: <bdi>{f[won].name}</bdi>,
            score: (
              <Score
                home={Math.max(p.home, p.away)}
                away={Math.min(p.home, p.away)}
                locale={locale}
              />
            ),
          }}
        />
      )}
    </p>
  );
  // The bar is `aria-hidden` (the band says the sentence): the mark's words
  // are its hover text.
  const mark = (
    <span
      className="shrink-0 font-extrabold text-accent"
      title={say(locale, 'matchCentre.wonOnPenalties').text}
      data-testid="shootout-mark"
    >
      ✓
    </span>
  );
  return won === null ? { line } : { line, [won]: mark };
}

/** Goals and cards on the axis; every other incident is in the list only. */
const AXIS_KINDS = new Set<MatchIncident['kind']>([
  'goal',
  'penalty_goal',
  'own_goal',
  'yellow_card',
  'second_yellow_card',
  'red_card',
]);
const GOAL_KINDS = new Set<MatchIncident['kind']>(['goal', 'penalty_goal', 'own_goal']);

/**
 * "Key events" after full time: the two-lane axis, the events of play in
 * order from kick-off with the substitutions folded in a native details
 * (D-397), then the shoot-out as one card of circles (D-396). The same card
 * and coverage states as every module (`Module`, rule 3).
 */
export function KeyEvents({
  centre,
  locale,
  timeZone,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  words: MatchWords;
}) {
  const m = words.m;
  const f = centre.fixture;
  return (
    <Module
      title={m['matchCentre.keyEvents']}
      module={centre.timeline}
      testId="timeline"
      words={words}
      // In play, a feed that has sent nothing yet is "Not in yet", never a
      // verdict (T-1497, rule 3), as the client's timeline said (T-1811).
      notInYet={f.status === 'live'}
    >
      {(incidents) => {
        // The kicks are found as the client's timeline finds them (T-1477, T-1666, D-322).
        const kicksFrom = shootoutStart(incidents, f.scores.penalties, f.scores.current);
        const play = kicksFrom === null ? incidents : incidents.slice(0, kicksFrom);
        const subs = play.filter((i) => i.kind === 'substitution');
        const row = (i: MatchIncident) => (
          <li
            key={i.id}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 border-b border-default py-2.5 md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)]"
            data-side={i.side ?? undefined}
          >
            <span className="font-mono text-muted tabular-nums" dir="ltr">
              {formatMinute(locale, i.minute, i.added_time)}
            </span>
            <span
              className={cx(
                'flex min-w-0 items-center gap-3',
                i.side === 'away'
                  ? 'md:col-start-3'
                  : i.side === null
                    ? 'md:col-span-2'
                    : 'md:col-start-2',
              )}
            >
              <IncidentMark kind={i.kind} />
              <IncidentText incident={i} inPlay centre={centre} locale={locale} words={words} />
            </span>
          </li>
        );
        return (
          <>
            {/* Nothing recorded is said, never an empty card (rule 3). */}
            {incidents.length === 0 && (
              <p dir="auto" className="text-sm text-muted" data-testid="no-events">
                <MessageText message={m['matchCentre.noEventsYet']} />
              </p>
            )}
            {play.length > 0 && (
              <Axis incidents={play} centre={centre} locale={locale} words={words} />
            )}
            <ol className="flex flex-col text-sm">
              <li className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 border-b border-default py-2.5 last:border-b-0">
                <span className="font-mono text-muted tabular-nums">
                  {formatKickoff(locale, f.kickoff_at, timeZone)}
                </span>
                <span className="flex items-center gap-3">
                  <IncidentMark kind="kickoff" />
                  <b className="font-bold text-fg">
                    <MessageText message={m['matchCentre.kickedOff']} />
                  </b>
                </span>
              </li>
              {play.filter((i) => i.kind !== 'substitution').map(row)}
            </ol>
            {subs.length > 0 && (
              <details className="text-sm" data-testid="substitutions">
                <summary className="flex min-h-touch cursor-pointer items-center gap-3 font-bold text-fg">
                  <IncidentMark kind="substitution" />
                  {fill(say(locale, 'matchCentre.substitutions').text, {
                    count: formatNumber(locale, subs.length),
                  })}
                </summary>
                <ol className="flex flex-col">{subs.map(row)}</ol>
              </details>
            )}
            {kicksFrom !== null && (
              <Shootout kicks={incidents.slice(kicksFrom)} centre={centre} locale={locale} />
            )}
          </>
        );
      }}
    </Module>
  );
}

/**
 * The taker's name under a circle (T-1798, D-395): his surname alone, the
 * short form's initial dropped ("Mac Allister", "Gravenberch"), on the
 * Persian page too, where a Latin name would otherwise be written whole.
 */
export function kickName(name: string): string {
  return shortName(name).replace(/^\p{Lu}\. /u, '');
}

/**
 * One line under a circle, never broken inside a word (D-395). A kick's
 * column is at least 56px (`min-w-14`); measured at 375 in the page's own
 * fonts, a name of nine letters fits at 10px (Archivo at 75% width,
 * Vazirmatn as drawn), "Gravenberch" needs 9px in Vazirmatn (50px) and
 * "Mac Allister" 9px with Archivo at 62.5% (33px; Vazirmatn 48px), which has
 * no width axis, so the size steps too. A longer name widens its column
 * rather than break.
 */
export function kickNameFit(name: string): string {
  const letters = Array.from(name).length;
  if (letters <= 9) return '';
  if (letters <= 11) return 'text-[9px]';
  return 'text-[9px] font-stretch-extra-condensed';
}

/**
 * The shoot-out (D-396): its score, then each side's kicks in the order
 * recorded as a row of circles -- filled with a tick for a goal, dashed with
 * a cross for a miss -- each with its word for a screen reader and the
 * taker's surname under it. A kick with no side recorded is not drawn.
 */
function Shootout({
  kicks,
  centre,
  locale,
}: {
  kicks: MatchIncident[];
  centre: MatchCentre;
  locale: string;
}) {
  const f = centre.fixture;
  const p = f.scores.penalties;
  return (
    <section
      className="flex flex-col gap-2.5 rounded-control border border-default px-2 py-3"
      data-testid="shootout"
    >
      <h3 className="flex justify-between gap-2 font-bold text-fg">
        <MessageText message={say(locale, 'matchCentre.shootout')} />
        {p !== null && <Score home={p.home} away={p.away} locale={locale} />}
      </h3>
      {(['home', 'away'] as const).map((side) => (
        <div key={side} className="flex flex-col gap-1">
          <p className="flex justify-between gap-2 text-sm font-bold">
            <bdi>{f[side].name}</bdi>
            {p !== null && formatNumber(locale, p[side])}
          </p>
          <ol className="flex flex-wrap gap-x-0.5 gap-y-2">
            {kicks
              .filter((k) => k.side === side)
              .map((k) => {
                const scored = k.kind === 'penalty_goal';
                const surname = k.player === null ? null : kickName(k.player.name);
                return (
                  <li
                    key={k.id}
                    className="flex min-w-14 flex-col items-center gap-0.5 text-center text-[10px] leading-tight text-muted font-stretch-condensed"
                    data-kick={scored ? 'scored' : 'missed'}
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        'grid size-7 place-items-center rounded-full border-[1.5px] border-fg text-sm',
                        scored ? 'bg-fg text-surface' : 'border-dashed text-fg',
                      )}
                    >
                      {scored ? '✓' : '✕'}
                    </span>
                    <span className="sr-only">
                      <MessageText
                        message={say(
                          locale,
                          scored ? 'matchCentre.kickScored' : 'matchCentre.kickMissed',
                        )}
                      />
                      {/* The taker's whole name for a screen reader. */}
                      {k.player !== null && (
                        <>
                          {', '}
                          <bdi>{k.player.name}</bdi>
                        </>
                      )}
                    </span>
                    {surname !== null && (
                      <bdi
                        aria-hidden="true"
                        className={cx('whitespace-nowrap', kickNameFit(surname))}
                        data-testid="kick-name"
                      >
                        {surname}
                      </bdi>
                    )}
                  </li>
                );
              })}
          </ol>
        </div>
      ))}
      <p aria-hidden="true" className="text-xs text-caption">
        <MessageText message={say(locale, 'matchCentre.shootoutKey')} />
      </p>
    </section>
  );
}

/**
 * Whether extra time was played (D-397), so the axis runs to 120: an
 * extra-time period, or goals in extra time. A shoot-out alone is not extra
 * time: a cup that goes straight to penalties (the League Cup) comes from
 * the feed with an extra-time score of 0-0, so 0-0 and no period is read as
 * none played. A goal or card later than 90 still stretches the scale to its
 * minute.
 */
export function extraTimePlayed(
  fixture: Pick<MatchCentre['fixture'], 'scores' | 'periods'>,
): boolean {
  const extra = fixture.scores.extra_time;
  return (
    fixture.periods.some((p) => p.kind === 'extra_time_first' || p.kind === 'extra_time_second') ||
    (extra !== null && extra.home + extra.away > 0)
  );
}

/**
 * The axis (D-397): two lanes, the home side's above the away side's, each
 * named, on a scale of 0-45-90 that extra time extends to 120; each goal a
 * dot and each card a card, its minute under it unless the previous label in
 * its lane is too close (the list says every minute). A minute of added time
 * sits after its half's last minute; the first half's are pressed together at
 * half-time so the second half keeps its place. Described for a screen
 * reader; mirrors on /fa (the minutes run from the inline start).
 */
function Axis({
  incidents,
  centre,
  locale,
  words,
}: {
  incidents: MatchIncident[];
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const marked = incidents.filter((i) => AXIS_KINDS.has(i.kind) && i.side !== null);
  // No goal and no card: no empty lanes that look like a drawn module (rule 3).
  if (marked.length === 0) return null;
  const at = (i: MatchIncident) => i.minute + (i.added_time ?? 0) * (i.minute <= 45 ? 0.15 : 1);
  const end = Math.max(extraTimePlayed(centre.fixture) ? 120 : 90, ...marked.map(at));
  const pos = (minute: number) => `${(minute / end) * 100}%`;
  const goals = marked.filter((i) => GOAL_KINDS.has(i.kind)).length;
  const centred = 'absolute -translate-x-1/2 rtl:translate-x-1/2';
  const mark = (kind: MatchIncident['kind']) =>
    GOAL_KINDS.has(kind)
      ? 'size-3 rounded-full bg-fg'
      : cx('h-3 w-2.25 rounded-xs', kind === 'yellow_card' ? 'bg-warning' : 'bg-danger');
  return (
    <div
      role="img"
      aria-label={fill(m['matchCentre.axis'].text, {
        goals: formatNumber(locale, goals),
        cards: formatNumber(locale, marked.length - goals),
      })}
      className="flex flex-col gap-1.5 px-2 font-mono text-[10px] text-caption"
      data-testid="timeline-axis"
    >
      {(['home', 'away'] as const).map((side) => {
        // The last labelled minute: where it stands (%) and its length.
        let labelled = { x: -100, letters: 0 };
        return (
          <div key={side} className="flex flex-col" data-lane={side}>
            {/* The lane's name on its own line, never over a mark; placed by the page's direction. */}
            <span className="font-semibold">
              <bdi>{centre.fixture[side].name}</bdi>
            </span>
            <div className="relative h-9 border-b border-default">
              {marked
                .filter((i) => i.side === side)
                .map((i) => {
                  const x = (at(i) / end) * 100;
                  const minute = formatMinute(locale, i.minute, i.added_time);
                  const letters = Array.from(minute).length;
                  // A label only where it clears the last one: half of each
                  // label's width (a 10px mono letter is about 1% of the lane
                  // at 375) and a gap of 2%.
                  const label = x - labelled.x >= labelled.letters + letters + 2;
                  if (label) labelled = { x, letters };
                  return (
                    <span
                      key={i.id}
                      data-kind={i.kind}
                      className={cx(
                        centred,
                        'bottom-1 flex flex-col items-center gap-0.5 text-muted',
                      )}
                      style={{ insetInlineStart: `${x}%` }}
                    >
                      <span className={mark(i.kind)} />
                      <span dir="ltr" className={label ? undefined : 'invisible'}>
                        {minute}
                      </span>
                    </span>
                  );
                })}
            </div>
          </div>
        );
      })}
      <div className="relative h-3.5">
        {[0, 45, 90, 105, 120]
          .filter((t) => t <= end)
          .map((t) => (
            <span key={t} className={centred} style={{ insetInlineStart: pos(t) }}>
              {formatNumber(locale, t)}
            </span>
          ))}
      </div>
      <p className="flex flex-wrap gap-x-3 font-sans text-xs">
        {(['goal', 'yellow_card', 'red_card'] as const).map((kind) => (
          <span key={kind} className="flex items-center gap-1">
            <span className={mark(kind)} />
            <MessageText
              message={
                m[
                  kind === 'goal'
                    ? 'matchCentre.incident.goal'
                    : kind === 'yellow_card'
                      ? 'matchCentre.incident.yellowCard'
                      : 'matchCentre.incident.redCard'
                ]
              }
            />
          </span>
        ))}
      </p>
    </div>
  );
}
