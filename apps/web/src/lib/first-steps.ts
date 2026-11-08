/**
 * A new member's profile (T-1787, D-390; board P7-6): the member's own
 * "Your first steps", as data. Pure, so what is done and whether the card
 * still shows are unit-tested (`first-steps.spec.ts`); the page and
 * `components/first-steps.tsx` only draw it.
 *
 * Every number here is read, never typed (rule 3): the count is the rating's
 * `settled_count` (0 while `rating` is null: a rating starts with the first
 * settled prediction). The bar to the floor is `floorProgress` in
 * `lib/leaderboard.ts`, shared with the leaderboard's card.
 */

/** The three steps, in the order the card lists them. */
export type FirstStepId = 'pick' | 'follow' | 'bio';

export interface FirstStep {
  id: FirstStepId;
  done: boolean;
}

/** What the page has read about the member, each from the API's own answer. */
export interface FirstStepsInput {
  /** Settled predictions, from the rating (0 while `rating` is null); null when the rating could not be read. */
  settled: number | null;
  /** Predictions in the member's history; null when the history could not be read. */
  predictions: number | null;
  /** Whether the member follows a team; null when the follows could not be read. */
  followsTeam: boolean | null;
  /** The member's favourite teams (favourites are followed teams): the fallback for `followsTeam`. */
  favouriteTeams: number;
  bio: string | null;
}

export interface FirstSteps {
  steps: FirstStep[];
  /** The card stays until the member has a settled pick and every step is done. */
  shown: boolean;
}

/**
 * The steps and whether the card shows. A step the page could not read is
 * not ticked: a tick is a claim, and only an answer makes it (rule 3). A
 * settled prediction is also a pick, so a member whose history could not be
 * read but who is rated has made one.
 */
export function firstSteps(input: FirstStepsInput): FirstSteps {
  const settled = input.settled ?? 0;
  const steps: FirstStep[] = [
    { id: 'pick', done: settled > 0 || (input.predictions ?? 0) > 0 },
    { id: 'follow', done: input.followsTeam ?? input.favouriteTeams > 0 },
    { id: 'bio', done: input.bio !== null && input.bio.trim() !== '' },
  ];
  return { steps, shown: !(settled > 0 && steps.every((step) => step.done)) };
}
