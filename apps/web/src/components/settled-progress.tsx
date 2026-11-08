import type { ReactNode } from 'react';
import Link from '@/components/ui/link';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { ABOUT_RATING_ANCHOR, type FloorProgress } from '@/lib/leaderboard';
import { plainNumber } from '@/lib/prediction-text';

/**
 * The bar to the leaderboard's floor (D-388, D-390): one component for the
 * leaderboard's card "How a rating is earned" and the member profile, so one
 * look, one computation (`floorProgress`) and one set of strings. Drawn only
 * below the floor -- `floorProgress` is null from it on, so there is no
 * "34 of 30" (rule 3). A guest gets `goal`: the floor alone over a dashed
 * outline, never a count of their own.
 *
 * The community's rating only (rule 6): the accent amber, never the model's
 * turquoise. The words carry the number; the bar repeats it as a picture, so
 * it is hidden from a screen reader. It fills from the inline start (rule 7),
 * so from the right in Persian. A server component.
 */
export function SettledProgressBar({
  locale,
  own,
  note,
  ...shown
}: {
  locale: string;
  /** "Your settled picks" for the member's own count, "Settled picks" otherwise. */
  own: boolean;
  /** One sentence under the bar. */
  note?: ReactNode;
} & ({ progress: FloorProgress; goal?: never } | { goal: number; progress?: never })) {
  const progress = shown.progress ?? null;
  const floor = plainNumber(locale, progress?.floor ?? shown.goal ?? 0);
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="settled-progress"
      data-count={progress?.count}
      data-floor={progress?.floor ?? shown.goal}
    >
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">
          <Translated
            locale={locale}
            message={own ? 'ratingProgress.own' : 'ratingProgress.settled'}
          />
        </span>
        <b className="font-semibold tabular-nums" data-testid="settled-progress-count">
          {progress === null ? (
            floor
          ) : (
            <Said
              locale={locale}
              message="ratingProgress.count"
              params={{ count: plainNumber(locale, progress.count), floor }}
            />
          )}
        </b>
      </p>
      {progress === null ? (
        <span
          aria-hidden="true"
          className="block h-2 rounded-pill border border-dashed border-strong"
          data-goal=""
        />
      ) : (
        <span
          aria-hidden="true"
          className="block h-2 overflow-hidden rounded-pill bg-surface-raised"
        >
          <span
            className="block h-full rounded-pill bg-accent"
            style={{ inlineSize: `${String(progress.percent)}%` }}
            data-testid="settled-progress-fill"
          />
        </span>
      )}
      {note !== undefined && note !== null && (
        <p className="text-sm text-muted" data-testid="settled-progress-note">
          {note}
        </p>
      )}
    </div>
  );
}

/** "How ratings work": the About page's rating step (`ABOUT_RATING_ANCHOR`, D-388 D7). */
export function HowRatingsWork({ locale, testId }: { locale: string; testId: string }) {
  return (
    <Link
      href={`/${locale}/about#${ABOUT_RATING_ANCHOR}`}
      className="inline-flex min-h-touch items-center text-sm font-semibold underline"
      data-testid={testId}
    >
      <Translated locale={locale} message="ratingProgress.howRatingsWork" />
    </Link>
  );
}
