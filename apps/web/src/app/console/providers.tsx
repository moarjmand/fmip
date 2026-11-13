import type {
  ConsoleProvider,
  ConsoleProviderConfidence,
  ConsoleProviderCriterion,
  ConsoleProviderFact,
  ConsoleProviderPlan,
  ConsoleProviderStatus,
} from '@fmip/contracts';
import { CONSOLE_PROVIDER_STATUSES } from '@fmip/contracts/console';
import type { ReactNode } from 'react';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { Badge, fa, when } from './ui';

/**
 * The football data providers' comparison on the console (T-1830, D-423),
 * drawn on the server from what the snapshot carries: the matrix, the plans,
 * a card per provider. The page judges nothing: the weighted total is the
 * file's scores times the file's weights, over the criteria that were scored,
 * and it says how much of the weight that is. A score is a number on a
 * colour, never a colour alone; a fact the research did not verify carries
 * «تأییدنشده» wherever it is shown, and can be left out of the total.
 */

export const STATUS_WORDS: Record<ConsoleProviderStatus, string> = {
  current: 'ارائه‌دهنده‌ی فعلی',
  candidate: 'نامزد',
  'not-suitable': 'نامناسب',
};

const STATUS_TONE: Record<ConsoleProviderStatus, string> = {
  current: 'border-brand text-brand',
  candidate: 'border-accent text-fg',
  'not-suitable': 'border-default text-caption',
};

export const CONFIDENCE_WORDS: Record<ConsoleProviderConfidence, string> = {
  high: 'اطمینان زیاد',
  medium: 'اطمینان متوسط',
  low: 'اطمینان کم',
};

const CONFIDENCE_TONE: Record<ConsoleProviderConfidence, string> = {
  high: 'border-rating-good text-fg',
  medium: 'border-warning text-warning',
  low: 'border-danger text-danger',
};

/** Bars filled out of three, so the badge does not lean on its colour. */
const CONFIDENCE_BARS: Record<ConsoleProviderConfidence, number> = { high: 3, medium: 2, low: 1 };
const CONFIDENCE_FILL: Record<ConsoleProviderConfidence, string> = {
  high: 'bg-rating-good',
  medium: 'bg-warning',
  low: 'bg-danger',
};

/** 1 (poor) to 5 (best): a tint per step, the number always written on it. */
const SCORE_TONE: Record<number, string> = {
  1: 'bg-danger/25',
  2: 'bg-warning/25',
  3: 'bg-surface-raised',
  4: 'bg-rating-good/30',
  5: 'bg-rating-good/60',
};

export const UNVERIFIED = 'تأییدنشده';

// --- Arithmetic ------------------------------------------------------------------

export interface Total {
  /** The weighted mean of the counted scores, 1 to 5; null when none is counted. */
  value: number | null;
  /** Criteria counted, and of how many. */
  counted: number;
  of: number;
  /** The counted criteria's share of the whole weight, 0 to 1. */
  weight_share: number;
}

/**
 * The weighted total: Σ weight × score ÷ Σ weight, over the criteria with a
 * score (and, with `verifiedOnly`, a verified fact). A missing score is never
 * taken as any number; it lowers `weight_share` instead.
 */
export function weightedTotal(
  provider: ConsoleProvider,
  criteria: readonly ConsoleProviderCriterion[],
  verifiedOnly = false,
): Total {
  let sum = 0;
  let weights = 0;
  let counted = 0;
  const all = criteria.reduce((a, c) => a + c.weight, 0);
  for (const criterion of criteria) {
    const fact = provider.facts[criterion.key];
    if (fact === undefined || fact.score === null || (verifiedOnly && !fact.verified)) continue;
    sum += criterion.weight * fact.score;
    weights += criterion.weight;
    counted += 1;
  }
  return {
    value: weights === 0 ? null : sum / weights,
    counted,
    of: criteria.length,
    weight_share: all === 0 ? 0 : weights / all,
  };
}

export type SortKey = 'total' | 'name' | 'price' | `c:${string}`;
export type SortDir = 'asc' | 'desc';

/** The lowest published monthly price above zero; zero when every plan is free; else null. */
export function lowestPrice(provider: ConsoleProvider): number | null {
  const prices = provider.plans.map((p) => p.price_month).filter((p): p is number => p !== null);
  const paid = prices.filter((p) => p > 0);
  if (paid.length > 0) return Math.min(...paid);
  // Free only, with no quote-only plan beside it, is free; a free trial before a quote is not a price.
  return prices.length > 0 && prices.length === provider.plans.length ? 0 : null;
}

/**
 * The providers in the order asked; a provider with nothing to sort by (no
 * score, no price) always goes last, whichever way, and ties keep the file's
 * order. Prices in different currencies are compared as numbers: the table
 * says each one's currency.
 */
export function sortProviders(
  providers: readonly ConsoleProvider[],
  criteria: readonly ConsoleProviderCriterion[],
  sort: SortKey,
  dir: SortDir,
  verifiedOnly: boolean,
): ConsoleProvider[] {
  const valueOf = (p: ConsoleProvider): number | string | null => {
    if (sort === 'name') return p.name.toLowerCase();
    if (sort === 'price') return lowestPrice(p);
    if (sort === 'total') return weightedTotal(p, criteria, verifiedOnly).value;
    const fact = p.facts[sort.slice(2)];
    return fact === undefined || fact.score === null || (verifiedOnly && !fact.verified)
      ? null
      : fact.score;
  };
  const sign = dir === 'asc' ? 1 : -1;
  return providers
    .map((p, i) => ({ p, i, v: valueOf(p) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      if (a.v === b.v) return a.i - b.i;
      return (a.v < b.v ? -1 : 1) * sign;
    })
    .map((x) => x.p);
}

/** A score to one decimal, in Persian digits. */
export const scoreText = (value: number): string =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(
    value,
  );

const percent = (share: number): string =>
  new Intl.NumberFormat('fa-IR', { style: 'percent', maximumFractionDigits: 0 }).format(share);

// --- Pieces ------------------------------------------------------------------------

export function StatusBadge({ status }: { status: ConsoleProviderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_WORDS[status]}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: ConsoleProviderConfidence | null }) {
  if (confidence === null) return <Badge>اطمینان نامشخص</Badge>;
  const bars = CONFIDENCE_BARS[confidence];
  return (
    <Badge tone={CONFIDENCE_TONE[confidence]}>
      <span aria-hidden="true" className="me-1 inline-flex items-end gap-px">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`inline-block w-1 rounded-sm ${n <= bars ? CONFIDENCE_FILL[confidence] : 'bg-surface-raised'}`}
            style={{ blockSize: `${n * 0.25 + 0.25}rem` }}
          />
        ))}
      </span>
      {CONFIDENCE_WORDS[confidence]}
    </Badge>
  );
}

export function UnverifiedBadge() {
  return (
    <Badge tone="border-warning text-warning">
      <span aria-hidden="true" className="me-1">
        ؟
      </span>
      {UNVERIFIED}
    </Badge>
  );
}

/** One score on its colour; an unverified one has a dashed edge and a «؟». */
export function ScoreCell({
  fact,
  muted,
}: {
  fact: ConsoleProviderFact | undefined;
  muted: boolean;
}) {
  if (fact === undefined)
    return (
      <span className="text-xs text-caption" title="داده نیامده">
        —<span className="sr-only">داده نیامده</span>
      </span>
    );
  if (fact.score === null)
    return (
      <span className="text-xs text-caption" title={fact.value_fa}>
        بی‌نمره
      </span>
    );
  return (
    <span
      className={`relative inline-flex min-w-9 items-center justify-center rounded-control px-2 py-1 text-sm font-bold ${
        // Left out of a verified-only total: drawn without its tint, its number still there.
        muted ? 'bg-surface text-caption line-through' : `${SCORE_TONE[fact.score]} text-fg`
      } ${fact.verified ? 'border border-transparent' : 'border border-dashed border-warning'}`}
      title={`${fact.value_fa}${fact.verified ? '' : ` (${UNVERIFIED})`}`}
      data-score={fact.score}
      data-verified={fact.verified}
    >
      {fa(fact.score)}
      {!fact.verified && (
        <>
          <span aria-hidden="true" className="ms-0.5 text-xs text-warning">
            ؟
          </span>
          <span className="sr-only"> {UNVERIFIED}</span>
        </>
      )}
    </span>
  );
}

export function TotalCell({ total }: { total: Total }) {
  if (total.value === null) return <span className="text-xs text-caption">بی‌نمره</span>;
  const whole = total.counted === total.of;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="text-base font-bold text-fg">
        {scoreText(total.value)}
        <span className="ms-1 text-xs font-normal text-caption">از ۵</span>
      </span>
      <span className={`text-xs ${whole ? 'text-caption' : 'text-warning'}`}>
        {fa(total.counted)} از {fa(total.of)} معیار
        {!whole && ` · ${percent(total.weight_share)} وزن`}
      </span>
    </span>
  );
}

/** A score bar for the card head, out of 5. */
function TotalBar({ total }: { total: Total }) {
  if (total.value === null) return null;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-raised" aria-hidden="true">
      <div
        className="h-full rounded-pill bg-brand"
        style={{ inlineSize: `${(total.value / 5) * 100}%` }}
      />
    </div>
  );
}

export function priceText(plan: ConsoleProviderPlan) {
  if (plan.price_month === null) return <span className="text-caption">منتشر نشده</span>;
  if (plan.price_month === 0) return <span>رایگان</span>;
  return (
    <span>
      {new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(plan.price_month)}{' '}
      {plan.currency !== null && (
        <span dir="ltr" className="text-xs text-muted">
          {plan.currency}
        </span>
      )}
    </span>
  );
}

/** Words with no Persian letter are the provider's own, left to right: `7,500 / day`. */
export const dirOf = (words: string | null): 'ltr' | 'rtl' =>
  words !== null && !/[\u0600-\u06FF]/.test(words) ? 'ltr' : 'rtl';

export function trialText(plan: ConsoleProviderPlan): string {
  if (plan.trial_note !== null) return plan.trial_note;
  if (plan.trial === true) return 'دارد';
  if (plan.trial === false) return 'ندارد';
  return 'نامشخص';
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function Source({ fact }: { fact: ConsoleProviderFact }) {
  if (fact.source_url !== null)
    return (
      <a
        href={fact.source_url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-brand underline underline-offset-2"
        dir="ltr"
      >
        {hostOf(fact.source_url)}
      </a>
    );
  if (fact.source_note !== null) return <span dir="auto">{fact.source_note}</span>;
  return <span className="text-caption">منبع نیامده</span>;
}

// --- The provider card -------------------------------------------------------------

export function ProviderCard({
  provider,
  criteria,
  verifiedOnly,
}: {
  provider: ConsoleProvider;
  criteria: readonly ConsoleProviderCriterion[];
  verifiedOnly: boolean;
}) {
  const total = weightedTotal(provider, criteria, verifiedOnly);
  const unverified = criteria.filter((c) => provider.facts[c.key]?.verified === false).length;
  return (
    <article
      id={`p-${provider.key}`}
      className="flex scroll-mt-4 flex-col gap-4 rounded-card border border-default bg-surface p-4 md:p-5"
      data-testid="provider-card"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-fg" dir="ltr">
            {provider.name}
          </h3>
          <StatusBadge status={provider.status} />
          <ConfidenceBadge confidence={provider.confidence} />
          {unverified > 0 && (
            <Badge tone="border-warning text-warning">
              {fa(unverified)} واقعیت {UNVERIFIED}
            </Badge>
          )}
        </div>
        {provider.url !== null && (
          <a
            href={provider.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="self-start text-sm text-brand underline underline-offset-2"
            dir="ltr"
          >
            {hostOf(provider.url)}
          </a>
        )}
        <div className="flex max-w-sm flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
            <span>جمع وزنی</span>
            <TotalCell total={total} />
          </div>
          <TotalBar total={total} />
        </div>
        {provider.summary_fa !== null && (
          <p className="max-w-measure text-sm text-fg">{provider.summary_fa}</p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <ListBlock title="نقاط قوت" items={provider.pros_fa} glyph="+" tone="text-success" />
        <ListBlock title="نقاط ضعف" items={provider.cons_fa} glyph="−" tone="text-danger" />
      </div>

      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-tile bg-surface-raised p-3">
          <dt className="text-xs font-bold text-muted">مجوز و نمایش عمومی</dt>
          <dd className="mt-1 text-fg">{provider.licence_fa ?? 'نیامده'}</dd>
        </div>
        <div className="rounded-tile bg-surface-raised p-3">
          <dt className="text-xs font-bold text-muted">تحریم و پرداخت</dt>
          <dd className="mt-1 text-fg">{provider.sanctions_fa ?? 'نیامده'}</dd>
        </div>
      </dl>

      <details className="group">
        <summary className="min-h-touch cursor-pointer text-sm font-bold text-fg">
          واقعیت‌ها با منبع ({fa(Object.keys(provider.facts).length)})
        </summary>
        <ul className="mt-2 flex flex-col divide-y divide-default">
          {criteria.map((criterion) => {
            const fact = provider.facts[criterion.key];
            return (
              <li key={criterion.key} className="flex flex-col gap-1.5 py-3" data-testid="fact">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-fg">{criterion.label_fa}</span>
                  <ScoreCell fact={fact} muted={verifiedOnly && fact?.verified === false} />
                  {fact !== undefined && !fact.verified && <UnverifiedBadge />}
                </div>
                {fact === undefined ? (
                  <p className="text-sm text-caption">پژوهش درباره‌ی این معیار چیزی نیاورده است.</p>
                ) : (
                  <>
                    <p className="text-sm text-fg">{fact.value_fa}</p>
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      <span>
                        منبع: <Source fact={fact} />
                      </span>
                      <span>
                        بررسی: {fact.checked === null ? 'روزش نیامده' : when(fact.checked, false)}
                      </span>
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </article>
  );
}

function ListBlock({
  title,
  items,
  glyph,
  tone,
}: {
  title: string;
  items: readonly string[];
  glyph: string;
  tone: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-bold text-fg">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-caption">نیامده</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-sm text-fg">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className={`font-bold ${tone}`}>
                {glyph}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Links that keep the other choices ----------------------------------------------

export interface View {
  sort: SortKey;
  dir: SortDir;
  status: ConsoleProviderStatus | 'all';
  verifiedOnly: boolean;
}

/** The address's choices, as Next gives them. */
export interface ViewParams {
  sort?: string | string[];
  dir?: string | string[];
  status?: string | string[];
  verified?: string | string[];
}

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** The view the address asks for; anything it does not know falls back to the default. */
export function viewOf(raw: ViewParams, criteria: readonly { key: string }[]): View {
  const sort = one(raw.sort);
  const status = one(raw.status);
  const validSort: SortKey =
    sort === 'name' || sort === 'price' || sort === 'total'
      ? sort
      : sort !== undefined && sort.startsWith('c:') && criteria.some((c) => `c:${c.key}` === sort)
        ? (sort as SortKey)
        : 'total';
  return {
    sort: validSort,
    dir: one(raw.dir) === 'asc' ? 'asc' : ('desc' as SortDir),
    status: (CONSOLE_PROVIDER_STATUSES as readonly unknown[]).includes(status)
      ? (status as ConsoleProviderStatus)
      : 'all',
    verifiedOnly: one(raw.verified) === '1',
  };
}

export function viewHref(view: View, change: Partial<View>): string {
  const next = { ...view, ...change };
  const query = new URLSearchParams();
  if (next.sort !== 'total') query.set('sort', next.sort);
  if (next.dir !== 'desc') query.set('dir', next.dir);
  if (next.status !== 'all') query.set('status', next.status);
  if (next.verifiedOnly) query.set('verified', '1');
  const q = query.toString();
  return `/providers${q === '' ? '' : `?${q}`}#matrix`;
}

/** A column head that sorts by it; a second press turns the order round. */
export function SortHead({
  view,
  sort,
  children,
  firstDir = 'desc',
}: {
  view: View;
  sort: SortKey;
  children: ReactNode;
  firstDir?: SortDir;
}) {
  const active = view.sort === sort;
  const dir: SortDir = active ? (view.dir === 'desc' ? 'asc' : 'desc') : firstDir;
  return (
    <Link
      href={viewHref(view, { sort, dir })}
      className={`inline-flex min-h-touch items-center gap-1 rounded-control px-1 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus ${
        active ? 'text-fg' : 'text-muted'
      }`}
    >
      {children}
      <span aria-hidden="true" className="text-xs">
        {active ? (view.dir === 'desc' ? '▼' : '▲') : '↕'}
      </span>
      {active && (
        <span className="sr-only">{view.dir === 'desc' ? 'مرتب: نزولی' : 'مرتب: صعودی'}</span>
      )}
    </Link>
  );
}
