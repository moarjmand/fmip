import Link from '@/components/ui/link';
import type {
  KnockoutBracket as Bracket,
  KnockoutRound,
  KnockoutRoundKey,
  KnockoutTeam,
  KnockoutTie,
} from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { formatDate, formatNumber } from '@/i18n/format';
import { listText, say, statusSuffix } from '@/lib/competition';
import {
  chipLabel,
  legGoals,
  legLabel,
  legLine,
  legPenalties,
  openingStage,
  roundLabel,
  roundNote,
  tieOutcome,
} from '@/lib/bracket';

/**
 * The knockout rounds on a continental cup's competition page (blueprint
 * 5.1, T-630; D-378's D10, T-1763). From 768px every round is a column, in
 * the order they are played, top-aligned (no connector lines: which tie feeds
 * which is not stored, so nothing pretends to be a tree), scrolling sideways
 * in its own box where the columns do not fit. On a phone a row of round
 * chips (links, `?stage=`) and one round of ties at a time, opening at the
 * latest round with a tie drawn. Server markup and CSS: no script.
 *
 * A tie is its two teams with each leg's goals and the aggregate, the winner
 * ticked and bold, the loser muted, and the outcome said in words: nothing
 * rests on colour alone. The aggregate and the winner are the API's
 * (`KnockoutTie`, said by `tieOutcome`), never worked out here; a tie still
 * to be decided has neither. A round nobody has drawn is a sentence (a dashed
 * chip on a phone), never a row of placeholder teams; with nothing drawn at
 * all, one card says so and names the rounds to come.
 */
export function KnockoutBracket({
  bracket,
  locale,
  timeZone,
  stage = null,
  href,
  competition,
  season,
}: {
  bracket: Bracket;
  locale: string;
  timeZone: string;
  /** The round the reader chose (`?stage=`); null opens the latest drawn one. */
  stage?: KnockoutRoundKey | null;
  /** A round chip's address (`stageHref`). */
  href: (key: KnockoutRoundKey) => string;
  /** The competition's and the season's names, for the sentence that nothing is drawn. */
  competition: string;
  season: string;
}) {
  const chosen = stage ?? openingStage(bracket);
  const shown = bracket.rounds.find((r) => r.key === chosen) ?? null;
  return (
    <section
      id="bracket"
      aria-labelledby="bracket-heading"
      className="flex min-w-0 scroll-mt-4 flex-col gap-4"
      data-testid="bracket"
    >
      <h2 id="bracket-heading" className="text-lg font-semibold">
        <Translated locale={locale} message="competitionPage.bracket.title" />
      </h2>

      {/* A phone: the rounds as chips, one round shown. */}
      <div className="flex min-w-0 flex-col gap-3 md:hidden" data-testid="bracket-phone">
        <nav
          aria-label={say(locale, 'competitionPage.bracket.title')}
          className="flex gap-1.5 overflow-x-auto"
          data-testid="bracket-chips"
        >
          {bracket.rounds.map((round) => {
            const current = round.key === chosen;
            const drawn = round.state === 'drawn';
            return (
              <Link
                key={round.key}
                href={href(round.key)}
                scroll={false}
                aria-current={current ? 'true' : undefined}
                aria-label={roundLabel(round.key, locale)}
                className={cx(
                  'inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-pill border px-3.5 text-sm font-bold whitespace-nowrap',
                  current
                    ? 'border-fg bg-fg text-canvas'
                    : drawn
                      ? 'border-default text-fg hover:bg-surface-raised'
                      : 'border-dashed border-strong text-muted hover:text-fg',
                )}
                data-testid="bracket-chip"
                data-state={round.state}
              >
                {chipLabel(round.key, locale)}
              </Link>
            );
          })}
        </nav>
        {shown === null ? (
          <NothingDrawn
            bracket={bracket}
            locale={locale}
            competition={competition}
            season={season}
          />
        ) : (
          <div data-testid="bracket-stage" data-stage={shown.key} data-state={shown.state}>
            <RoundBlock round={shown} locale={locale} timeZone={timeZone} />
          </div>
        )}
      </div>

      {/* From 768px: every round, a column each, top-aligned. */}
      <div
        className="hidden overflow-x-auto pb-1 focus-visible:outline-2 focus-visible:outline-focus md:block"
        role="region"
        aria-labelledby="bracket-heading"
        tabIndex={0}
        data-testid="bracket-columns"
      >
        <ol className="grid auto-cols-[minmax(13.75rem,1fr)] grid-flow-col items-start gap-3">
          {bracket.rounds.map((round) => (
            <li
              key={round.key}
              className="min-w-0"
              data-testid="bracket-round"
              data-stage={round.key}
              data-state={round.state}
            >
              <RoundBlock round={round} locale={locale} timeZone={timeZone} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** With no round drawn: one card that says so and names the rounds to come. */
function NothingDrawn({
  bracket,
  locale,
  competition,
  season,
}: {
  bracket: Bracket;
  locale: string;
  competition: string;
  season: string;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-control border border-dashed border-strong p-3.5 text-sm text-muted"
      data-testid="bracket-none-drawn"
    >
      <p className="font-semibold text-fg">
        {say(locale, 'bracket.noneDrawn', { competition, season })}
      </p>
      <p>
        <Translated locale={locale} message="bracket.noneDrawnWhen" />
      </p>
      <p>
        {say(locale, 'bracket.roundsToCome', {
          rounds: listText(
            locale,
            bracket.rounds.map((r) => roundLabel(r.key, locale)),
          ),
        })}
      </p>
    </div>
  );
}

/** One round: its name and how many matches a tie has, its ties, and what it lacks. */
function RoundBlock({
  round,
  locale,
  timeZone,
}: {
  round: KnockoutRound;
  locale: string;
  timeZone: string;
}) {
  const note = roundNote(round, locale);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-bold">
        {roundLabel(round.key, locale)}
        <span className="ms-2 text-xs font-normal text-muted">
          <Translated
            locale={locale}
            message={
              round.legs === 2
                ? 'competitionPage.bracket.twoLegs'
                : 'competitionPage.bracket.oneMatch'
            }
          />
        </span>
      </h3>
      {round.ties.length > 0 && (
        <ul className="flex flex-col gap-2">
          {round.ties.map((tie) => (
            <TieCard
              key={tie.legs[0]!.fixture_id}
              tie={tie}
              legs={round.legs}
              locale={locale}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}
      {note !== null && (
        <p
          className={cx(
            'text-sm text-muted',
            round.ties.length === 0 && 'rounded-control border border-dashed border-strong p-3',
          )}
          data-testid="bracket-note"
        >
          {note}
        </p>
      )}
    </div>
  );
}

const nameOf = (team: KnockoutTeam): string => team.short_name ?? team.name;

/**
 * One tie: a small table, a row per team, a column per leg (or the one match
 * with its shoot-out in brackets) and the aggregate, then the outcome in
 * words, the legs that went to extra time or penalties as their own lines,
 * and a link to each leg's match page.
 */
function TieCard({
  tie,
  legs,
  locale,
  timeZone,
}: {
  tie: KnockoutTie;
  legs: 1 | 2;
  locale: string;
  timeZone: string;
}) {
  const [a, b] = tie.teams;
  const n = (value: number): string => formatNumber(locale, value);
  const slots = Array.from({ length: legs }, (_, i) => tie.legs[i] ?? null);
  const extra = tie.legs.filter((leg) => leg.after_extra_time || leg.penalties !== null);
  const head = 'px-1.5 pt-2 pb-0.5 text-end text-xs font-semibold text-caption';
  return (
    <li
      className="flex min-w-0 flex-col rounded-control border border-default bg-surface text-sm"
      data-testid="bracket-tie"
      data-decided={tie.winner === null ? undefined : ''}
    >
      <table className="w-full border-collapse tabular-nums">
        <caption className="sr-only">
          {nameOf(a)} {say(locale, 'competitionPage.v')} {nameOf(b)}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="ps-3 pt-2 pb-0.5 text-start text-xs font-semibold text-caption"
            >
              <span className="sr-only">
                <Translated locale={locale} message="bracket.head.team" />
              </span>
            </th>
            {slots.map((leg, i) => (
              <th key={i} scope="col" className={head}>
                {legs === 1
                  ? say(locale, 'bracket.leg.match')
                  : say(locale, 'scores.card.leg', { leg: n(leg?.leg ?? i + 1) })}
              </th>
            ))}
            {legs === 2 && (
              <th scope="col" className={cx(head, 'pe-3')}>
                <abbr title={say(locale, 'bracket.head.aggregateFull')} className="no-underline">
                  <Translated locale={locale} message="bracket.head.aggregate" />
                </abbr>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {tie.teams.map((team, index) => {
            const won = tie.winner !== null && tie.winner.id === team.id;
            const lost = tie.winner !== null && !won;
            return (
              <tr
                key={team.id}
                className={cx(
                  won ? 'font-extrabold' : lost ? 'font-medium text-muted' : 'font-semibold',
                )}
                data-testid="bracket-team"
                data-result={won ? 'won' : lost ? 'lost' : undefined}
              >
                <th scope="row" className="ps-3 py-1 text-start font-[inherit]">
                  <span className="flex min-w-0 items-center gap-1">
                    {won && <Icon name="check" size={14} strokeWidth={2.5} className="shrink-0" />}
                    <bdi className="min-w-0 break-words">{nameOf(team)}</bdi>
                    {won && (
                      <span className="sr-only">
                        {' '}
                        (<Translated locale={locale} message="bracket.winner" />)
                      </span>
                    )}
                  </span>
                </th>
                {slots.map((leg, i) => {
                  const goals = leg === null ? null : legGoals(leg, team.id);
                  const pens = leg === null || legs === 2 ? null : legPenalties(leg, team.id);
                  return (
                    <td key={i} className="px-1.5 py-1 text-end" data-testid="bracket-goals">
                      {goals === null ? '' : n(goals)}
                      {pens !== null && <span className="ms-1 text-xs">({n(pens)})</span>}
                    </td>
                  );
                })}
                {legs === 2 && (
                  <td className="px-1.5 py-1 pe-3 text-end" data-testid="bracket-aggregate">
                    {tie.aggregate === null ? '' : n(tie.aggregate[index]!)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p
        className={cx('px-3 pt-1 text-xs', tie.winner === null ? 'text-muted' : 'font-semibold')}
        data-testid="bracket-outcome"
      >
        {tieOutcome(tie, legs, locale)}
      </p>
      {extra.map((leg) => (
        <p key={leg.fixture_id} className="px-3 text-xs text-muted" data-testid="bracket-extra">
          {legLine(leg, locale)}
        </p>
      ))}
      <ul className="mt-1 flex flex-wrap gap-x-1 border-t border-default px-1.5">
        {tie.legs.map((leg) => (
          <li key={leg.fixture_id}>
            <Link
              href={`/${locale}/match/${leg.fixture_id}`}
              aria-label={`${legLabel(leg, legs, locale)}: ${legLine(leg, locale)}`}
              className="inline-flex min-h-touch items-center px-1.5 text-xs text-muted hover:text-fg hover:underline"
              data-testid="bracket-leg"
            >
              {legLabel(leg, legs, locale)} ·{' '}
              <time dateTime={leg.kickoff_at} className="ms-1">
                {formatDate(locale, leg.kickoff_at, timeZone, { day: 'numeric', month: 'short' })}
              </time>
              {statusSuffix(locale, leg.status)}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
