import { type Moment, type MomentsResponse, NO_MEDIA, type ScoreCard } from '@fmip/contracts';
import { CompetitionsMenuTrigger } from '@/components/competitions-menu-view';
import { EntityImage } from '@/components/entity-image';
import { ForecastBar, ninetyOutcome } from '@/components/forecast-bar';
import { FORECAST_BAR_KEYS, ForecastBarWithReceipt } from '@/components/forecast-receipt';
import { MessageText } from '@/components/message-text';
import { ModelVersion } from '@/components/model-version';
import {
  type MomentSlot,
  MomentStamp,
  MomentsRailView,
  type MomentsRailProps,
} from '@/components/moments-rail-view';
import { Receipt } from '@/components/receipt';
import { LtrNumeric } from '@/components/score';
import { Button, ButtonLink } from '@/components/ui';
import { LiveBadge } from '@/components/ui/live-badge';
import Link from '@/components/ui/link';
import { formatNumber, formatTime, formatVersionStamp } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, isLocale, isPseudoLocale } from '@/i18n/locales';
import { type Message, message, plural, resolveMessages } from '@/i18n/messages';
import { type ApiResult, fetchMoments } from '@/lib/api';
import { followAction } from '@/lib/auth-actions';
import { awaitingUpdate, isBehind } from '@/lib/live';
import {
  FRESH_ANSWER_MS,
  type KeptAnswer,
  STRIP_ANSWER_MS,
  sharedAnswer,
  stripBehindAt,
  stripIsBehind,
} from '@/lib/live-strip';
import {
  isLiveMoment,
  lineKickoff,
  lineMoment,
  momentEyebrow,
  momentSentence,
  momentWhen,
  momentsAskIn,
  moreVariants,
  panelSentence,
  shownLine,
  teamName,
  winnerOf,
} from '@/lib/moments-rail';
import type { StatusKey } from '@/lib/scores';
import { sessionCookieHeader } from '@/lib/session';
import { stageAndRoundLabels } from '@/lib/stage-label';
import { sharesToPercentages } from '@/lib/triple';
import { filled } from '@/lib/words';

/**
 * The moments rail (T-1642, D-300, replacing D-292's matchday rail and its
 * drawer): the one bar under the header on every page, a handful of today's
 * matches worth a look now, as `GET /moments` picks them (T-1641, D-299).
 * A lead ("● 3 live", what the cards were picked from, Leagues), then a card
 * per moment -- why it is there, both teams and the score, and one sentence
 * from the model's pre-kick-off numbers -- and on a desktop a hover card per
 * card with the forecast, its receipt and the way to the match.
 *
 * One request, `GET /moments` in the reader's zone and language. A guest's
 * answer depends on nothing else, so it is kept and shared for a few seconds
 * per zone and language (`sharedAnswer`), as the matchday rail's was; a
 * member's is asked with the session, which only marks their followed
 * matches, and never shared. Drawn here on the server with the header, so it
 * is there at first paint; the client half (`MomentsRailView`) asks for it
 * again through `refreshRail` (`lib/rail-actions.ts`), which draws it here
 * once more. Nothing is guessed (rule 3): no answer, or no moment, and
 * nothing is drawn; a moment with no forecast has no model line.
 */

const GUEST_ANSWERS = new Map<string, KeptAnswer<ApiResult<MomentsResponse>>>();

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
  'status.awaitingUpdate',
];

/** The language the rail speaks: the page's (the pseudo-locale's is English, marked as such). */
const langOf = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

async function loadAnswer(
  lang: Locale,
  timeZone: string,
  cookie: string | undefined,
  maxAge: number,
): Promise<MomentsResponse | null> {
  // The pseudo-locale reads the English names, as every page's request does.
  const names = isPseudoLocale(lang) ? DEFAULT_LOCALE : lang;
  // `big_one=live`: this rail can say "Big one, live", so the hero stays while played (D-302).
  const query = new URLSearchParams({
    timezone: timeZone,
    locale: names,
    big_one: 'live',
  }).toString();
  const answer = await (
    cookie === undefined
      ? sharedAnswer(
          GUEST_ANSWERS,
          `${timeZone}|${names}`,
          Date.now(),
          () => fetchMoments(query, undefined),
          maxAge,
        )
      : fetchMoments(query, cookie)
  ).catch(() => null);
  return answer !== null && answer.ok ? answer.data : null;
}

/** One team's line on a card: crest, name, and the goals at the inline end. */
function TeamLine({
  lang,
  card,
  side,
  big = false,
}: {
  lang: Locale;
  card: ScoreCard;
  side: 'home' | 'away';
  big?: boolean;
}) {
  const team = card[side];
  const line = shownLine(card);
  const winner = winnerOf(card);
  const result = winner === null ? undefined : winner === side ? 'won' : 'lost';
  return (
    <span
      className={big ? 'moment-team moment-team-big' : 'moment-team'}
      data-side={side}
      data-state={card.status === 'live' ? 'live' : undefined}
      data-result={result}
      data-testid="moment-team"
    >
      <EntityImage media={team.crest} kind="crest" name={team.name} size={big ? 28 : 18} />
      <bdi className="moment-team-name">{teamName(team)}</bdi>
      {line !== null && (
        <b className="moment-goals" data-testid="moment-score">
          {formatNumber(lang, line[side])}
        </b>
      )}
    </span>
  );
}

/** The minute, the kick-off or the result's word; a live minute gives way to "Behind" by CSS. */
function When({
  card,
  lang,
  timeZone,
  now,
  words,
}: {
  card: ScoreCard;
  lang: Locale;
  timeZone: string;
  now: number;
  words: Record<StatusKey, Message>;
}) {
  const when = momentWhen(card, lang, timeZone, now, words);
  if (card.status === 'scheduled') {
    return (
      <time dateTime={card.kickoff_at} className="moment-when" data-testid="moment-when">
        {when.text}
      </time>
    );
  }
  if (when.behind === undefined) {
    return (
      <span className="moment-when" data-testid="moment-when">
        <LtrNumeric>{when.text}</LtrNumeric>
      </span>
    );
  }
  return (
    <>
      <span
        className="moment-when group-data-[behind=true]/moments:hidden"
        data-testid="moment-when"
      >
        <LtrNumeric>{when.text}</LtrNumeric>
      </span>
      <span className="moment-when hidden text-warning group-data-[behind=true]/moments:inline">
        {when.behind}
      </span>
    </>
  );
}

interface Drawing {
  locale: string;
  lang: Locale;
  timeZone: string;
  now: number;
  signedIn: boolean;
  generatedAt: string;
  words: Record<StatusKey, Message>;
}

/** A moment's card: a link to the match. */
function MomentCard({ moment, first, d }: { moment: Moment; first: boolean; d: Drawing }) {
  const card = moment.fixture;
  const sentence = momentSentence(moment, d.lang);
  const inPlay = card.status === 'live' || card.status === 'suspended';
  const behindNow = isBehind(card, d.now);
  return (
    <Link
      href={`/${d.locale}/match/${card.id}`}
      className="moment-card focus-inset"
      data-first={first ? 'true' : undefined}
      data-testid="moment-card"
    >
      <span
        className="moment-eyebrow"
        data-tone={isLiveMoment(moment) ? 'live' : 'calm'}
        data-testid="moment-eyebrow"
      >
        <EntityImage
          media={card.competition.logo ?? NO_MEDIA}
          kind="logo"
          name={card.competition.name}
          size={14}
        />
        <span className="min-w-0 flex-1 truncate">
          <MessageText message={momentEyebrow(moment, d.lang, d.timeZone, d.now)} />
        </span>
        <When card={card} lang={d.lang} timeZone={d.timeZone} now={d.now} words={d.words} />
      </span>
      <TeamLine lang={d.lang} card={card} side="home" />
      <TeamLine lang={d.lang} card={card} side="away" />
      {sentence !== null && (
        <span className="moment-model" data-testid="moment-model">
          <span className="moment-tag">
            <MessageText message={message(d.lang, 'home.modelTag')} />
          </span>
          <span className="line-clamp-2">
            <MessageText message={sentence} />
          </span>
        </span>
      )}
      {inPlay && (
        // Rule 4: the card's own data stopped (the API's word, or its age), or
        // the rail's answers stopped coming (`data-behind`, by CSS).
        <span
          className={
            behindNow
              ? 'moment-behind'
              : 'moment-behind hidden group-data-[behind=true]/moments:block'
          }
          data-testid="moment-behind"
        >
          <MessageText message={message(d.lang, 'shell.moments.behind')} />
        </span>
      )}
    </Link>
  );
}

/** A moment's hover card: the forecast as it stood before kick-off, and the way on. */
function MomentPanel({ moment, d }: { moment: Moment; d: Drawing }) {
  const card = moment.fixture;
  const titleId = `moment-${card.id}-title`;
  const rounds = stageAndRoundLabels(
    card.stage?.name,
    card.round,
    (key) => message(d.lang, key).text,
    d.lang,
  );
  const live = card.status === 'live';
  const when = momentWhen(card, d.lang, d.timeZone, d.now, d.words);
  const barWords = resolveMessages(d.lang, FORECAST_BAR_KEYS);
  const forecast = moment.forecast;
  const said = panelSentence(moment, d.lang);
  const name = { home: teamName(card.home), away: teamName(card.away) };
  // The team the moment is about (the leader, the favourite, the winner), else the home side.
  const team = card[moment.side ?? 'home'];
  const follow = d.signedIn && !moment.followed;
  const behindAt = stripBehindAt([card], d.generatedAt);
  return (
    <div className="moment-panel" role="group" aria-labelledby={titleId} data-testid="moment-panel">
      <div className="flex items-center justify-between gap-3">
        <p id={titleId} className="moment-panel-eyebrow">
          <bdi>{card.competition.name}</bdi>
          {rounds.map((round) => ` · ${round}`).join('')}
        </p>
        {live ? (
          <LiveBadge
            label={card.minute === null ? undefined : d.words['status.live'].text}
            className="shrink-0"
          >
            <LtrNumeric>{when.text}</LtrNumeric>
          </LiveBadge>
        ) : (
          <span className="moment-when shrink-0" data-testid="moment-panel-when">
            {when.text}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <TeamLine lang={d.lang} card={card} side="home" big />
        <TeamLine lang={d.lang} card={card} side="away" big />
      </div>
      {forecast !== null && said !== null ? (
        <div className="flex flex-col gap-2" data-testid="moment-panel-model">
          <p className="text-sm text-fg">
            <MessageText message={said} />
          </p>
          {/* The one bar at card size (T-1748); the receipt under it is the panel's own. */}
          <ForecastBar
            forecast={sharesToPercentages(forecast)}
            home={name.home}
            away={name.away}
            outcome={ninetyOutcome(card)}
            locale={d.lang}
            words={barWords}
            testId="moment-panel-bar"
          />
          <Receipt
            testId="moment-panel-receipt"
            items={[
              <span key="model" dir="ltr">
                <ModelVersion version={forecast.model_version} />
              </span>,
              <MessageText key="last" message={message(d.lang, 'shell.moments.card.lastBefore')} />,
              <time key="at" dateTime={forecast.computed_at}>
                {formatVersionStamp(d.lang, forecast.computed_at, d.timeZone)}
              </time>,
            ]}
          />
        </div>
      ) : (
        // Rule 3: no forecast is a sentence, never an empty bar.
        <ForecastBarWithReceipt
          forecast={{ state: 'none' }}
          started={card.status !== 'scheduled' || awaitingUpdate(card)}
          home={name.home}
          away={name.away}
          locale={d.lang}
          timeZone={d.timeZone}
          words={barWords}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <ButtonLink
          href={`/${d.locale}/match/${card.id}`}
          variant="primary"
          size="md"
          data-testid="moment-panel-open"
        >
          <MessageText message={message(d.lang, 'shell.moments.card.open')} />
        </ButtonLink>
        {follow && (
          <form action={followAction.bind(null, d.locale)} data-testid="moment-panel-follow">
            <input type="hidden" name="entity_type" value="team" />
            <input type="hidden" name="entity_id" value={team.id} />
            <Button type="submit" variant="secondary" size="md">
              <MessageText
                message={filled(message(d.lang, 'shell.moments.card.follow'), {
                  team: teamName(team),
                })}
              />
            </Button>
          </form>
        )}
      </div>
      <MomentStamp
        key={d.generatedAt}
        locale={d.lang}
        checkedAt={d.generatedAt}
        behindAt={behindAt}
        behind={isBehind(card, d.now)}
        words={{
          'freshness.checked': filled(message(d.lang, 'shell.moments.card.updated'), {
            time: formatTime(d.lang, d.generatedAt, d.timeZone),
          }),
          'freshness.behind': message(d.lang, 'freshness.behind'),
        }}
      />
    </div>
  );
}

/**
 * The folded rail's one line (T-1755, D-372; board P4-5): "● 4 live ·
 * Sevilla 0–0 Alavés 86′" -- the count, then the first match in play with
 * its goals and minute, or, with none in play, the next kick-off ("Sparta v
 * Bournemouth 17:45"). Names are whole or absent: the match sits over the
 * words "Moments that matter" on the surface, in a one-line box that clips,
 * after a zero-width strut, so a match too long for the line wraps out of
 * sight and the words under it show (`.moments-line` in globals.css; no
 * script, nothing measured here). A screen reader hears the match, never
 * both. Rule 4: when the card's data stopped, or the rail's answers did
 * (`data-behind`, by CSS), the minute gives way to "May be behind", beside
 * the match rather than in it, so the words show even when the names do not.
 */
function RailLine({ moments, live, d }: { moments: readonly Moment[]; live: number; d: Drawing }) {
  const named = lineMoment(moments);
  const card = named?.fixture ?? null;
  const goals = card === null ? null : shownLine(card);
  const inPlay = card !== null && isLiveMoment({ fixture: card });
  const stopped = inPlay && isBehind(card, d.now);
  return (
    <>
      <span className="moments-live" data-count={live} data-testid="moments-line-live">
        <span aria-hidden="true" className={live > 0 ? 'live-dot moments-dot' : 'moments-dot'} />
        <MessageText message={plural(d.lang, 'shell.moments.live', live)} />
      </span>
      <span aria-hidden="true" className="text-caption">
        ·
      </span>
      <span className="moments-line" data-testid="moments-line">
        <span
          className="moments-summary-label"
          aria-hidden={card === null ? undefined : 'true'}
          data-testid="moments-line-label"
        >
          <MessageText message={message(d.lang, 'shell.moments.label')} />
        </span>
        {card !== null && (
          <span className="moments-line-box">
            <span className="moments-line-match" data-testid="moments-line-match">
              <bdi>{teamName(card.home)}</bdi>{' '}
              {inPlay && goals !== null ? (
                <b className="tabular-nums">
                  {formatNumber(d.lang, goals.home)}–{formatNumber(d.lang, goals.away)}
                </b>
              ) : (
                <span className="text-caption">
                  <MessageText message={message(d.lang, 'home.versus')} />
                </span>
              )}{' '}
              <bdi>{teamName(card.away)}</bdi>
              {inPlay ? (
                !stopped && (
                  <span
                    className="moments-line-when text-live group-data-[behind=true]/moments:hidden"
                    data-testid="moments-line-when"
                  >
                    <LtrNumeric>
                      {momentWhen(card, d.lang, d.timeZone, d.now, d.words).text}
                    </LtrNumeric>
                  </span>
                )
              ) : (
                <time
                  dateTime={card.kickoff_at}
                  className="moments-line-when text-muted"
                  data-testid="moments-line-when"
                >
                  {lineKickoff(card, d.lang, d.timeZone, d.now, d.words)}
                </time>
              )}
            </span>
          </span>
        )}
      </span>
      {inPlay && (
        <span
          className={
            stopped
              ? 'moments-line-behind'
              : 'moments-line-behind hidden group-data-[behind=true]/moments:inline'
          }
          data-testid="moments-line-behind"
        >
          <MessageText message={message(d.lang, 'shell.moments.behind')} />
        </span>
      )}
    </>
  );
}

/**
 * The rail drawn from its answer, a plain function so the spec can hand it
 * an answer and a clock (`moments-rail.spec.tsx`). `locale` builds the
 * addresses (the pseudo-locale keeps its own); the words are `lang`'s.
 */
export function momentsView({
  locale,
  timeZone,
  signedIn,
  answer,
  now,
}: {
  locale: string;
  timeZone: string;
  signedIn: boolean;
  answer: MomentsResponse | null;
  now: number;
}): MomentsRailProps {
  const lang = langOf(locale);
  const moments = answer?.moments ?? [];
  const cards = moments.map((moment) => moment.fixture);
  const base = {
    locale,
    timeZone,
    signedIn,
    askIn: momentsAskIn(answer, now),
    behindAt: answer === null ? null : stripBehindAt(cards, answer.generated_at),
    behind: answer !== null && stripIsBehind(cards, answer.generated_at, now),
  };
  if (answer === null || moments.length === 0) {
    return { ...base, title: null, lead: null, summary: null, moments: [], more: null };
  }
  const d: Drawing = {
    locale,
    lang,
    timeZone,
    now,
    signedIn,
    generatedAt: answer.generated_at,
    words: resolveMessages(lang, STATUS_KEYS),
  };
  const live = answer.live_count;
  const slots: MomentSlot[] = moments.map((moment, i) => ({
    id: moment.fixture.id,
    kind: moment.kind,
    card: <MomentCard moment={moment} first={i === 0} d={d} />,
    panel: <MomentPanel moment={moment} d={d} />,
  }));
  return {
    ...base,
    title: <MessageText message={message(lang, 'shell.moments.label')} />,
    lead: (
      <div className="moments-lead" data-testid="moments-lead">
        <p className="moments-live" data-count={live} data-testid="moments-live">
          <span aria-hidden="true" className={live > 0 ? 'live-dot moments-dot' : 'moments-dot'} />
          <MessageText message={plural(lang, 'shell.moments.live', live)} />
        </p>
        <p className="moments-picked" data-testid="moments-picked">
          <MessageText message={plural(lang, 'shell.moments.picked', answer.today_count)} />
        </p>
        {/* From 1024px the button that opens the competitions menu (T-1643, D-301). */}
        <CompetitionsMenuTrigger
          href={`/${locale}/competitions`}
          current={false}
          className="moments-leagues focus-inset"
          testId="moments-leagues"
        >
          <MessageText message={message(lang, 'shell.tab.leagues')} />
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
            →
          </span>
        </CompetitionsMenuTrigger>
      </div>
    ),
    // The slim line on a phone, every page but home (T-1693, D-338; T-1755,
    // D-372): the button that unfolds the rail in place.
    summary: <RailLine moments={moments} live={live} d={d} />,
    moments: slots,
    more: (
      <div className="moments-more-slot">
        {moreVariants(moments.length).map(({ shown, more }) => {
          const label = plural(lang, 'shell.moments.moreLabel', more);
          return (
            <Link
              key={shown}
              href={`/${locale}/scores`}
              className="moments-more focus-inset"
              aria-label={label.text}
              lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
              data-shown={shown}
              data-testid="moments-more"
            >
              <MessageText message={plural(lang, 'shell.moments.more', more)} />
              <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
                →
              </span>
            </Link>
          );
        })}
      </div>
    ),
  };
}

/**
 * The rail's answer and the moment it is judged at. A plain function, not a
 * component: it reads the clock, once per request. `fresh` (asked again
 * because the page's own stream saw a match move, T-1635): a guest's kept
 * answer may be at most `FRESH_ANSWER_MS` old.
 */
export async function loadMoments(
  rail: { locale: string; timeZone: string; signedIn: boolean },
  { fresh = false }: { fresh?: boolean } = {},
): Promise<MomentsRailProps> {
  const lang = langOf(rail.locale);
  const cookie = rail.signedIn ? await sessionCookieHeader() : undefined;
  const answer = await loadAnswer(
    lang,
    rail.timeZone,
    cookie,
    fresh ? FRESH_ANSWER_MS : STRIP_ANSWER_MS,
  );
  return momentsView({ ...rail, answer, now: Date.now() });
}

export async function MomentsRail(props: { locale: string; timeZone: string; signedIn: boolean }) {
  return <MomentsRailView {...await loadMoments(props)} />;
}
