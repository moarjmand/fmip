import type { AuthUser, CommunityConsensusResponse, Prediction, ScoreCard } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { CommunitySplit } from '@/components/community-consensus';
import { EntityImage } from '@/components/entity-image';
import { ForecastBar, type ForecastBarWords } from '@/components/forecast-bar';
import { InlinePick } from '@/components/prediction-section';
import { FilledMessage } from '@/components/filled-message';
import { CardDetails } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { Icon } from '@/components/ui';
import { formatDate, formatNumber } from '@/i18n/format';
import { attribute } from '@/i18n/messages';
import { isLocked } from '@/lib/prediction-form';
import { asLocale, matchTitle } from '@/lib/prediction-text';
import type { CardCommunity, CardForecast, CardViewing } from '@/lib/score-card-products';
import { formatKickoff, formatStamp, scoreLine, statusLabel } from '@/lib/scores';
import type { ScoresWords } from '@/lib/words-server';

/**
 * The matches page's preview of one match, with the pick form (T-1496, the
 * canvas's side column): which match, both teams, "Your pick" -- the same
 * form, server action and three states as the match centre's (`InlinePick`),
 * opened on the outcomes because the row's Pick was the first press -- then
 * the model's bar with its version and time beside it, never mixed in
 * (rule 6), and what the row leaves out (`CardDetails`).
 *
 * The community's split is handed to the form only for a member or after
 * kick-off, and the form shows it only once the reader has picked (D-206):
 * before that it is not on the page at all, so it cannot anchor the pick.
 *
 * `id="pick"`: the row's Pick links here, so on a phone, where this stands
 * above the list, the page scrolls to it.
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
  const live = card.status === 'live';
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
    <section
      id="pick"
      aria-labelledby="preview-title"
      className="flex scroll-mt-4 flex-col overflow-clip rounded-2xl border border-default bg-surface"
      data-testid="match-preview"
      data-fixture-id={card.id}
    >
      <div className="flex min-h-11 items-center gap-2 border-b border-default ps-4.5 pe-1 text-xs text-muted">
        <p className="min-w-0 py-2.5">
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 p-4.5 text-center">
        {side('home')}
        <div className="flex flex-col items-center gap-1">
          {line === null ? (
            <span className="text-sm text-caption">
              <Translated locale={l} message="scores.preview.versus" />
            </span>
          ) : (
            // Home goals on the home side, in either direction (T-1375).
            <span
              className={`flex gap-2 text-2xl font-extrabold tabular-nums ${live ? 'text-live' : ''}`}
              data-testid="preview-score"
            >
              <span>{formatNumber(locale, line.home)}</span>
              <span aria-hidden="true" className="text-caption">
                –
              </span>
              <span>{formatNumber(locale, line.away)}</span>
            </span>
          )}
          {started && (
            <span
              className={`text-xs font-bold tabular-nums ${live ? 'text-live' : 'text-muted'}`}
              data-testid="preview-status"
              data-status={card.status}
            >
              {statusLabel(card, locale, timeZone, now, words.m)}
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

      <div className="flex flex-col gap-3 px-4.5 pb-4.5">
        <h3 className="text-sm font-extrabold">
          <Translated locale={l} message="scores.preview.yourPick" />
        </h3>
        {locked && me === null && (
          <p className="text-sm text-muted" data-testid="preview-locked">
            <Translated locale={l} message="predictions.section.locked" />
          </p>
        )}
        <InlinePick
          locale={locale}
          fixture={{
            id: card.id,
            kickoff_at: card.kickoff_at,
            home: card.home.name,
            away: card.away.name,
          }}
          me={me}
          current={current}
          open
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
        />
        {/* What "Make your pick" does, while it can still be pressed. */}
        {!locked && (
          <p className="text-xs leading-normal text-caption">
            <Translated locale={l} message="predictions.page.pickNote" />
          </p>
        )}
      </div>

      <div
        className="flex flex-col gap-2.5 border-t border-default px-4.5 py-4"
        data-testid="preview-model"
      >
        <p className="flex flex-wrap items-center gap-2">
          {/* An outline, not a tint: on its own tint the Day turquoise measured 4.2:1 (T-1545). */}
          <span className="rounded-sm border border-model px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold tracking-wide text-model uppercase [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
            <Translated locale={l} message="scores.preview.model" />
          </span>
          <span className="text-sm text-muted">
            <Translated locale={l} message="scores.preview.modelNote" />
          </span>
        </p>
        <ForecastBar
          forecast={forecast ?? { state: 'unreachable' }}
          home={card.home.name}
          away={card.away.name}
          started={card.status !== 'scheduled'}
          locale={locale}
          timeZone={timeZone}
          zone={zone}
          words={forecastWords}
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
