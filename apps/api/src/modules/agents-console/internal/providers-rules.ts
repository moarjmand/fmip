import type {
  ConsoleProvider,
  ConsoleProviderCriterion,
  ConsoleProviderFact,
  ConsoleProviderPlan,
  ConsoleProviders,
} from '@fmip/contracts';
import {
  CONSOLE_PROVIDER_CONFIDENCES,
  CONSOLE_PROVIDER_CRITERIA_MAX,
  CONSOLE_PROVIDER_LIST_MAX,
  CONSOLE_PROVIDER_PLANS_MAX,
  CONSOLE_PROVIDER_SCORE_MAX,
  CONSOLE_PROVIDER_SCORE_MIN,
  CONSOLE_PROVIDER_STATUSES,
  CONSOLE_PROVIDER_TEXT_MAX,
  CONSOLE_PROVIDERS_MAX,
  CONSOLE_PROVIDERS_SCHEMA,
} from '@fmip/contracts/console';

/**
 * The data providers' comparison as it arrives inside a snapshot (T-1830,
 * D-423), checked at the server's edge, pure. The publisher checks the file
 * strictly on the computer; this is the second look, so a comparison that is
 * not one never reaches a page: the whole comparison is dropped when its
 * envelope is wrong, a provider or a criterion when its key, name or status
 * is not one the console knows, a fact when its criterion is not one. A link
 * that is not http(s) is never kept as a link (the page puts it in an
 * `href`). Nothing is repaired or guessed: a score outside 1 to 5 becomes
 * null, a fact is verified only when it says `true`, a text is cut.
 */

const KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
/** Names an object already has: never a key, so a lookup can never reach the prototype (sec-2026-11-13-07). */
const RESERVED = new Set(['constructor', '__proto__', 'prototype']);
const isKey = (value: unknown): value is string =>
  typeof value === 'string' && KEY.test(value) && !RESERVED.has(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== ''
    ? value.length > CONSOLE_PROVIDER_TEXT_MAX
      ? `${value.slice(0, CONSOLE_PROVIDER_TEXT_MAX)}…`
      : value
    : null;

const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .flatMap((item) => {
          const t = text(item);
          return t === null ? [] : [t];
        })
        .slice(0, CONSOLE_PROVIDER_LIST_MAX)
    : [];

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null;

/** An http(s) URL, or null. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function criterionOf(raw: unknown): ConsoleProviderCriterion | null {
  if (!isObject(raw)) return null;
  const key = isKey(raw.key) ? raw.key : null;
  const label = text(raw.label_fa);
  const weight =
    typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight > 0
      ? raw.weight
      : null;
  return key === null || label === null || weight === null
    ? null
    : { key, label_fa: label, weight };
}

function planOf(raw: unknown): ConsoleProviderPlan | null {
  if (!isObject(raw)) return null;
  const name = text(raw.name);
  if (name === null) return null;
  return {
    name,
    price_month:
      typeof raw.price_month === 'number' &&
      Number.isFinite(raw.price_month) &&
      raw.price_month >= 0
        ? raw.price_month
        : null,
    currency: text(raw.currency),
    requests: text(raw.requests),
    leagues: text(raw.leagues),
    trial: typeof raw.trial === 'boolean' ? raw.trial : null,
    trial_note: text(raw.trial_note),
  };
}

function factOf(raw: unknown): ConsoleProviderFact | null {
  if (!isObject(raw)) return null;
  const value = text(raw.value_fa);
  if (value === null) return null;
  const score =
    typeof raw.score === 'number' &&
    Number.isInteger(raw.score) &&
    raw.score >= CONSOLE_PROVIDER_SCORE_MIN &&
    raw.score <= CONSOLE_PROVIDER_SCORE_MAX
      ? raw.score
      : null;
  return {
    value_fa: value,
    score,
    source_url: safeUrl(raw.source_url),
    source_note: text(raw.source_note),
    checked: typeof raw.checked === 'string' && DAY.test(raw.checked) ? raw.checked : null,
    verified: raw.verified === true,
  };
}

function providerOf(raw: unknown, criteria: ReadonlySet<string>): ConsoleProvider | null {
  if (!isObject(raw)) return null;
  const key = isKey(raw.key) ? raw.key : null;
  const name = text(raw.name);
  const status = oneOf(CONSOLE_PROVIDER_STATUSES, raw.status);
  if (key === null || name === null || status === null) return null;
  const facts: Record<string, ConsoleProviderFact> = {};
  if (isObject(raw.facts)) {
    for (const [criterion, value] of Object.entries(raw.facts)) {
      if (!criteria.has(criterion)) continue;
      const fact = factOf(value);
      if (fact !== null) facts[criterion] = fact;
    }
  }
  return {
    key,
    name,
    url: safeUrl(raw.url),
    status,
    plans: Array.isArray(raw.plans)
      ? raw.plans.slice(0, CONSOLE_PROVIDER_PLANS_MAX).flatMap((p) => {
          const plan = planOf(p);
          return plan === null ? [] : [plan];
        })
      : [],
    facts,
    pros_fa: texts(raw.pros_fa),
    cons_fa: texts(raw.cons_fa),
    licence_fa: text(raw.licence_fa),
    sanctions_fa: text(raw.sanctions_fa),
    summary_fa: text(raw.summary_fa),
    confidence: oneOf(CONSOLE_PROVIDER_CONFIDENCES, raw.confidence),
  };
}

/** The comparison a snapshot carries, cleaned; null when it carries none or it is not one. */
export function checkProviders(raw: unknown): ConsoleProviders | null {
  if (
    !isObject(raw) ||
    raw.schema !== CONSOLE_PROVIDERS_SCHEMA ||
    !Array.isArray(raw.criteria) ||
    !Array.isArray(raw.providers)
  ) {
    return null;
  }
  if (typeof raw.updated_at !== 'string' || Number.isNaN(Date.parse(raw.updated_at))) return null;
  let skipped =
    typeof raw.skipped === 'number' && Number.isInteger(raw.skipped) && raw.skipped >= 0
      ? raw.skipped
      : 0;
  const criteria: ConsoleProviderCriterion[] = [];
  for (const item of raw.criteria.slice(0, CONSOLE_PROVIDER_CRITERIA_MAX)) {
    const criterion = criterionOf(item);
    if (criterion === null || criteria.some((c) => c.key === criterion.key)) skipped += 1;
    else criteria.push(criterion);
  }
  skipped += Math.max(0, raw.criteria.length - CONSOLE_PROVIDER_CRITERIA_MAX);
  const known = new Set(criteria.map((c) => c.key));
  const providers: ConsoleProvider[] = [];
  for (const item of raw.providers.slice(0, CONSOLE_PROVIDERS_MAX)) {
    const provider = providerOf(item, known);
    if (provider === null || providers.some((p) => p.key === provider.key)) skipped += 1;
    else providers.push(provider);
  }
  skipped += Math.max(0, raw.providers.length - CONSOLE_PROVIDERS_MAX);
  return {
    schema: CONSOLE_PROVIDERS_SCHEMA,
    updated_at: raw.updated_at,
    method_fa: text(raw.method_fa),
    needs_fa: texts(raw.needs_fa),
    criteria,
    providers,
    recommendation_fa: text(raw.recommendation_fa),
    current_stack_fa: text(raw.current_stack_fa),
    next_steps_fa: texts(raw.next_steps_fa),
    skipped,
  };
}
