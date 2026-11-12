import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { shootoutStart } from '@/lib/match';
import { listName } from '@/lib/person-name';
import { NAME_WRAP } from '@/lib/word-fit';
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
 * page's JavaScript (the match centre's first-load budget, T-808). A
 * finished match does not move; while a match is on, the client's own
 * timeline in `match-centre-view.tsx` is drawn instead, and a match that
 * ends while the page is open gets this on its next load or refresh.
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
          <ol className="flex flex-wrap gap-0.5">
            {kicks
              .filter((k) => k.side === side)
              .map((k) => {
                const scored = k.kind === 'penalty_goal';
                return (
                  <li
                    key={k.id}
                    className="flex w-8.5 flex-col items-center gap-0.5 text-center text-[10px] leading-tight text-muted font-stretch-condensed"
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
                    </span>
                    {k.player !== null && (
                      <bdi className={`line-clamp-2 max-w-full ${NAME_WRAP}`}>
                        {/* The surname under the circle, as the board draws it. */}
                        {listName(locale, k.player.name).replace(/^\p{Lu}\. /u, '')}
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
  const end = Math.max(centre.fixture.scores.extra_time === null ? 90 : 120, ...marked.map(at));
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
        let labelled = -100;
        return (
          <div key={side} className="relative h-11 border-b border-default" data-lane={side}>
            {/* Placed by the page's direction, the name isolated inside it. */}
            <span className="absolute start-0 top-0 font-semibold">
              <bdi>{centre.fixture[side].name}</bdi>
            </span>
            {marked
              .filter((i) => i.side === side)
              .map((i) => {
                const x = (at(i) / end) * 100;
                const label = x - labelled > 9;
                if (label) labelled = x;
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
                      {formatMinute(locale, i.minute, i.added_time)}
                    </span>
                  </span>
                );
              })}
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
