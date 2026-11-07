import type { AuthUser, MatchHeader, PendingPick, Prediction } from '@fmip/contracts';
import { type ReactNode, useId } from 'react';
import { FilledMessage } from '@/components/filled-message';
import { CARD } from '@/components/match-centre-cards';
import { PickControl, StoredDetail } from '@/components/pick-control';
import { ProductRow } from '@/components/product-row';
import { Translated } from '@/components/translated';
import { Icon } from '@/components/ui';
import type { Locale } from '@/i18n/locales';
import { message } from '@/i18n/messages';
import { type PickOutcome, markedOutcome, pendingView, pickControlState } from '@/lib/pick';
import { isLocked } from '@/lib/prediction-form';
import { asLocale } from '@/lib/prediction-text';
import { zoneWords } from '@/lib/reader-time-zone';
import { formatKickoff } from '@/lib/scores';

/**
 * The reader's pick on the match page (T-1739, D-360; boards P1-3a and
 * P1-3b), two server components and no script of their own.
 *
 * `MatchPickCard` is the card directly under the statistical model's
 * headline: until kick-off the pick control (`pick-control.tsx`, D-359) in
 * its open states, the plain words a guest needs about an account, and the
 * line that a pick counts towards the community picks only; from kick-off on
 * one locked row (T-1744, D-365). The live view places it in the section
 * `id="pick"`, the fragment a guest's link comes back to. It repeats nothing
 * of the model's: that card stands directly above with its own bar, version
 * and receipt, so the control is handed no model slot here (rule 6).
 *
 * `PickBar` is the phone's slim bar above the tab bar until kick-off: one
 * link to that card.
 *
 * Where the states are decided: `pickControlState` in `lib/pick.ts`, from
 * the stored prediction (`current`), the member's pending pick (`pending`,
 * T-1740, D-361), the outcome in the address (`chosen`, `readPick(?pick=)`,
 * never stored) and the kick-off lock. This file only decides what stands
 * around the control.
 */

type PickFixture = Pick<MatchHeader, 'id' | 'kickoff_at' | 'home' | 'away'>;

/** Kick-off has locked the pick: the API's word when there is a stored pick, else the clock. */
function pickLocked(fixture: Pick<MatchHeader, 'kickoff_at'>, current: Prediction | null): boolean {
  return current?.locked ?? isLocked(fixture.kickoff_at);
}

export function MatchPickCard({
  locale,
  fixture,
  timeZone,
  me,
  current,
  pending = null,
  chosen,
  split,
}: {
  locale: string;
  fixture: PickFixture;
  timeZone: string;
  me: AuthUser | null;
  /** The member's stored prediction, or `null`. */
  current: Prediction | null;
  /**
   * The member's pick saved before their email address was confirmed
   * (T-1740, D-361), as the API has it now, or `null`. The control draws it
   * as pending, or as "Saved, not counted" once kick-off came first.
   */
  pending?: Pick<PendingPick, 'outcome' | 'status'> | null;
  /** The outcome carried in the address (`readPick` of `?pick=`); marked, never stored. */
  chosen: PickOutcome | null;
  /**
   * The community's split. Handed to the control for a member before
   * kick-off only, and the control draws it only once the reader has picked
   * (D-206). From kick-off on the pick is one locked row and the community
   * picks say their split in their own place on the page, once.
   */
  split?: ReactNode;
}) {
  const l = asLocale(locale);
  const saved = current?.latest.outcome ?? null;
  const waiting = pendingView(pending);
  const kickedOff = pickLocked(fixture, current);
  const state = pickControlState({ locked: kickedOff, saved, chosen, pending: waiting });
  // The API's word that a pending pick expired is a kick-off this page's
  // clock may not have reached yet: the pick is locked either way.
  if (kickedOff || state === 'uncounted') {
    return (
      <LockedPick
        locale={l}
        fixture={fixture}
        member={me !== null}
        current={current}
        marked={markedOutcome({ locked: true, saved, chosen, pending: waiting })}
        uncounted={state === 'uncounted'}
      />
    );
  }
  return (
    <div className={CARD} data-testid="match-pick" data-pick-card="open">
      <PickControl
        locale={locale}
        fixture={{
          id: fixture.id,
          kickoff_at: fixture.kickoff_at,
          home: fixture.home.name,
          away: fixture.away.name,
        }}
        timeZone={timeZone}
        zone={zoneWords(locale, timeZone)}
        me={me}
        current={current}
        pending={pending}
        chosen={chosen}
        split={me !== null ? split : undefined}
        heading="h2"
      />
      {/* What saving a pick takes, in plain words, where the old section
          spoke of a "verified account" (finding D-03). The offer itself is
          the control's: every outcome is a link to Create account with the
          way back, and Sign in beside it once an outcome is chosen. */}
      {me === null && (
        <p className="text-sm leading-normal text-muted" data-testid="match-pick-account">
          <Translated locale={l} message="pick.account" />
        </p>
      )}
      <p className="text-xs leading-normal text-caption" data-testid="match-pick-separate">
        <Translated locale={l} message="predictions.section.note" />
      </p>
    </div>
  );
}

/**
 * From kick-off on (T-1744, D-365; board P2-2): the pick is one locked row of
 * about 72px where the card with three inert buttons stood -- the reader's
 * locked pick if there is one, else that picks are locked -- with the lock
 * and its words at the end. A member's stored pick keeps what it said beyond
 * the outcome (score, confidence, reasons, note, which version was final)
 * under the row's sentence; a pick that was never counted says so (D-361).
 * Nothing of the model's or the community's is in it (rule 6).
 */
function LockedPick({
  locale,
  fixture,
  member,
  current,
  marked,
  uncounted,
}: {
  locale: Locale;
  fixture: PickFixture;
  member: boolean;
  current: Prediction | null;
  /** The stored or pending outcome; an address cannot claim one after kick-off. */
  marked: PickOutcome | null;
  uncounted: boolean;
}) {
  const id = useId();
  const outcome =
    marked === null ? null : marked === 'draw' ? (
      <Translated locale={locale} message="predictions.outcome.draw" />
    ) : (
      <FilledMessage
        message={message(locale, 'predictions.outcome.teamWin')}
        params={{ team: <bdi>{fixture[marked].name}</bdi> }}
      />
    );
  return (
    <ProductRow
      labelledBy={id}
      testId="match-pick"
      state={uncounted ? 'uncounted' : 'locked'}
      name={
        <h2 id={id} className="text-sm font-extrabold">
          <Translated locale={locale} message="pick.title" />
        </h2>
      }
      status={
        <span
          className="inline-flex min-h-6 items-center gap-1 text-xs font-semibold text-muted"
          data-testid="pick-lock"
        >
          <Icon name="lock" size={14} />
          <Translated
            locale={locale}
            message={uncounted ? 'pick.uncounted.title' : 'predictions.section.locked'}
          />
        </span>
      }
    >
      <p data-testid="pick-note">
        {outcome === null ? (
          <Translated
            locale={locale}
            message={member ? 'predictions.section.none' : 'pick.note.lockedNone'}
          />
        ) : (
          <FilledMessage
            message={message(locale, uncounted ? 'pick.uncounted.note' : 'pick.note.locked')}
            params={{ outcome: <b className="font-bold text-fg">{outcome}</b> }}
          />
        )}
      </p>
      {current !== null && <StoredDetail locale={locale} prediction={current} locked />}
    </ProductRow>
  );
}

/**
 * The phone's pick bar (board P1-3b): until kick-off, a 60px bar fixed above
 * the bottom tab bar that repeats the call to pick -- "Make your pick" and
 * when it locks in the reader's zone, or, for a member who has picked, their
 * pick. One link to `#pick`; the card is where the pick is made, so there is
 * no second form and no second set of guest links on the page.
 *
 * Server-rendered and static: no scroll listener, it does not hide on
 * scroll. Not rendered once the pick is locked or the match is anything but
 * scheduled; `globals.css` also hides it when the live view reports the
 * match has started on a page left open, and on a viewport too short to
 * spare it, and gives the page's end the bar's height.
 *
 * It cannot cover the tab bar: its box runs to the bottom edge *behind* the
 * tab bar (`z-20` under the bar's `z-40`), padded by the tab bar's own
 * height -- its entries, 3.75rem, and its 1px edge -- and the safe-area
 * inset, so the link sits directly above the tab bar with no gap. The
 * phone's open Menu (`z-30`) covers it.
 */
export function PickBar({
  locale,
  fixture,
  timeZone,
  current,
  pending = null,
}: {
  locale: string;
  fixture: Pick<MatchHeader, 'status' | 'kickoff_at' | 'home' | 'away'>;
  timeZone: string;
  current: Prediction | null;
  /** The member's pending pick (D-361), or `null`; a prediction comes before it. */
  pending?: Pick<PendingPick, 'outcome' | 'status'> | null;
}) {
  const stored = current?.latest.outcome ?? null;
  const waiting = stored === null ? pendingView(pending) : null;
  if (
    fixture.status !== 'scheduled' ||
    pickLocked(fixture, current) ||
    waiting?.state === 'uncounted'
  ) {
    return null;
  }
  const l = asLocale(locale);
  const saved = stored ?? waiting?.outcome ?? null;
  const locks = (
    <FilledMessage
      message={message(l, 'pick.locks')}
      params={{
        time: (
          <time dateTime={fixture.kickoff_at}>
            {formatKickoff(locale, fixture.kickoff_at, timeZone)}
          </time>
        ),
        zone: zoneWords(locale, timeZone),
      }}
    />
  );
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 border-t border-default bg-surface pb-[calc(3.8125rem+env(safe-area-inset-bottom))] md:hidden"
      data-testid="pick-bar"
      data-pick-bar=""
      data-pick={saved === null ? 'open' : waiting === null ? 'saved' : 'pending'}
    >
      <a
        href="#pick"
        className="focus-inset flex min-h-[3.6875rem] items-center justify-between gap-3 px-4"
        data-testid="pick-bar-link"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm leading-tight font-extrabold">
            <Translated locale={l} message={saved === null ? 'pick.make' : 'pick.title'} />
          </span>
          <span className="text-xs leading-tight text-muted">
            {saved !== null && (
              <>
                {/* A pending pick is not said to be simply "Saved": it counts
                    only once the email address is confirmed (D-361). */}
                <Translated
                  locale={l}
                  message={waiting === null ? 'pick.saved' : 'pick.pending.short'}
                />
                {waiting === null && ' · '}
              </>
            )}
            {/* A pending pick's line is long enough alone: with the lock time
                beside it the outcome was squeezed to "Liverp…" at 375px. The
                card the bar leads to says when it locks. */}
            {waiting === null && locks}
          </span>
        </span>
        {saved === null ? (
          // An outline, not a second filled button: the card holds the action.
          <span className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-control border border-accent px-3 text-sm font-extrabold text-accent">
            <Translated locale={l} message="scores.row.pick" />
            <Icon name="forward" size={16} />
          </span>
        ) : (
          // The chosen outcome as the control draws it: saffron, with a tick.
          <span
            className="inline-flex min-h-9 max-w-[55%] shrink-0 items-center gap-1 rounded-control border border-brand bg-brand px-3 text-sm leading-tight font-extrabold text-on-brand"
            data-testid="pick-bar-outcome"
            data-outcome={saved}
          >
            <Icon name="check" size={16} strokeWidth={2} className="shrink-0" />
            <span className="truncate">
              {saved === 'draw' ? (
                <Translated locale={l} message="predictions.outcome.draw" />
              ) : (
                <FilledMessage
                  message={message(l, 'predictions.outcome.teamWin')}
                  params={{ team: <bdi>{fixture[saved].name}</bdi> }}
                />
              )}
            </span>
          </span>
        )}
      </a>
    </div>
  );
}
