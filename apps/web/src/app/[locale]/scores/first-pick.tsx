import type { PendingPick, PredictionHistoryResponse, ScoreCard } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { ButtonLink } from '@/components/ui';
import { isOpenForPick } from '@/lib/scores-filters';

/**
 * A member's first prediction (T-1964): the one clear action a new account
 * meets where `/welcome` leaves it, the day's matches still to pick
 * (`afterRegistration`). «پیش‌بینی کن» / "Make a prediction" opens the
 * preview of the match the page already offers first -- on a phone the
 * sheet, on a desktop the side column it is already in -- whose outcomes
 * save the pick in one more tap.
 *
 * Only for a member who has no prediction at all (one page of their own
 * history says so) and no pick waiting on that match for their address to
 * be confirmed (D-361); only while that match is open. Anyone else sees the
 * page as before: the card goes with the first pick, nothing is stored to
 * remember it.
 */
export function showsFirstPick({
  signedIn,
  history,
  pending,
  card,
  now,
}: {
  signedIn: boolean;
  /** The member's own history as the page read it, or null when it did not. */
  history: { ok: true; data: PredictionHistoryResponse } | { ok: false } | null;
  /** The pick waiting on the previewed match, as the page read it. */
  pending: PendingPick | null;
  /** The match the preview offers. */
  card: Pick<ScoreCard, 'status' | 'kickoff_at'> | null;
  now: number;
}): boolean {
  if (!signedIn || card === null || pending !== null || !isOpenForPick(card, now)) return false;
  // Unread or unreadable is not "none": nothing is claimed about a history the page has not seen.
  if (history === null || !history.ok || history.data.kind !== 'visible') return false;
  return history.data.total === 0 && history.data.items.length === 0;
}

export function FirstPick({ locale, href }: { locale: string; href: string }) {
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
        data-testid="first-pick-action"
      >
        <Translated locale={locale} message="scores.firstPick.action" />
      </ButtonLink>
    </section>
  );
}
