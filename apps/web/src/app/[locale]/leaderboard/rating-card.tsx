import type { ReactNode } from 'react';
import Link from '@/components/ui/link';
import { ButtonLink, Icon } from '@/components/ui';
import { Translated } from '@/components/translated';
import { message } from '@/i18n/messages';
import {
  ABOUT_RATING_ANCHOR,
  type RatingCardViewer,
  type RatingStepState,
  ratingLabel,
  ratingProgress,
  ratingSteps,
  statusLabel,
  tierLabel,
} from '@/lib/leaderboard';
import { asLocale, plainNumber, richMessage } from '@/lib/prediction-text';
import { PICKS_PATH } from '@/lib/shell-nav';

const SUMMARY = 'cursor-pointer list-none [&::-webkit-details-marker]:hidden';

/**
 * "How a rating is earned" (T-1783, T-1784, D-388): the card that opens the
 * leaderboard, in place of the old picks card. Three steps, a bar to the
 * board's floor, the page's one primary button and a link to the About
 * page's rating step. The floor is the API's `floor`, never a number in a
 * catalogue string, and the bar says only what is true of whoever looks:
 * a guest gets the goal and no count, a member their own settled count, a
 * member whose e-mail is not confirmed the D-361 rule and no button, and a
 * member already on the board a one-line result with the card folded under
 * it. The community's rating only: the accent is amber, never the model's
 * turquoise (rule 6). A server component; the fold is a native <details>.
 */
export function RatingCard({
  locale,
  floor,
  viewer,
}: {
  locale: string;
  floor: number;
  viewer: RatingCardViewer;
}) {
  const l = asLocale(locale);
  const floorText = plainNumber(l, floor);
  const steps = <RatingSteps locale={locale} floor={floor} states={ratingSteps(viewer)} />;
  const howLink = (
    <Link
      href={`/${locale}/about#${ABOUT_RATING_ANCHOR}`}
      className="inline-flex min-h-touch items-center text-sm font-semibold underline"
      data-testid="rating-card-how"
    >
      <Translated locale={l} message="leaderboardPage.how.link" />
    </Link>
  );
  const button = (
    <ButtonLink
      href={`/${locale}${PICKS_PATH}`}
      variant="primary"
      size="md"
      data-testid="leaderboard-picks-cta"
    >
      <Translated locale={l} message="leaderboardPage.picksCta" />
    </ButtonLink>
  );

  if (viewer.kind === 'rated') {
    const { rating } = viewer;
    return (
      <div
        className="flex flex-col gap-3 rounded border border-default bg-surface p-4"
        data-testid="rating-card"
        data-viewer="rated"
      >
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="rating-result">
          <span className="text-3xl leading-none font-black tabular-nums">
            {ratingLabel(rating, l)}
          </span>
          <span className="text-sm text-muted">
            <b className="block text-fg">
              <Translated locale={l} message="leaderboardPage.how.yours" />
            </b>
            {richMessage(message(l, 'leaderboardPage.how.ratedMeta'), {
              tier: tierLabel(rating.tier, l),
              settled: plainNumber(l, rating.settled_count),
              status: statusLabel(rating, l),
            })}
          </span>
          <Link
            href={`/${locale}/u/${encodeURIComponent(viewer.username)}`}
            className="ms-auto inline-flex min-h-touch items-center text-sm font-semibold underline"
          >
            <Translated locale={l} message="leaderboardPage.how.profile" />
          </Link>
        </p>
        <details className="group rounded border border-default" data-testid="rating-fold">
          <summary
            className={`${SUMMARY} flex min-h-12 items-center justify-between gap-3 px-4 font-semibold`}
          >
            <Translated locale={l} message="leaderboardPage.how.title" />
            <span aria-hidden="true" className="text-xs text-muted group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {steps}
            <p className="text-sm text-muted">
              <Translated locale={l} message="leaderboardPage.how.recompute" />
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {button}
              {howLink}
            </div>
          </div>
        </details>
      </div>
    );
  }

  const guest = viewer.kind === 'guest';
  const settled = guest ? 0 : viewer.settled;
  const caption: ReactNode =
    viewer.kind === 'guest' ? (
      <>
        {richMessage(message(l, 'leaderboardPage.how.guest'), { floor: floorText })}{' '}
        <Translated locale={l} message="leaderboardPage.how.recompute" />
      </>
    ) : viewer.kind === 'unconfirmed' ? null : settled === 0 ? (
      <Translated locale={l} message="leaderboardPage.how.nothingSettled" />
    ) : (
      <>
        {richMessage(message(l, 'leaderboardPage.how.provisionalUntil'), { floor: floorText })}{' '}
        <Translated locale={l} message="leaderboardPage.how.recompute" />
      </>
    );

  return (
    <section
      aria-labelledby="rating-card-title"
      className="flex flex-col gap-4 rounded border border-default bg-surface p-4"
      data-testid="rating-card"
      data-viewer={viewer.kind}
    >
      <h2 id="rating-card-title" className="text-lg font-semibold">
        <Translated locale={l} message="leaderboardPage.how.title" />
      </h2>
      {steps}
      <div className="flex flex-col gap-2" data-testid="rating-progress">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted">
            <Translated
              locale={l}
              message={guest ? 'leaderboardPage.how.goal' : 'leaderboardPage.how.yourGoal'}
            />
          </span>
          <b className="tabular-nums" data-testid="rating-count">
            {guest
              ? floorText
              : richMessage(message(l, 'leaderboardPage.how.countOf'), {
                  count: plainNumber(l, settled),
                  floor: floorText,
                })}
          </b>
        </div>
        {/* The bar repeats the words above it; it fills from the start edge. */}
        {guest ? (
          <div
            aria-hidden="true"
            className="h-2 rounded-pill border border-dashed border-strong"
            data-testid="rating-bar"
            data-goal=""
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-2 overflow-hidden rounded-pill bg-surface-raised"
            data-testid="rating-bar"
          >
            <div
              className="h-full rounded-pill bg-accent"
              style={{ inlineSize: `${String(ratingProgress(settled, floor))}%` }}
            />
          </div>
        )}
        {caption !== null && (
          <p className="text-sm text-muted" data-testid="rating-caption">
            {caption}
          </p>
        )}
        {viewer.kind === 'unconfirmed' && (
          <p className="text-sm" data-testid="rating-unconfirmed">
            <Translated locale={l} message="leaderboardPage.how.unconfirmed" />
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {viewer.kind !== 'unconfirmed' && button}
        {howLink}
      </div>
    </section>
  );
}

/**
 * The three steps. On a phone one line each; from 768px three columns, each
 * a short name and one line of explanation. Each step's state is in its
 * number's fill and a tick (and "done" or `aria-current` for a screen
 * reader), never in colour alone.
 */
function RatingSteps({
  locale,
  floor,
  states,
}: {
  locale: string;
  floor: number;
  states: readonly [RatingStepState, RatingStepState, RatingStepState];
}) {
  const l = asLocale(locale);
  const items: { long: ReactNode; short: ReactNode; note: ReactNode }[] = [
    {
      long: <Translated locale={l} message="leaderboardPage.how.step1" />,
      short: null,
      note: <Translated locale={l} message="leaderboardPage.how.step1Note" />,
    },
    {
      long: <Translated locale={l} message="leaderboardPage.how.step2" />,
      short: <Translated locale={l} message="leaderboardPage.how.step2Short" />,
      note: <Translated locale={l} message="leaderboardPage.how.step2Note" />,
    },
    {
      long: <Translated locale={l} message="leaderboardPage.how.step3" count={floor} />,
      short: <Translated locale={l} message="leaderboardPage.how.step3Short" count={floor} />,
      note: <Translated locale={l} message="leaderboardPage.how.step3Note" />,
    },
  ];
  return (
    <ol className="grid gap-3 md:grid-cols-3 md:gap-4" data-testid="rating-steps">
      {items.map((item, index) => {
        const state = states[index];
        return (
          <li
            key={index}
            className="flex items-start gap-3"
            aria-current={state === 'current' ? 'step' : undefined}
            data-state={state}
          >
            <span
              aria-hidden="true"
              className={`inline-flex size-7 shrink-0 items-center justify-center rounded-pill border-2 text-sm font-bold tabular-nums ${
                state === 'current'
                  ? 'border-accent bg-accent text-on-accent'
                  : state === 'done'
                    ? 'border-accent text-accent'
                    : 'border-default text-muted'
              }`}
            >
              {state === 'done' ? <Icon name="check" size={16} /> : plainNumber(l, index + 1)}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              {item.short === null ? (
                <strong className={`text-sm ${state === 'todo' ? 'font-semibold text-muted' : ''}`}>
                  {item.long}
                </strong>
              ) : (
                <>
                  <strong
                    className={`text-sm md:hidden ${state === 'todo' ? 'font-semibold text-muted' : ''}`}
                  >
                    {item.long}
                  </strong>
                  <strong
                    className={`hidden text-sm md:inline ${state === 'todo' ? 'font-semibold text-muted' : ''}`}
                  >
                    {item.short}
                  </strong>
                </>
              )}
              <span className="hidden text-sm text-muted md:block">{item.note}</span>
              {state === 'done' && (
                <span className="sr-only">
                  <Translated locale={l} message="leaderboardPage.how.done" />
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
