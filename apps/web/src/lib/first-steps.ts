/**
 * A new member's profile (T-1787, D-390; board P7-6): the member's own
 * "Your first steps" and the way to the leaderboard's floor, as data. Pure,
 * so what is done, whether the card still shows and how far the bar is
 * filled are unit-tested (`first-steps.spec.ts`); the page and
 * `components/first-steps.tsx` only draw it.
 *
 * Every number here is read, never typed (rule 3): the count is the rating's
 * `settled_count` (0 while `rating` is null: a rating starts with the first
 * settled prediction), the floor is the one the rating response carries --
 * the leaderboard's own `floor` (D-152).
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

/** How far a member is towards the floor. */
export interface SettledProgress {
  count: number;
  floor: number;
  /** The bar's fill, 0 to 100, never past the end. */
  percent: number;
}

/** The bar to the floor: the count as it stands, the fill capped at the floor. */
export function settledProgress(settled: number, floor: number): SettledProgress {
  const count = Math.max(0, settled);
  const percent = floor > 0 ? Math.min(100, Math.round((count / floor) * 100)) : 100;
  return { count, floor, percent };
}

/**
 * Whether a rating section draws the bar: a member with no rating yet
 * (`settled` 0, the bar at 0) and a provisional one (under the floor) do;
 * one who has reached the floor is on the leaderboard and does not.
 */
export function showsProgress(settled: number, floor: number): boolean {
  return settled < floor;
}
