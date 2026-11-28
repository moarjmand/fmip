import type { OwnPredictionHistoryResponse, PendingPick, ScoreCard } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { ButtonLink, buttonClasses } from '@/components/ui';
import type { ScoresView } from '@/lib/scores';
import { isOpenForPick } from '@/lib/scores-filters';

/**
 * A member's first prediction (T-1964, D-467): the one clear action a new
 * account meets where `/welcome` leaves it, "Not picked yet"
 * (`afterRegistration`). «پیش‌بینی کن» / "Make a prediction" leads to the
 * pick of the match the page already offers first, whose outcomes save the
 * pick in one more tap:
 * - under 1024px it opens that match's sheet (`?pick=<id>`), as a row's Pick does;
 * - from 1024px, where that pick is already open in the side column, it is a
 *   plain fragment link to it (`#pick`): the browser brings it into view and
 *   the column is outlined while it is the page's target (`match-preview.tsx`).
 *
 * Only on "Not picked yet", only for a member who has no prediction at all
 * (their own history says so, `total` 0) and no pick waiting for their address
 * to be confirmed (D-361) -- on that match, or on any other, which the same
 * history read says (`has_pending_pick`, T-1976), so a member who picked on
 * one day is not offered a first prediction on the next -- and only while that
 * match is open.
 * Anyone else sees the page as before: the card goes with the first pick,
 * nothing is stored to remember it.
 */
export function showsFirstPick({
  view,
  signedIn,
  history,
  pending,
  card,
  now,
}: {
  view: ScoresView;
  signedIn: boolean;
  /** The member's own history as the page read it, or null when it did not. */
  history: { ok: true; data: OwnPredictionHistoryResponse } | { ok: false } | null;
  /** The pick waiting on the previewed match, as the page read it. */
  pending: PendingPick | null;
  /** The match the preview offers. */
  card: Pick<ScoreCard, 'status' | 'kickoff_at'> | null;
  now: number;
}): boolean {
  if (view !== 'unpicked' || !signedIn) return false;
  if (card === null || pending !== null || !isOpenForPick(card, now)) return false;
  // Unread or unreadable is not "none": nothing is claimed about a history the page has not seen,
  // nor about a waiting pick it was not told of (an answer without the field says nothing).
  if (history === null || !history.ok || history.data.kind !== 'visible') return false;
  if (history.data.has_pending_pick !== false) return false;
  return history.data.total === 0 && history.data.items.length === 0;
}

export function FirstPick({ locale, href }: { locale: string; href: string }) {
  const action = <Translated locale={locale} message="scores.firstPick.action" />;
  return (
    <section
      aria-labelledby="first-pick-title"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-default bg-surface p-4"
      data-testid="first-pick"
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <h2 id="first-pick-title" className="text-base font-extrabold">
          <Translated locale={locale} message="scores.firstPick.title" />
        </h2>
        <p className="text-sm text-muted">
          <Translated locale={locale} message="scores.firstPick.lead" />
        </p>
      </div>
      <ButtonLink
        href={href}
        scroll={false}
        variant="primary"
        size="md"
        className="lg:hidden"
        data-testid="first-pick-action"
      >
        {action}
      </ButtonLink>
      {/* A fragment of this page, so a plain link: the browser sets `:target`. */}
      <a
        href="#pick"
        className={buttonClasses({ variant: 'primary', size: 'md', className: 'max-lg:hidden' })}
        data-testid="first-pick-beside"
      >
        {action}
      </a>
    </section>
  );
}
