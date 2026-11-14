import type {
  AuthUser,
  CommunityConsensusResponse,
  PendingPick,
  Prediction,
  ScoreCard,
} from '@fmip/contracts';
import Link from '@/components/ui/link';
import { CommunitySplit } from '@/components/community-consensus';
import { EntityImage } from '@/components/entity-image';
import { ForecastBarWithReceipt, type ForecastBarWords } from '@/components/forecast-receipt';
import { ModelBox } from '@/components/model-box';
import { PickControl } from '@/components/pick-control';
import { FilledMessage } from '@/components/filled-message';
import { CardDetails } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { Icon } from '@/components/ui';
import { formatDate, formatNumber } from '@/i18n/format';
import { attribute } from '@/i18n/messages';
import { awaitingUpdate } from '@/lib/live';
import { isLocked } from '@/lib/prediction-form';
import { asLocale, matchTitle } from '@/lib/prediction-text';
import type { CardCommunity, CardForecast, CardViewing } from '@/lib/score-card-products';
import { formatKickoff, formatStamp, scoreLine, statusLabel } from '@/lib/scores';
import type { ScoresWords } from '@/lib/words-server';

/**
 * The matches page's preview of one match, with the pick control (T-1496, the
 * canvas's side column; T-1738, D-359): which match, both teams, "Your pick"
 * -- `PickControl`, the three outcomes at once in its four states -- with the
 * model's box under it, its version and time beside the pick and never mixed
 * in (rule 6), the full match page, and what the row leaves out
 * (`CardDetails`).
 *
 * The community's split is handed to the control only for a member or after
 * kick-off, and the control shows it only once the reader has picked (D-206):
 * before that it is not on the page at all, so it cannot anchor the pick.
 *
 * Below 1024px, where there is no side column, this is a bottom sheet over
 * the list (T-1738): fixed to the bottom edge, at most 70% of the viewport
 * high and scrolling inside itself, over a scrim, with its heading and the
 * 44px close control held at its top. It is on the page only while the
 * address carries `?pick=` -- the row's Pick is a link there and the close
 * control and the scrim are links back, both to the row's own anchor and
 * without scrolling -- so the list stays where it was and no script or state
 * opens it. Accepted with that (D-359): Back closes it, there is no
 * swipe-to-close, the page behind still scrolls and focus is not trapped.
 * (The form used to stand above the list, out of sight of the row that asked
 * for it: review finding A-01.)
 *
 * T-1545: once the match has started the status stands under the score (a
 * live 1–1 read as a final one without it) with, while it is live, the time
 * the score was last updated, since the preview is the page's snapshot and
 * the list's stream does not reach it (rule 4). A guest after kick-off is told
 * picks are locked rather than shown an empty "Your pick".
 */
export function MatchPreview({
  card,
  locale,
  timeZone,
  zone,
  me,
  current,
  pending = null,
  consensus,
  forecast,
  community,
  viewing,
  closeHref,
  now,
  words,
  forecastWords,
}: {
  card: ScoreCard;
  locale: string;
  timeZone: string;
  /** The zone in words, said after the model's computation time. */
  zone: string;
  me: AuthUser | null;
  current: Prediction | null;
  /**
   * The member's pick saved before their email address was confirmed
   * (T-1740, D-361), or `null`: the control's pending and "Saved, not
   * counted" states. Never part of the split or the community's line.
   */
  pending?: Pick<PendingPick, 'outcome' | 'status'> | null;
  /** The match's consensus, or `null` when the service did not answer. */
  consensus: CommunityConsensusResponse | null;
  forecast: CardForecast | undefined;
  community: CardCommunity | undefined;
  viewing: CardViewing | undefined;
  /** The page without this preview; absent where the preview was not asked for. */
  closeHref?: string;
  /** The page's clock, ms since epoch: a status that is behind says so (T-083). */
  now: number;
  words: ScoresWords;
  forecastWords: ForecastBarWords;
}) {
  const l = asLocale(locale);
  const locked = current?.locked ?? isLocked(card.kickoff_at);
  // A member may pick, and the form reveals the split once they have; after
  // kick-off every pick is locked and the split is anyone's (D-206).
  const revealed = locked || current !== null;
  const line = scoreLine(card);
  const started = card.status !== 'scheduled';
  // Kick-off long past with no word from the feed (T-1713, D-343): the status
  // says so under the "v" rather than leaving the header's time to read as
  // a match still to come.
  const awaiting = awaitingUpdate(card);
  // Nothing but the two names to show yet: the sheet says them on one line.
  const compact = !started && !awaiting;
  const live = card.status === 'live';
  // The recorded goals disagree with the result (T-1717, D-347): the score is
  // drawn quiet and said to be unclear, neither number as final. Stored scores
  // that contradict each other (T-1819, D-414) are said to be unclear with no
  // number at all: the API has withheld them.
  const disputed =
    card.status === 'finished' && (card.score_dispute != null || card.score_conflict != null);
  const when = `${formatDate(locale, card.kickoff_at, timeZone, { weekday: 'short' })} ${formatKickoff(locale, card.kickoff_at, timeZone)}`;
  const close = attribute(l, 'scores.preview.close');
  const side = (which: 'home' | 'away') => (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <EntityImage
        media={card[which].crest}
        kind="crest"
        name={card[which].name}
        size={48}
        aboveFold
      />
      <bdi className="text-base leading-tight font-extrabold break-words">{card[which].name}</bdi>
    </div>
  );

  return (
    <>
      {/* The sheet's scrim, below 1024px only: dims the list and closes on a
          press. The close control beside the heading is the named way out,
          so this one is kept from the keyboard and from a screen reader. */}
      {closeHref !== undefined && (
        <Link
          href={closeHref}
          scroll={false}
          aria-hidden="true"
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-on-brand/50 lg:hidden"
          data-testid="preview-scrim"
        />
      )}
      <section
        id="pick"
        aria-labelledby="preview-title"
        className="flex flex-col rounded-2xl border border-default bg-surface max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:max-h-[70dvh] max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:rounded-b-none max-lg:border-x-0 max-lg:border-b-0 max-lg:pb-[env(safe-area-inset-bottom)] lg:overflow-clip"
        data-testid="match-preview"
        data-fixture-id={card.id}
      >
        <div className="flex min-h-11 items-center gap-2 border-b border-default bg-surface ps-4.5 pe-1 text-xs text-muted max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:rounded-t-2xl">
          <div className="flex min-w-0 flex-col gap-0.5 py-2.5">
            <p>
              <bdi>{card.competition.name}</bdi>
              {' · '}
              <time dateTime={card.kickoff_at}>{when}</time>
              {card.venue !== null && (
                <>
                  {' · '}
                  <bdi>{card.venue.name}</bdi>
                </>
              )}
            </p>
            {/* The sheet names the match on one line; the crests and the score
                block below stand in for it from 1024px, and at any width once
                there is a score or a status to show. */}
            {compact && (
              <p className="text-sm font-extrabold text-fg lg:hidden" data-testid="preview-teams">
                <bdi>{card.home.name}</bdi>{' '}
                <span className="font-normal text-caption">
                  <Translated locale={l} message="scores.preview.versus" />
                </span>{' '}
                <bdi>{card.away.name}</bdi>
              </p>
            )}
          </div>
          {closeHref !== undefined && (
            <Link
              href={closeHref}
              scroll={false}
              aria-label={close.text}
              lang={close.lang}
              className="ms-auto inline-flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-surface-raised"
              data-testid="preview-close"
            >
              <span aria-hidden="true" className="text-lg leading-none">
                ×
              </span>
            </Link>
          )}
        </div>

        <h2 id="preview-title" className="sr-only">
          <Translated locale={l} message="scores.preview.label" />
          {': '}
          {matchTitle(l, card.home.name, card.away.name)}
        </h2>
        <div
          className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 p-4.5 text-center ${compact ? 'max-lg:hidden' : ''}`}
        >
          {side('home')}
          <div className="flex flex-col items-center gap-1">
            {line === null && disputed ? (
              <span className="text-2xl font-extrabold text-muted" data-testid="preview-score">
                –
              </span>
            ) : line === null ? (
              <span className="text-sm text-caption">
                <Translated locale={l} message="scores.preview.versus" />
              </span>
            ) : (
              // Home goals on the home side, in either direction (T-1375).
              <span
                className={`flex gap-2 text-2xl font-extrabold tabular-nums ${live ? 'text-live' : disputed ? 'text-muted' : ''}`}
                data-testid="preview-score"
              >
                <span>{formatNumber(locale, line.home)}</span>
                <span aria-hidden="true" className="text-caption">
                  –
                </span>
                <span>{formatNumber(locale, line.away)}</span>
              </span>
            )}
            {(started || awaiting) && (
              <span
                className={`text-xs font-bold tabular-nums ${live ? 'text-live' : 'text-muted'}`}
                data-testid="preview-status"
                data-status={card.status}
              >
                {statusLabel(card, locale, timeZone, now, words.m)}
              </span>
            )}
            {disputed && (
              <span className="text-xs text-caption" data-testid="preview-score-unclear">
                <Translated locale={l} message="matchCentre.scoreUnclear" />
              </span>
            )}
          </div>
          {side('away')}
          {live && (
            <p className="col-span-full text-xs text-caption" data-testid="preview-updated">
              <FilledMessage
                message={words.m['scores.updated']}
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
        </div>

        <div className={`flex flex-col gap-3 px-4.5 pb-4.5 ${compact ? 'max-lg:pt-4' : ''}`}>
          <PickControl
            locale={locale}
            fixture={{
              id: card.id,
              kickoff_at: card.kickoff_at,
              home: card.home.name,
              away: card.away.name,
            }}
            timeZone={timeZone}
            zone={zone}
            me={me}
            current={current}
            pending={pending}
            split={
              me !== null || locked ? (
                <CommunitySplit
                  consensus={consensus}
                  home={card.home.name}
                  away={card.away.name}
                  locale={locale}
                />
              ) : undefined
            }
            model={
              <ModelBox locale={locale} testId="preview-model">
                <ForecastBarWithReceipt
                  forecast={forecast ?? { state: 'unreachable' }}
                  home={card.home.name}
                  away={card.away.name}
                  started={card.status !== 'scheduled'}
                  locale={locale}
                  timeZone={timeZone}
                  zone={zone}
                  words={forecastWords}
                />
              </ModelBox>
            }
          />
          <Link
            href={`/${locale}/match/${card.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-bold text-accent hover:underline"
            data-testid="preview-full"
          >
            <Translated locale={l} message="scores.preview.full" />
            <Icon name="forward" size={16} />
          </Link>
        </div>

        <div className="border-t border-default px-4.5 py-3">
          <CardDetails
            card={card}
            timeZone={timeZone}
            locale={locale}
            now={now}
            forecast={forecast}
            community={community}
            viewing={viewing}
            revealed={revealed}
            model={false}
            words={words}
          />
        </div>
      </section>
    </>
  );
}

/**
 * The preview's place when no match is chosen and none on the list is still
 * open (T-1496): what to press, never an empty card.
 */
export function NoPreview({ locale }: { locale: string }) {
  return (
    <p
      className="rounded-xl border border-dashed border-default px-4 py-3.5 text-sm leading-normal text-muted"
      data-testid="match-preview-none"
    >
      <Translated locale={asLocale(locale)} message="scores.preview.none" />
    </p>
  );
}
