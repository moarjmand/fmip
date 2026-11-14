import type {
  ConsoleProvider,
  ConsoleProviderConfidence,
  ConsoleProviderCriterion,
  ConsoleProviderFact,
  ConsoleProviderPlan,
  ConsoleProviders,
  ConsoleProviderStatus,
} from '@fmip/contracts';

/**
 * The football data providers' comparison, read on the maintainer's computer
 * (T-1830, D-423): `E:/FMIP/ops/providers/comparison.json`, written by a
 * research agent, is checked here and carried to the console inside the
 * snapshot. Pure, so it is tested on fixtures; `publish.ts` only reads the
 * file.
 *
 * This is the strict check, where the person or agent who edits the file
 * sees the answer: every problem is named with its provider. A provider
 * without a key, a name or a known status is left out and counted
 * (`skipped`); a fact whose score is not 1 to 5 keeps its words and loses
 * its score, and is counted; a source that is not an http(s) link is kept as
 * words, never as a link. Nothing is guessed: a fact the file does not mark
 * `verified: true` is unverified. The server checks again with its own,
 * shorter rules. The lists repeat the contract's (`@fmip/contracts/console`)
 * on purpose: the publisher runs from source and imports types only (D-371).
 */

export const PROVIDERS_SCHEMA = 1;
export const PROVIDER_STATUSES = ['current', 'candidate', 'not-suitable'] as const;
export const PROVIDER_CONFIDENCES = ['high', 'medium', 'low'] as const;
export const PROVIDERS_MAX = 40;
export const PROVIDER_CRITERIA_MAX = 24;
export const PROVIDER_PLANS_MAX = 12;
export const PROVIDER_LIST_MAX = 30;
export const PROVIDER_TEXT_MAX = 2000;

const KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
/** Names an object already has: never a key, so a lookup can never reach the prototype (sec-2026-11-13-07). */
const RESERVED = new Set(['constructor', '__proto__', 'prototype']);
const isKey = (value: unknown): value is string =>
  typeof value === 'string' && KEY.test(value) && !RESERVED.has(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== ''
    ? value.length > PROVIDER_TEXT_MAX
      ? `${value.slice(0, PROVIDER_TEXT_MAX)}…`
      : value.trim()
    : null;

/** Text, or a number written as text (`75000` -> `75000`). */
const words = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);

const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .flatMap((item) => {
          const t = text(item);
          return t === null ? [] : [t];
        })
        .slice(0, PROVIDER_LIST_MAX)
    : [];

/** An http(s) link, or null: a `javascript:` or relative source never becomes a link. */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD`, from a day or a full time; null otherwise. */
const day = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(value.trim());
  return match !== null && !Number.isNaN(Date.parse(match[1]!)) ? match[1]! : null;
};

/**
 * The research's confidence: one of the three words (also in Persian), or a
 * share from 0 to 1 banded at 0.75 and 0.5; anything else is not known.
 */
export function confidenceOf(value: unknown): ConsoleProviderConfidence | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value >= 0.75 ? 'high' : value >= 0.5 ? 'medium' : 'low';
  }
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  if ((PROVIDER_CONFIDENCES as readonly string[]).includes(word))
    return word as ConsoleProviderConfidence;
  if (['زیاد', 'بالا'].includes(word)) return 'high';
  if (word === 'متوسط') return 'medium';
  if (['کم', 'پایین'].includes(word)) return 'low';
  return null;
}

function criterionOf(
  raw: unknown,
  index: number,
): { criterion: ConsoleProviderCriterion | null; problems: string[] } {
  if (!isObject(raw))
    return { criterion: null, problems: [`criterion ${index + 1}: not an object`] };
  const key = isKey(raw.key) ? raw.key : null;
  const label = text(raw.label_fa);
  const weight =
    typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight > 0
      ? raw.weight
      : null;
  const problems: string[] = [];
  if (key === null) problems.push(`criterion ${index + 1}: the key is missing or not a key`);
  if (label === null) problems.push(`criterion ${String(raw.key ?? index + 1)}: no label_fa`);
  if (weight === null)
    problems.push(`criterion ${String(raw.key ?? index + 1)}: the weight is not a positive number`);
  return problems.length > 0
    ? { criterion: null, problems }
    : { criterion: { key: key!, label_fa: label!, weight: weight! }, problems };
}

function planOf(raw: unknown): ConsoleProviderPlan | null {
  if (!isObject(raw)) return null;
  const name = text(raw.name);
  if (name === null) return null;
  const price =
    typeof raw.price_month === 'number' && Number.isFinite(raw.price_month) && raw.price_month >= 0
      ? raw.price_month
      : null;
  return {
    name,
    price_month: price,
    currency: text(raw.currency),
    requests: words(raw.requests),
    leagues: words(raw.leagues),
    trial: typeof raw.trial === 'boolean' ? raw.trial : null,
    trial_note: typeof raw.trial === 'boolean' ? null : words(raw.trial),
  };
}

function factOf(
  raw: unknown,
  where: string,
): { fact: ConsoleProviderFact | null; problems: string[] } {
  if (!isObject(raw)) return { fact: null, problems: [`${where}: not an object`] };
  const value = text(raw.value_fa);
  if (value === null) return { fact: null, problems: [`${where}: no value_fa`] };
  const problems: string[] = [];
  let score: number | null = null;
  if (raw.score !== null && raw.score !== undefined) {
    if (
      typeof raw.score === 'number' &&
      Number.isInteger(raw.score) &&
      raw.score >= 1 &&
      raw.score <= 5
    ) {
      score = raw.score;
    } else {
      problems.push(`${where}: the score ${String(raw.score)} is not a whole number from 1 to 5`);
    }
  }
  const sourceUrl = httpUrl(raw.source);
  return {
    fact: {
      value_fa: value,
      score,
      source_url: sourceUrl,
      source_note: sourceUrl === null ? text(raw.source) : null,
      checked: day(raw.checked),
      // Only an explicit true is verified (rule 3): a missing flag is not.
      verified: raw.verified === true,
    },
    problems,
  };
}

function providerOf(
  raw: unknown,
  index: number,
  criteria: ReadonlySet<string>,
): { provider: ConsoleProvider | null; problems: string[]; dropped: number } {
  if (!isObject(raw))
    return { provider: null, problems: [`provider ${index + 1}: not an object`], dropped: 0 };
  const key = isKey(raw.key) ? raw.key : null;
  const name = text(raw.name);
  const status = (PROVIDER_STATUSES as readonly unknown[]).includes(raw.status)
    ? (raw.status as ConsoleProviderStatus)
    : null;
  const where = `provider ${typeof raw.key === 'string' ? raw.key : index + 1}`;
  const problems: string[] = [];
  if (key === null) problems.push(`${where}: the key is missing or not a key`);
  if (name === null) problems.push(`${where}: no name`);
  if (status === null)
    problems.push(
      `${where}: the status ${String(raw.status)} is not one of ${PROVIDER_STATUSES.join(', ')}`,
    );
  if (problems.length > 0) return { provider: null, problems, dropped: 0 };

  let dropped = 0;
  const facts: Record<string, ConsoleProviderFact> = {};
  if (raw.facts !== undefined && !isObject(raw.facts))
    problems.push(`${where}: facts is not an object`);
  for (const [criterion, value] of Object.entries(isObject(raw.facts) ? raw.facts : {})) {
    if (!criteria.has(criterion)) {
      problems.push(`${where}: a fact on ${criterion}, which is not a criterion`);
      dropped += 1;
      continue;
    }
    const read = factOf(value, `${where}, ${criterion}`);
    problems.push(...read.problems);
    if (read.fact === null) dropped += 1;
    else facts[criterion] = read.fact;
    if (read.fact !== null && read.problems.length > 0) dropped += 1;
  }
  const plans = Array.isArray(raw.plans) ? raw.plans : [];
  if (plans.length > PROVIDER_PLANS_MAX)
    problems.push(`${where}: ${plans.length} plans; only ${PROVIDER_PLANS_MAX} are read`);
  const kept = plans.slice(0, PROVIDER_PLANS_MAX).flatMap((p, i) => {
    const plan = planOf(p);
    if (plan === null) {
      problems.push(`${where}: plan ${i + 1} has no name`);
      dropped += 1;
      return [];
    }
    return [plan];
  });
  if (
    raw.confidence !== undefined &&
    raw.confidence !== null &&
    confidenceOf(raw.confidence) === null
  )
    problems.push(
      `${where}: the confidence ${String(raw.confidence)} is not high, medium, low or 0 to 1`,
    );
  return {
    provider: {
      key: key!,
      name: name!,
      url: httpUrl(raw.url),
      status: status!,
      plans: kept,
      facts,
      pros_fa: texts(raw.pros_fa),
      cons_fa: texts(raw.cons_fa),
      licence_fa: text(raw.licence_fa),
      sanctions_fa: text(raw.sanctions_fa),
      summary_fa: text(raw.summary_fa),
      confidence: confidenceOf(raw.confidence),
    },
    problems,
    dropped,
  };
}

export interface ProvidersRead {
  providers: ConsoleProviders | null;
  problems: string[];
}

/**
 * The comparison file's content, checked. `changedAt` is the file's own
 * time, used when the file names none.
 */
export function providersFrom(raw: unknown, changedAt: string): ProvidersRead {
  if (!isObject(raw))
    return { providers: null, problems: ['The comparison is not a JSON object.'] };
  if (!Array.isArray(raw.criteria))
    return { providers: null, problems: ['criteria is not a list.'] };
  if (!Array.isArray(raw.providers))
    return { providers: null, problems: ['providers is not a list.'] };
  const problems: string[] = [];
  let skipped = 0;

  const criteria: ConsoleProviderCriterion[] = [];
  if (raw.criteria.length > PROVIDER_CRITERIA_MAX) {
    problems.push(`${raw.criteria.length} criteria; only ${PROVIDER_CRITERIA_MAX} are read.`);
    skipped += raw.criteria.length - PROVIDER_CRITERIA_MAX;
  }
  raw.criteria.slice(0, PROVIDER_CRITERIA_MAX).forEach((item, index) => {
    const read = criterionOf(item, index);
    if (read.criterion !== null && criteria.some((c) => c.key === read.criterion!.key)) {
      read.problems.push(`criterion ${read.criterion.key}: the key is used twice`);
    }
    if (read.problems.length > 0 || read.criterion === null) {
      problems.push(...read.problems);
      skipped += 1;
      return;
    }
    criteria.push(read.criterion);
  });
  const known = new Set(criteria.map((c) => c.key));

  const providers: ConsoleProvider[] = [];
  if (raw.providers.length > PROVIDERS_MAX) {
    problems.push(`${raw.providers.length} providers; only ${PROVIDERS_MAX} are read.`);
    skipped += raw.providers.length - PROVIDERS_MAX;
  }
  raw.providers.slice(0, PROVIDERS_MAX).forEach((item, index) => {
    const read = providerOf(item, index, known);
    problems.push(...read.problems);
    skipped += read.dropped;
    if (read.provider === null) {
      skipped += 1;
      return;
    }
    if (providers.some((p) => p.key === read.provider!.key)) {
      problems.push(`provider ${read.provider.key}: the key is used twice`);
      skipped += 1;
      return;
    }
    providers.push(read.provider);
  });

  const updatedAt =
    typeof raw.updated_at === 'string' && !Number.isNaN(Date.parse(raw.updated_at))
      ? raw.updated_at
      : changedAt;
  return {
    providers: {
      schema: PROVIDERS_SCHEMA,
      updated_at: updatedAt,
      method_fa: text(raw.method_fa),
      needs_fa: texts(raw.needs_fa),
      criteria,
      providers,
      recommendation_fa: text(raw.recommendation_fa),
      current_stack_fa: text(raw.current_stack_fa),
      next_steps_fa: texts(raw.next_steps_fa),
      skipped,
    },
    problems,
  };
}
