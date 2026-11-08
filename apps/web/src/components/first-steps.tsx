import type { ReactNode } from 'react';
import Link from '@/components/ui/link';
import { ProductRow } from '@/components/product-row';
import { HowRatingsWork, SettledProgressBar } from '@/components/settled-progress';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { Translated } from '@/components/translated';
import type { MessageKey } from '@/i18n/messages';
import type { FirstStep, FirstStepId } from '@/lib/first-steps';
import type { FloorProgress } from '@/lib/leaderboard';

/**
 * A new member's profile (T-1787, D-390; board P7-6): the member's own
 * "Your first steps" card and the profile's empty rows. Server components,
 * no client JavaScript. The bar to the floor is the leaderboard card's own
 * (`components/settled-progress.tsx`); the sentence under the member's own
 * bar is rule 8's.
 */

/**
 * An empty section of a profile: one 48px line with its heading and its
 * state word ("Not rated yet", "None yet") always visible, the sentence
 * behind a native disclosure -- D-383's folded row, with no prediction
 * product's name or colour of its own. A section with content is drawn as
 * it always was.
 */
export function ProfileStateRow({
  locale,
  id,
  heading,
  word,
  testId,
  children,
}: {
  locale: string;
  /** The heading's id, which names the row. */
  id: string;
  heading: MessageKey;
  word: 'profile.state.none' | 'profile.state.notRated';
  testId: string;
  /** Why there is nothing yet. */
  children: ReactNode;
}) {
  return (
    <ProductRow
      folded
      labelledBy={id}
      testId={testId}
      state="none"
      name={
        <h2 id={id} className="text-base font-semibold">
          <Translated locale={locale} message={heading} />
        </h2>
      }
      status={
        <CoverageBadge state="not_supplied" label={<Translated locale={locale} message={word} />} />
      }
    >
      {children}
    </ProductRow>
  );
}

/** Each step's words and where its link leads. */
const STEP_WORDS: Record<FirstStepId, { says: MessageKey; link: MessageKey }> = {
  pick: { says: 'profile.steps.pick', link: 'shell.nav.matches' },
  follow: { says: 'profile.steps.follow', link: 'profile.steps.followLink' },
  bio: { says: 'profile.steps.bio', link: 'nav.settings' },
};

/** A box, ticked when the step is done: the tick is the mark, never a colour alone. */
function StepBox({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 shrink-0 items-center justify-center rounded-control border ${
        done ? 'border-strong bg-surface-raised text-fg' : 'border-default'
      }`}
    >
      {done && (
        <svg width="14" height="14" viewBox="0 0 14 14" focusable="false">
          <path
            d="M3 7.5 5.8 10 11 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/**
 * "Your first steps", on the member's own profile only, until they have a
 * settled pick and the three steps are done (`firstSteps`): three 48px rows
 * (a box, the step, a 44px link), then the bar to the floor with rule 8's
 * sentence and "How ratings work". The bar is drawn only below the floor
 * (`floorProgress`): from it on the card shows the steps alone, because the
 * count is the formula's window and "34 of 30" or "100 of 30" would not be
 * true. Without a readable rating there is no count to show either, so the
 * bar is left out rather than drawn at an invented 0.
 */
export function FirstStepsCard({
  locale,
  steps,
  progress,
  hrefs,
}: {
  locale: string;
  steps: readonly FirstStep[];
  progress: FloorProgress | null;
  hrefs: Record<FirstStepId, string>;
}) {
  return (
    <section
      aria-labelledby="first-steps-heading"
      className="flex flex-col gap-4 rounded-card border border-default bg-surface p-4 md:p-6"
      data-testid="first-steps"
    >
      <h2 id="first-steps-heading" className="text-lg font-semibold">
        <Translated locale={locale} message="profile.steps.heading" />
      </h2>
      <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start md:gap-6">
        <ol className="flex flex-col">
          {steps.map((step) => (
            <li
              key={step.id}
              className="flex min-h-12 items-center gap-3 border-b border-default last:border-b-0"
              data-testid={`first-step-${step.id}`}
              data-done={step.done ? '' : undefined}
            >
              <StepBox done={step.done} />
              <span className="min-w-0 flex-1 text-sm">
                <Translated locale={locale} message={STEP_WORDS[step.id].says} />
                {step.done && (
                  <span className="sr-only">
                    {' · '}
                    <Translated locale={locale} message="profile.steps.done" />
                  </span>
                )}
              </span>
              <Link
                href={hrefs[step.id]}
                className="inline-flex min-h-touch shrink-0 items-center text-sm underline"
              >
                <Translated locale={locale} message={STEP_WORDS[step.id].link} />
              </Link>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2">
          {progress !== null && (
            <SettledProgressBar
              locale={locale}
              own
              progress={progress}
              note={<Translated locale={locale} message="profile.progress.ownNote" />}
            />
          )}
          <div>
            <HowRatingsWork locale={locale} testId="how-ratings-work" />
          </div>
        </div>
      </div>
    </section>
  );
}
