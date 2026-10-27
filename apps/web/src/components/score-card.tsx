import type { CoverageState, ScoreCard as ScoreCardData, ScoreCardIncident } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { formatNumber } from '@/i18n/format';
import { isBehind } from '@/lib/live';
import { shootoutStart } from '@/lib/match';
import { formatKickoff, formatStamp, scoreLine, statusLabel } from '@/lib/scores';
import { isOpenForPick } from '@/lib/scores-filters';
import type { CardCommunity, CardForecast, CardViewing } from '@/lib/score-card-products';
import { stageAndRoundLabels } from '@/lib/stage-label';
import { fill, filled, formatMinute, pickPlural } from '@/lib/words';
import type { ScoresWords } from '@/lib/words-server';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { pairIsolate } from '@/components/score';
import { CardCommunityTotals } from '@/components/score-card-community';
import { CardForecastSummary, RowForecast } from '@/components/score-card-forecast';
import { Icon } from '@/components/ui/icons';

const INCIDENT_KEY = {
  goal: 'matchCentre.incident.goal',
  own_goal: 'matchCentre.incident.ownGoal',
  penalty_goal: 'matchCentre.incident.penaltyGoal',
  penalty_missed: 'matchCentre.incident.penaltyMissed',
  red_card: 'matchCentre.incident.redCard',
  second_yellow_card: 'matchCentre.incident.secondYellow',
  var: 'matchCentre.incident.var',
} as const satisfies Record<ScoreCardIncident['kind'], string>;

/** A coverage state in the glossary's words (T-1303). */
export const COVERAGE_KEY = {
  available: 'status.coverage.available',
  limited: 'status.coverage.limited',
  not_supplied: 'status.coverage.notSupplied',
  delayed: 'status.coverage.delayed',
} as const satisfies Record<CoverageState, string>;

/**
 * One match on the matches page (blueprint 4.1), in the Stadiomind design
 * (T-1496, the Design System's `MatchRow`): the status or clock, both teams
 * stacked, home first, each with its crest and, once the match has started,
 * its own goals at the line's end, so a score always sits beside its own
 * team in either direction; then the model's three percentages (or "Not
 * supplied", never an empty bar, rule 3) and the Pick action. Below 640 px
 * the model's cell drops under the teams (T-1545): beside them it left a
 * name 21 to 51 px, so "Paykan" broke in two and "Crystal Palace" read
 * "Cry st…".
 *
 * The status and the teams are one link to the match centre, at least 44px
 * tall. Pick is its own link: it opens the page's preview of this match with
 * the pick form (`?pick=`), the side column on a desktop and above the list on
 * a phone. Two things the row never hides: a leg or an aggregate (it changes
 * what the score means) and a feed that is behind (rule 4). Everything else
 * the old card folded behind a disclosure -- kick-off and venue, goals and
 * cards, the model's version, the community's line, where to watch, the
 * coverage and the update time -- is the preview's (`CardDetails`).
 *
 * Every word is the reader's (T-1303): this renders inside a client
 * component, so the page resolves the words on the server and hands them down.
 */
/**
 * A team's name wraps onto a second line before it is cut: at 360 px one line
 * left "Nassaji Maz…" and "Aluminium …" on a real match day (T-1202). On a
 * phone it is a step smaller, so a word fits its column before it breaks.
 */
const NAME = 'line-clamp-2 break-words leading-tight max-sm:text-sm';

/** Where the row's Pick stands for this reader (T-1496, D-206's lock at kick-off). */
export type RowPick = 'open' | 'picked' | 'locked' | 'locked-picked';

export function rowPick(
  card: Pick<ScoreCardData, 'status' | 'kickoff_at'>,
  picked: boolean,
  now: number = Date.now(),
): RowPick {
  if (isOpenForPick(card, now)) return picked ? 'picked' : 'open';
  return picked ? 'locked-picked' : 'locked';
}

const PICK_WORD = {
  open: 'scores.row.pick',
  picked: 'scores.row.picked',
  locked: 'scores.row.view',
  'locked-picked': 'scores.row.picked',
} as const satisfies Record<RowPick, string>;

const PICK_LABEL = {
  open: 'scores.row.pickLabel',
  picked: 'scores.row.pickedLabel',
  locked: 'scores.row.viewLabel',
  'locked-picked': 'scores.row.pickedLabel',
} as const satisfies Record<RowPick, string>;

export function ScoreCard({
  card,
  timeZone,
  locale,
  now,
  showCompetition = false,
  forecast,
  picked = false,
  selected = false,
  pickHref,
  words,
}: {
  card: ScoreCardData;
  timeZone: string;
  locale: string;
  /** The client clock, ms since epoch, so a feed that stops is caught (T-083). */
  now?: number;
  /** In the favourites block, where no competition heading says it. */
  showCompetition?: boolean;
  /**
   * The model's latest pre-kick-off version (T-940, D-114), from its own
   * batch. Absent (a match the stream added after the page loaded) is said,
   * never drawn empty.
   */
  forecast?: CardForecast;
  /** The reader has a standing pick on this match (T-1496). */
  picked?: boolean;
  /** This match's preview is the one open. */
  selected?: boolean;
  /** Where Pick leads: this page with this match's preview open. Absent: no Pick. */
  pickHref?: string;
  /** The reader's words, resolved on the server (T-1303). */
  words: ScoresWords;
}) {
  const { m, p } = words;
  const n = (value: number): string => formatNumber(locale, value);
  const behind = now !== undefined && isBehind(card, now);
  // The red-card mark is an image to a screen reader, named in words (T-081).
  const sentOff = (count: number): React.ReactNode =>
    count === 0 ? null : (
      <span
        role="img"
        aria-label={
          count === 1
            ? m['scores.card.redCard'].text
            : pickPlural(p['scores.card.redCards'], locale, count).text
        }
        className="shrink-0"
      >
        {count === 1 ? '🟥' : `🟥×${n(count)}`}
      </span>
    );
  const leg = card.leg === null ? null : fill(m['scores.card.leg'].text, { leg: n(card.leg) });
  const aggregate =
    card.scores.aggregate === null
      ? null
      : fill(m['scores.card.aggregate'].text, {
          score: pairIsolate(
            locale,
            `${n(card.scores.aggregate.home)}–${n(card.scores.aggregate.away)}`,
          ),
        });
  // The shoot-out decides a tie the full-time score leaves level (T-1477).
  const shootout =
    card.scores.penalties === null
      ? null
      : fill(m['scores.card.penalties'].text, {
          score: pairIsolate(
            locale,
            `${n(card.scores.penalties.home)}–${n(card.scores.penalties.away)}`,
          ),
        });
  // What stays on the row under the teams: what changes the score's meaning.
  const rowBits = [showCompetition ? card.competition.name : null, leg, aggregate, shootout].filter(
    (bit): bit is string => bit !== null,
  );
  const live = card.status === 'live';
  const line = scoreLine(card);
  // At full time the winner is bold and the loser muted; a draw keeps both in ink.
  const weight = (side: 'home' | 'away'): string => {
    if (card.status !== 'finished' || line === null || line.home === line.away) {
      return 'font-semibold';
    }
    const won = side === 'home' ? line.home > line.away : line.away > line.home;
    return won ? 'font-bold' : 'font-medium text-muted';
  };
  const team = (side: 'home' | 'away') => {
    const t = card[side];
    return (
      <span className="flex min-w-0 items-center gap-2" data-testid={`${side}-team`}>
        <EntityImage media={t.crest} kind="crest" name={t.name} size={20} />
        <bdi className={`${NAME} ${weight(side)}`} title={t.name}>
          {t.name}
        </bdi>
        {sentOff(card.red_cards[side])}
        {line !== null && (
          <span
            className={`ms-auto shrink-0 ps-2 font-bold tabular-nums ${live ? 'text-live' : ''}`}
            data-testid={`${side}-score`}
          >
            {n(line[side])}
          </span>
        )}
      </span>
    );
  };
  const pick = rowPick(card, picked, now);
  const mine = pick === 'picked' || pick === 'locked-picked';

  return (
    <li
      className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-2.5 px-4 data-selected:bg-selected sm:grid-cols-[3.25rem_minmax(0,1fr)_13rem_4.5rem] sm:gap-x-3.5"
      data-testid="score-card"
      data-fixture-id={card.id}
      data-status={card.status}
      data-selected={selected ? '' : undefined}
      aria-current={selected ? 'true' : undefined}
    >
      <Link
        href={`/${locale}/match/${card.id}`}
        className="col-span-2 grid min-h-11 grid-cols-subgrid items-center py-2.5 hover:[&_bdi]:underline max-sm:row-start-1 max-sm:pb-1.5"
        data-testid="match-link"
      >
        <span
          className={`text-sm leading-tight font-bold tabular-nums hyphens-auto [overflow-wrap:anywhere] ${live ? 'text-live' : ''}`}
          data-testid="score-status"
        >
          {statusLabel(card, locale, timeZone, now, m)}
        </span>
        <span className="flex min-w-0 flex-col gap-1 sm:font-stretch-semi-condensed">
          {team('home')}
          {team('away')}
          {rowBits.length > 0 && (
            <span className="truncate text-xs text-muted" data-testid="row-meta">
              {rowBits.join(' · ')}
            </span>
          )}
        </span>
      </Link>

      <RowForecast
        forecast={forecast}
        home={card.home.name}
        away={card.away.name}
        locale={locale}
        words={words}
        className="max-sm:col-start-2 max-sm:row-start-2 max-sm:pb-2.5"
      />

      {pickHref === undefined ? (
        <span className="max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1" />
      ) : (
        <Link
          href={pickHref}
          scroll={false}
          aria-label={
            filled(m[PICK_LABEL[pick]], { home: card.home.name, away: card.away.name }).text
          }
          className={`inline-flex min-h-11 items-center justify-center gap-1 justify-self-end rounded-control px-2.5 text-sm font-bold whitespace-nowrap max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1 ${
            selected
              ? 'bg-brand text-on-brand'
              : mine
                ? 'text-live'
                : 'border border-default hover:bg-surface-raised'
          }`}
          data-testid="row-pick"
          data-pick={pick}
        >
          {mine && <Icon name={pick === 'picked' ? 'check' : 'lock'} size={14} />}
          <MessageText message={m[PICK_WORD[pick]]} />
        </Link>
      )}

      {behind && (
        <p
          role="status"
          className="col-span-full pb-2 text-xs font-medium text-warning"
          data-testid="behind"
        >
          <FilledMessage
            message={m['scores.card.behind']}
            params={{
              time: (
                <time dateTime={card.last_updated_at}>
                  {formatStamp(locale, card.last_updated_at, timeZone, now)}
                </time>
              ),
            }}
          />
        </p>
      )}
    </li>
  );
}

/**
 * What the old card kept behind its disclosure (T-605), now the preview's
 * (T-1496): competition, stage, kick-off and venue, goals and cards, the
 * model's line with its version and time, the community's line -- only once
 * the reader has picked or kick-off has locked every pick (D-206) -- where to
 * watch, and the coverage and update time. Two prediction products, two
 * lines, two components (rule 6). Safe on the server and in a client bundle.
 */
export function CardDetails({
  card,
  timeZone,
  locale,
  now,
  forecast,
  community,
  viewing,
  revealed,
  model = true,
  words,
}: {
  card: ScoreCardData;
  timeZone: string;
  locale: string;
  now?: number;
  forecast?: CardForecast;
  community?: CardCommunity;
  viewing?: CardViewing;
  /** The reader has picked, or kick-off has locked every pick: the community may be shown. */
  revealed: boolean;
  /** The model's line; off where the model's own bar and receipt stand beside it. */
  model?: boolean;
  words: ScoresWords;
}) {
  const { m } = words;
  const n = (value: number): string => formatNumber(locale, value);
  const kicksFrom = shootoutStart(card.incidents, card.scores.penalties);
  const leg = card.leg === null ? null : fill(m['scores.card.leg'].text, { leg: n(card.leg) });
  const stageBits = [
    ...stageAndRoundLabels(card.stage?.name, card.round, (key) => m[key].text, locale),
    leg,
  ].filter((bit): bit is string => typeof bit === 'string' && bit !== '');
  // A freshness time on another day says which (T-1371).
  const at = (iso: string) => <time dateTime={iso}>{formatStamp(locale, iso, timeZone, now)}</time>;
  return (
    <div className="flex flex-col gap-1.5 text-xs" data-testid="card-details">
      <p className="flex flex-wrap gap-x-3 text-muted">
        <span>{card.competition.name}</span>
        {stageBits.map((bit) => (
          <span key={bit}>{bit}</span>
        ))}
        <span>
          <FilledMessage
            message={m['scores.card.kickoff']}
            params={{
              time: (
                <time dateTime={card.kickoff_at}>
                  {formatKickoff(locale, card.kickoff_at, timeZone)}
                </time>
              ),
            }}
          />
        </span>
        {card.venue !== null && (
          <span>
            {card.venue.city === null ? card.venue.name : `${card.venue.name}, ${card.venue.city}`}
          </span>
        )}
      </p>

      {card.incidents.length > 0 && (
        <ul className="flex flex-wrap gap-x-3" data-testid="incidents">
          {card.incidents.map((incident, index) => (
            <li key={index}>
              {/* A shoot-out kick is numbered, never given a minute of play (T-1477). */}
              {kicksFrom !== null && index >= kicksFrom ? (
                fill(m['scores.card.kick'].text, { n: n(index - kicksFrom + 1) })
              ) : (
                <span dir="ltr">{formatMinute(locale, incident.minute, incident.added_time)}</span>
              )}{' '}
              <MessageText message={m[INCIDENT_KEY[incident.kind]]} />
              {incident.player !== null ? ` · ${incident.player}` : ''}
              {incident.side !== null
                ? ` (${incident.side === 'home' ? card.home.name : card.away.name})`
                : ''}
            </li>
          ))}
        </ul>
      )}

      {/* Two prediction products, two lines, two components (rule 6). */}
      {model && (
        <CardForecastSummary
          forecast={forecast}
          home={card.home.name}
          away={card.away.name}
          started={card.status !== 'scheduled'}
          locale={locale}
          timeZone={timeZone}
          words={words}
        />
      )}
      {revealed ? (
        <CardCommunityTotals
          community={community}
          home={card.home.name}
          away={card.away.name}
          words={words}
        />
      ) : (
        <p className="text-muted" data-testid="card-community" data-state="sealed">
          <MessageText message={m['scores.row.communitySealed']} />
        </p>
      )}
      <CardViewingLine viewing={viewing} locale={locale} words={words} />

      <p className="flex flex-wrap gap-x-3 text-muted" data-testid="card-labels">
        <span>
          <MessageText
            message={filled(m['scores.card.coverage'], {
              state: m[COVERAGE_KEY[card.coverage]].text,
            })}
          />
        </span>
        <span>
          <FilledMessage
            message={m['scores.updated']}
            params={{ time: at(card.last_updated_at) }}
          />
        </span>
      </p>
    </div>
  );
}

/**
 * Where the match can be watched in the viewer's territory (T-940, blueprint
 * 11): a count of listings, or the sentence for why there is none. Nobody's
 * territory is guessed; without one, the line asks (T-312).
 */
/** The viewing line's words for a caller that does not pass the reader's yet. */
const ENGLISH_VIEWING: Pick<ScoresWords, 'm' | 'p'> = {
  m: Object.fromEntries(
    Object.entries({
      'scores.card.watch': 'Watch:',
      'scores.card.oneListing': 'one listing in {territory}',
      'scores.card.nothingListed': 'nothing listed in {territory}.',
      'scores.card.noSchedule': 'no schedule covers this match in {territory}.',
      'scores.card.chooseTerritory': 'choose your territory',
      'scores.card.unreachable': 'could not be loaded for this page.',
      'scores.card.notLoaded': 'not loaded for this list.',
    }).map(([key, text]) => [key, { text, status: 'source' }]),
  ) as ScoresWords['m'],
  p: {
    'scores.card.listings': {
      forms: { one: '{count} listing in {territory}', other: '{count} listings in {territory}' },
      rules: 'en-GB',
      status: 'source',
    },
  } as ScoresWords['p'],
};

export function CardViewingLine({
  viewing,
  locale,
  words = ENGLISH_VIEWING,
}: {
  viewing: CardViewing | undefined;
  locale: string;
  /** The reader's words (T-1303); the English when a caller has none yet. */
  words?: Pick<ScoresWords, 'm' | 'p'>;
}) {
  const v = viewing ?? { state: 'not_loaded' as const };
  const { m, p } = words;
  return (
    <p className="flex flex-wrap gap-x-2" data-testid="card-viewing" data-state={v.state}>
      <MessageText message={m['scores.card.watch']} className="font-medium" />
      {v.state === 'listed' ? (
        <span>
          <MessageText
            message={
              v.count === 1
                ? filled(m['scores.card.oneListing'], { territory: v.territory })
                : pickPlural(p['scores.card.listings'], locale, v.count, {
                    territory: v.territory,
                  })
            }
          />
        </span>
      ) : v.state === 'nothing_listed' ? (
        <MessageText
          className="text-muted"
          message={filled(m['scores.card.nothingListed'], { territory: v.territory })}
        />
      ) : v.state === 'not_supplied' ? (
        <MessageText
          className="text-muted"
          message={filled(m['scores.card.noSchedule'], { territory: v.territory })}
        />
      ) : v.state === 'ask' ? (
        <Link href={`/${locale}/watch`} className="underline" data-testid="card-viewing-ask">
          <MessageText message={m['scores.card.chooseTerritory']} />
        </Link>
      ) : v.state === 'unreachable' ? (
        <MessageText className="text-muted" message={m['scores.card.unreachable']} />
      ) : (
        <MessageText className="text-muted" message={m['scores.card.notLoaded']} />
      )}
    </p>
  );
}
