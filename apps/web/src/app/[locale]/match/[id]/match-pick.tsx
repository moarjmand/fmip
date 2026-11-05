import type { AuthUser, MatchHeader, PendingPick, Prediction } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { FilledMessage } from '@/components/filled-message';
import { CARD } from '@/components/match-centre-cards';
import { PickControl } from '@/components/pick-control';
import { Translated } from '@/components/translated';
import { Icon } from '@/components/ui';
import { message } from '@/i18n/messages';
import { type PickOutcome, pendingView } from '@/lib/pick';
import { isLocked } from '@/lib/prediction-form';
import { asLocale } from '@/lib/prediction-text';
import { zoneWords } from '@/lib/reader-time-zone';
import { formatKickoff } from '@/lib/scores';

/**
 * The reader's pick on the match page (T-1739, D-360; boards P1-3a and
 * P1-3b), two server components and no script of their own.
 *
 * `MatchPickCard` is the card directly under the statistical model's card:
 * the pick control (`pick-control.tsx`, D-359) in its four states, the plain
 * words a guest needs about an account, and the line that a pick counts
 * towards the community picks only. The live view places it in the section
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
  finished,
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
   * The community's split. Handed to the control for a member or after
   * kick-off only, and the control draws it only once the reader has picked
   * or every pick is locked (D-206); after full time the verdict card below
   * says it, so it is left out here.
   */
  split?: ReactNode;
  /** The match has a full-time score. */
  finished: boolean;
}) {
  const l = asLocale(locale);
  const locked = pickLocked(fixture, current);
  return (
    <div className={CARD} data-testid="match-pick">
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
        split={!finished && (me !== null || locked) ? split : undefined}
        heading="h2"
      />
      {/* What saving a pick takes, in plain words, where the old section
          spoke of a "verified account" (finding D-03). The offer itself is
          the control's: every outcome is a link to Create account with the
          way back, and Sign in beside it once an outcome is chosen. */}
      {me === null && !locked && (
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
                {' · '}
              </>
            )}
            {locks}
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
            className="inline-flex min-h-9 max-w-[55%] min-w-0 items-center gap-1 rounded-control border border-brand bg-brand px-3 text-sm leading-tight font-extrabold text-on-brand"
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
