import type { Metadata } from 'next';
import type { ConsoleProviders, ConsoleProviderStatus, ConsoleReport } from '@fmip/contracts';
import { CONSOLE_PROVIDER_STATUSES } from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleSnapshot } from '@/lib/console-api';
import {
  ConfidenceBadge,
  ProviderCard,
  STATUS_WORDS,
  ScoreCell,
  SortHead,
  StatusBadge,
  TotalCell,
  UNVERIFIED,
  type View,
  type ViewParams,
  viewOf,
  priceText,
  sortProviders,
  dirOf,
  trialText,
  viewHref,
  weightedTotal,
} from '../../providers';
import { Card, fa, when } from '../../ui';

export const metadata: Metadata = { title: 'مقایسه‌ی ارائه‌دهنده‌های داده' };

/** Past this, the research is old enough that prices and terms may have changed (rule 4). */
const STALE_DAYS = 60;

type Props = { searchParams: Promise<ViewParams> };

const SECTIONS = [
  { id: 'summary', title: 'خلاصه و پیشنهاد' },
  { id: 'matrix', title: 'جدول مقایسه' },
  { id: 'plans', title: 'پلن‌ها و قیمت‌ها' },
  { id: 'providers', title: 'جزئیات هر ارائه‌دهنده' },
  { id: 'next', title: 'گام‌های بعد' },
];

/**
 * The football data providers' comparison (T-1830, D-423): the research
 * agent's file on the maintainer's computer, carried in the snapshot. The
 * summary with the recommendation and what we use now; a matrix of scores,
 * sortable and filterable by the address (no script, so it works the same on
 * a phone); the plans; a card per provider with its facts and their sources;
 * the next steps. A missing file is said, never filled in (rule 3).
 */
export default async function ConsoleProvidersPage({ searchParams }: Props) {
  const [snapshot, raw] = await Promise.all([consoleSnapshot(), searchParams]);
  const comparison = snapshot.ok ? (snapshot.data.snapshot?.providers ?? null) : null;
  // The research's full written report, when the snapshot carries it (the business adviser's).
  const report = snapshot.ok
    ? (snapshot.data.snapshot?.reports ?? [])
        .filter((r) => r.agent === 'business-adviser' && /provider/i.test(r.path))
        .sort((a, b) => b.date.localeCompare(a.date))[0]
    : undefined;

  if (!snapshot.ok) {
    return (
      <Card title="مقایسه‌ی ارائه‌دهنده‌های داده">
        <p className="text-sm text-danger" role="alert">
          داده‌ی کنسول خوانده نشد. چند دقیقه‌ی دیگر دوباره سر بزنید.
        </p>
      </Card>
    );
  }
  if (comparison === null) {
    return (
      <>
        <Heading report={report} />
        <Card>
          <p className="text-sm text-muted" data-coverage="not_supplied">
            مقایسه هنوز از رایانه نرسیده است. وقتی پژوهش فایل{' '}
            <span dir="ltr">E:/FMIP/ops/providers/comparison.json</span> را نوشت، با همگام‌سازی بعدی
            اینجا می‌آید.
          </p>
        </Card>
      </>
    );
  }
  return (
    <Comparison comparison={comparison} view={viewOf(raw, comparison.criteria)} report={report} />
  );
}

function Heading({
  comparison,
  report,
}: {
  comparison?: ConsoleProviders;
  report?: ConsoleReport;
}) {
  const ageDays =
    comparison === undefined
      ? 0
      : (new Date().getTime() - new Date(comparison.updated_at).getTime()) / 86_400_000;
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-bold">مقایسه‌ی ارائه‌دهنده‌های داده</h1>
      <p className="max-w-measure text-sm text-muted">
        ارائه‌دهنده‌های API داده‌ی فوتبال، سنجیده با معیارهای خود پروژه. این صفحه فقط آنچه پژوهش
        نوشته نشان می‌دهد؛ چیزی نمی‌خرد و تصمیمی نمی‌گیرد.
      </p>
      {comparison !== undefined && (
        <p className={`text-xs ${ageDays > STALE_DAYS ? 'text-warning' : 'text-caption'}`}>
          آخرین به‌روزرسانی پژوهش: {when(comparison.updated_at)}
          {ageDays > STALE_DAYS &&
            ` — بیش از ${fa(STALE_DAYS)} روز گذشته؛ قیمت‌ها و شرایط ممکن است عوض شده باشند.`}
        </p>
      )}
      {report !== undefined && (
        <Link
          href={`/reports?path=${encodeURIComponent(report.path)}`}
          className="self-start text-sm text-brand underline underline-offset-2"
          data-testid="full-report"
        >
          گزارش کامل پژوهش ({when(report.date, false)})
        </Link>
      )}
    </div>
  );
}

function Comparison({
  comparison,
  view,
  report,
}: {
  comparison: ConsoleProviders;
  view: View;
  report: ConsoleReport | undefined;
}) {
  const { criteria } = comparison;
  const shown = sortProviders(
    comparison.providers.filter((p) => view.status === 'all' || p.status === view.status),
    criteria,
    view.sort,
    view.dir,
    view.verifiedOnly,
  );
  const allWeight = criteria.reduce((a, c) => a + c.weight, 0);
  const facts = comparison.providers.flatMap((p) => Object.values(p.facts));
  const unverified = facts.filter((f) => !f.verified).length;
  const counts = Object.fromEntries(
    CONSOLE_PROVIDER_STATUSES.map((s) => [
      s,
      comparison.providers.filter((p) => p.status === s).length,
    ]),
  ) as Record<ConsoleProviderStatus, number>;

  return (
    <>
      <Heading comparison={comparison} report={report} />
      <nav aria-label="بخش‌های صفحه" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <ul className="flex gap-1.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex min-h-touch items-center whitespace-nowrap rounded-pill border border-default bg-surface px-3 text-sm text-fg hover:border-strong"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {comparison.skipped > 0 && (
        <p className="rounded-tile border border-warning p-3 text-sm text-warning" role="status">
          {fa(comparison.skipped)} مورد از فایل پژوهش بررسی را رد نکرد و نشان داده نمی‌شود؛ روی
          رایانه <span dir="ltr">providers-check</span> فهرستشان را می‌دهد.
        </p>
      )}

      <section id="summary" className="grid scroll-mt-4 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-card border-2 border-brand bg-surface p-4 md:p-5 lg:col-span-2">
          <h2 className="text-base font-bold text-fg">پیشنهاد پژوهش</h2>
          <p className="max-w-measure text-sm leading-7 text-fg">
            {comparison.recommendation_fa ?? 'پژوهش پیشنهادی ننوشته است.'}
          </p>
          <p className="text-xs text-caption">
            پیشنهاد عامل پژوهش است، نه تصمیم؛ خرید یا تغییر ارائه‌دهنده با نگهدارنده است.
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-default bg-surface p-4 md:p-5">
          <h2 className="text-base font-bold text-fg">آنچه الان به کار می‌بریم</h2>
          <p className="text-sm leading-7 text-fg">
            {comparison.current_stack_fa ?? 'نیامده است.'}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 lg:col-span-3">
          <Figure label="ارائه‌دهنده" value={fa(comparison.providers.length)} />
          <Figure label="معیار" value={fa(criteria.length)} />
          <Figure
            label={`واقعیت ${UNVERIFIED}`}
            value={`${fa(unverified)} از ${fa(facts.length)}`}
            tone={unverified > 0 ? 'text-warning' : 'text-fg'}
          />
        </div>
        {(comparison.needs_fa.length > 0 || comparison.method_fa !== null) && (
          <div className="grid gap-4 lg:col-span-3 lg:grid-cols-2">
            {comparison.needs_fa.length > 0 && (
              <Card title="نیازهای پروژه">
                <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-fg">
                  {comparison.needs_fa.map((need) => (
                    <li key={need}>{need}</li>
                  ))}
                </ul>
              </Card>
            )}
            {comparison.method_fa !== null && (
              <Card title="روش سنجش">
                <p className="text-sm leading-7 text-muted">{comparison.method_fa}</p>
              </Card>
            )}
          </div>
        )}
      </section>

      <section
        id="matrix"
        className="flex scroll-mt-4 flex-col gap-3 rounded-card border border-default bg-surface p-4 md:p-5"
      >
        <h2 className="text-base font-bold text-fg">جدول مقایسه</h2>
        <Filters view={view} counts={counts} total={comparison.providers.length} />
        <Legend />
        {shown.length === 0 ? (
          <p className="text-sm text-muted">ارائه‌دهنده‌ای با این وضعیت نیست.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" data-testid="matrix">
            <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">
                نمره‌ی هر ارائه‌دهنده روی هر معیار از ۱ تا ۵ و جمع وزنی
              </caption>
              <thead>
                <tr className="align-bottom text-xs">
                  <th
                    scope="col"
                    className="sticky start-0 z-10 border-b border-default bg-surface pe-3 text-start font-bold"
                    aria-sort={
                      view.sort === 'name'
                        ? view.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    <SortHead view={view} sort="name" firstDir="asc">
                      ارائه‌دهنده
                    </SortHead>
                  </th>
                  {criteria.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="border-b border-default px-1 text-center font-bold"
                      aria-sort={
                        view.sort === `c:${c.key}`
                          ? view.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                    >
                      <SortHead view={view} sort={`c:${c.key}`}>
                        <span className="flex flex-col items-center">
                          <span>{c.label_fa}</span>
                          <span className="font-normal text-caption">
                            وزن{' '}
                            {allWeight === 0
                              ? fa(c.weight)
                              : `${fa(Math.round((c.weight / allWeight) * 100))}٪`}
                          </span>
                        </span>
                      </SortHead>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="border-b border-default ps-3 text-start font-bold"
                    aria-sort={
                      view.sort === 'total'
                        ? view.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    <SortHead view={view} sort="total">
                      جمع وزنی
                    </SortHead>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.key} data-testid="matrix-row" data-provider={p.key}>
                    <th
                      scope="row"
                      className="sticky start-0 z-10 border-b border-default bg-surface py-2 pe-3 text-start align-middle font-normal"
                    >
                      <a
                        href={`#p-${p.key}`}
                        className="font-bold text-fg hover:underline"
                        dir="ltr"
                      >
                        {p.name}
                      </a>
                      <div className="mt-1">
                        <StatusBadge status={p.status} />
                      </div>
                    </th>
                    {criteria.map((c) => {
                      const fact = p.facts[c.key];
                      return (
                        <td
                          key={c.key}
                          className="border-b border-default px-1 py-2 text-center align-middle"
                        >
                          <ScoreCell
                            fact={fact}
                            muted={view.verifiedOnly && fact !== undefined && !fact.verified}
                          />
                        </td>
                      );
                    })}
                    <td className="border-b border-default py-2 ps-3 align-middle">
                      <TotalCell total={weightedTotal(p, criteria, view.verifiedOnly)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-caption">
          جمع وزنی = مجموع (وزن × نمره) ÷ مجموع وزن معیارهای نمره‌دار. معیار بی‌نمره هیچ عددی فرض
          نمی‌شود؛ زیر جمع نوشته می‌شود چند معیار و چه سهمی از وزن شمرده شد.
          {view.verifiedOnly && ' اکنون فقط نمره‌های تأییدشده شمرده می‌شوند.'}
        </p>
      </section>

      <section id="plans" className="scroll-mt-4">
        <Card title="پلن‌ها و قیمت‌ها">
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <table className="w-full min-w-[36rem] text-sm" data-testid="plans">
              <caption className="sr-only">پلن‌های هر ارائه‌دهنده با قیمت ماهانه</caption>
              <thead>
                <tr className="text-start text-xs text-muted">
                  <th scope="col" className="border-b border-default py-2 pe-3 text-start">
                    ارائه‌دهنده
                  </th>
                  <th scope="col" className="border-b border-default py-2 pe-3 text-start">
                    پلن
                  </th>
                  <th scope="col" className="border-b border-default py-2 pe-3 text-start">
                    قیمت ماهانه
                  </th>
                  <th scope="col" className="border-b border-default py-2 pe-3 text-start">
                    سقف درخواست
                  </th>
                  <th scope="col" className="border-b border-default py-2 pe-3 text-start">
                    رقابت‌ها
                  </th>
                  <th scope="col" className="border-b border-default py-2 text-start">
                    دوره‌ی آزمایشی
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.flatMap((p) =>
                  p.plans.length === 0
                    ? [
                        <tr key={p.key}>
                          <th
                            scope="row"
                            className="border-b border-default py-2 pe-3 text-start font-bold"
                            dir="ltr"
                          >
                            {p.name}
                          </th>
                          <td colSpan={5} className="border-b border-default py-2 text-caption">
                            پلنی نیامده است.
                          </td>
                        </tr>,
                      ]
                    : p.plans.map((plan, i) => (
                        <tr
                          key={`${p.key}-${plan.name}-${i}`}
                          className={p.status === 'current' ? 'bg-brand/5' : undefined}
                        >
                          {i === 0 && (
                            <th
                              scope="rowgroup"
                              rowSpan={p.plans.length}
                              className="border-b border-default py-2 pe-3 text-start align-top font-bold"
                            >
                              <span dir="ltr">{p.name}</span>
                            </th>
                          )}
                          <td className="border-b border-default py-2 pe-3" dir="ltr">
                            <span className="block text-start">{plan.name}</span>
                          </td>
                          <td className="border-b border-default py-2 pe-3 tabular-nums">
                            {priceText(plan)}
                          </td>
                          <td className="border-b border-default py-2 pe-3">
                            <span dir={dirOf(plan.requests)}>{plan.requests ?? '—'}</span>
                          </td>
                          <td className="border-b border-default py-2 pe-3">
                            <span dir={dirOf(plan.leagues)}>{plan.leagues ?? '—'}</span>
                          </td>
                          <td className="border-b border-default py-2">{trialText(plan)}</td>
                        </tr>
                      )),
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-caption">
            قیمت‌ها به ارز خود هر ارائه‌دهنده است و با هم جمع یا تبدیل نمی‌شوند. «منتشر نشده» یعنی
            قیمت فقط با قرارداد معلوم می‌شود.
          </p>
        </Card>
      </section>

      <section id="providers" className="flex scroll-mt-4 flex-col gap-4">
        <h2 className="text-base font-bold text-fg">جزئیات هر ارائه‌دهنده</h2>
        {shown.map((p) => (
          <ProviderCard
            key={p.key}
            provider={p}
            criteria={criteria}
            verifiedOnly={view.verifiedOnly}
          />
        ))}
      </section>

      <section id="next" className="scroll-mt-4">
        <Card title="گام‌های بعد">
          {comparison.next_steps_fa.length === 0 ? (
            <p className="text-sm text-muted">پژوهش گام بعدی ننوشته است.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm text-fg">
              {comparison.next_steps_fa.map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-brand text-xs font-bold text-on-brand">
                    {fa(i + 1)}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>
    </>
  );
}

function Figure({
  label,
  value,
  tone = 'text-fg',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-tile border border-default bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function Filters({
  view,
  counts,
  total,
}: {
  view: View;
  counts: Record<ConsoleProviderStatus, number>;
  total: number;
}) {
  const chip = (active: boolean) =>
    `inline-flex min-h-touch items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
      active
        ? 'border-brand bg-brand font-bold text-on-brand'
        : 'border-default bg-surface text-muted hover:text-fg'
    }`;
  const tabs: (ConsoleProviderStatus | 'all')[] = ['all', ...CONSOLE_PROVIDER_STATUSES];
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <nav
        aria-label="وضعیت ارائه‌دهنده"
        className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        <ul className="flex gap-1.5">
          {tabs.map((tab) => (
            <li key={tab}>
              <Link
                href={viewHref(view, { status: tab })}
                aria-current={view.status === tab ? 'page' : undefined}
                className={chip(view.status === tab)}
              >
                {tab === 'all' ? 'همه' : STATUS_WORDS[tab]}
                <span className="text-xs opacity-80">
                  {fa(tab === 'all' ? total : counts[tab])}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Link
        href={viewHref(view, { verifiedOnly: !view.verifiedOnly })}
        aria-pressed={view.verifiedOnly}
        className={chip(view.verifiedOnly)}
        data-testid="verified-only"
      >
        <span aria-hidden="true">{view.verifiedOnly ? '☑' : '☐'}</span>
        فقط نمره‌های تأییدشده
      </Link>
    </div>
  );
}

function Legend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted"
      aria-label="راهنمای رنگ‌ها"
    >
      <span className="flex items-center gap-1">
        <span>ضعیف</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <ScoreCell
            key={n}
            fact={{
              value_fa: '',
              score: n,
              source_url: null,
              source_note: null,
              checked: null,
              verified: true,
            }}
            muted={false}
          />
        ))}
        <span>عالی</span>
      </span>
      <span className="flex items-center gap-1">
        <ScoreCell
          fact={{
            value_fa: UNVERIFIED,
            score: 3,
            source_url: null,
            source_note: null,
            checked: null,
            verified: false,
          }}
          muted={false}
        />
        <span>لبه‌ی خط‌چین و «؟» = {UNVERIFIED}</span>
      </span>
      <span>«—» = داده نیامده</span>
      <ConfidenceBadge confidence="high" />
      <span>= اطمینان پژوهش به کل ردیف</span>
    </div>
  );
}
