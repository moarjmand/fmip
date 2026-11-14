/**
 * The football data providers' comparison on the agents console (T-1830,
 * D-423): which data API the project could buy from, measured on the
 * project's own criteria. A research agent writes it to one file on the
 * maintainer's computer (`E:/FMIP/ops/providers/comparison.json`); the
 * publisher checks it and carries it to the console inside the snapshot
 * (`ConsoleSnapshot.providers`), as it carries the model lab's ledger
 * (D-371). The console judges nothing and buys nothing: it shows what the
 * file says, marks every fact the research did not verify, and says so when
 * the file is missing (rule 3).
 *
 * The words (`*_fa`) are Persian, as the console is; names, keys, URLs and
 * currencies are left to right.
 */

export const CONSOLE_PROVIDERS_SCHEMA = 1;

/** Where a provider stands for the project. */
export const CONSOLE_PROVIDER_STATUSES = ['current', 'candidate', 'not-suitable'] as const;
export type ConsoleProviderStatus = (typeof CONSOLE_PROVIDER_STATUSES)[number];

/** How sure the research is of a provider's row as a whole. */
export const CONSOLE_PROVIDER_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ConsoleProviderConfidence = (typeof CONSOLE_PROVIDER_CONFIDENCES)[number];

export const CONSOLE_PROVIDERS_MAX = 40;
export const CONSOLE_PROVIDER_CRITERIA_MAX = 24;
export const CONSOLE_PROVIDER_PLANS_MAX = 12;
export const CONSOLE_PROVIDER_LIST_MAX = 30;
export const CONSOLE_PROVIDER_TEXT_MAX = 2000;
/** A score is 1 (poor) to 5 (best) on every criterion. */
export const CONSOLE_PROVIDER_SCORE_MIN = 1;
export const CONSOLE_PROVIDER_SCORE_MAX = 5;

/** One criterion the providers are compared on, and its weight in the total. */
export interface ConsoleProviderCriterion {
  /** Stable, unique: `coverage`, `price`, `licence` ... */
  key: string;
  label_fa: string;
  /** Any positive number; the total divides by the weights that were scored. */
  weight: number;
}

export interface ConsoleProviderPlan {
  name: string;
  /** The monthly price; null when the provider publishes none (a quote, "contact sales"). */
  price_month: number | null;
  currency: string | null;
  /** The request allowance in the provider's own words: `7,500 / day`. */
  requests: string | null;
  /** The leagues covered, as a count or in words. */
  leagues: string | null;
  /** Whether a free trial is offered: true, false, or null when not known. */
  trial: boolean | null;
  /** The trial's words when the file gave words, not a yes or no: `14 days`. */
  trial_note: string | null;
}

/** One fact about a provider on one criterion, with where it was read and when. */
export interface ConsoleProviderFact {
  value_fa: string;
  /** 1 to 5; null when it could not be scored. */
  score: number | null;
  /** The source as an http(s) link; null when the file gave none or not a link. */
  source_url: string | null;
  /** The source in words when it is not a link. */
  source_note: string | null;
  /** The day the fact was checked, `YYYY-MM-DD`; null when not said. */
  checked: string | null;
  /** True only when the research verified it at its source. */
  verified: boolean;
}

export interface ConsoleProvider {
  /** Stable, unique: `api-football`, `sportmonks` ... */
  key: string;
  name: string;
  /** The provider's site, http(s); null when not given. */
  url: string | null;
  status: ConsoleProviderStatus;
  plans: ConsoleProviderPlan[];
  /** By criterion key; a criterion with no fact is absent. */
  facts: Record<string, ConsoleProviderFact>;
  pros_fa: string[];
  cons_fa: string[];
  licence_fa: string | null;
  sanctions_fa: string | null;
  summary_fa: string | null;
  confidence: ConsoleProviderConfidence | null;
}

export interface ConsoleProviders {
  schema: number;
  /** When the research last changed the file. */
  updated_at: string;
  method_fa: string | null;
  needs_fa: string[];
  criteria: ConsoleProviderCriterion[];
  providers: ConsoleProvider[];
  recommendation_fa: string | null;
  current_stack_fa: string | null;
  next_steps_fa: string[];
  /**
   * Providers, criteria or facts of the file that failed a check, on the
   * computer or at the server, and are not shown: said on the page, never
   * shown wrong.
   */
  skipped: number;
}
