import { ConsoleLink as Link } from '@/app/console/console-link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  type AccuracyPoint,
  type ConsoleModelCalibrationBand,
  type ConsoleModelComparison,
  type ConsoleModelEstimate,
  type ConsoleModelLab,
  type ConsoleModelReport,
  type ConsoleModelVersion,
  type ConsoleReport,
} from '@fmip/contracts';
import {
  CONSOLE_MODEL_CALIBRATION_MINIMUM,
  CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM,
  CONSOLE_MODEL_NO_WORSE_MARGIN,
  CONSOLE_MODEL_PAIRED_MINIMUM,
} from '@fmip/contracts/console';
import { consoleModel, consoleSnapshot } from '@/lib/console-api';
import {
  CalibrationPanels,
  CountMeter,
  DifferenceStrip,
  IntervalAxis,
  IntervalStrip,
  OUTCOME_WORDS,
  TileStrip,
  TrendPanel,
  WithheldStrip,
  calibrationMax,
  interval,
  intervalScale,
  percent,
  score,
  signed,
  trendDomain,
} from '../../model-charts';
import { Forest, Judgements, LedgerCards, LedgerState } from '../../model-ledger';
import { MODEL_VERSIONS, type VersionNumber, versionNumber } from '../../model-notes';
import {
  MakeupMatrix,
  MethodSchematic,
  ModelSchematic,
  VersionDeltas,
} from '../../model-schematic';
import { Badge, Card, fa, when } from '../../ui';

export const metadata: Metadata = { title: 'مدل پیش‌بینی' };

/** Past this, no match has been scored for a while, and the page says so (rule 4). */
const STALE_HOURS = 72;
/** The paired-difference strips' shared scale: ±0.05 of log loss per match. */
const PAIR_HALF = 0.05;

const STATE_WORDS: Record<ConsoleModelVersion['state'], string> = {
  published_now: 'منتشرشده‌ی الان',
  shadow_now: 'در shadow الان',
  earlier: 'پیشین',
};

const roleWords = (v: { role: 'published' | 'shadow'; state?: ConsoleModelVersion['state'] }) =>
  v.state !== undefined && v.state !== 'earlier'
    ? STATE_WORDS[v.state]
    : v.role === 'published'
      ? 'منتشرشده‌ی پیشین'
      : 'shadow پیشین';

const SECTIONS: { id: string; title: string }[] = [
  { id: 'now', title: 'الان' },
  { id: 'model', title: 'مدل چطور ساخته شده' },
  { id: 'records', title: 'کارنامه‌ی هر نسخه' },
  { id: 'compare', title: 'مقایسه‌ی نسخه‌ها' },
  { id: 'calibration', title: 'calibration و روند' },
  { id: 'ledger', title: 'دفتر آزمایش‌ها' },
  { id: 'unknown', title: 'آنچه نمی‌دانیم' },
  { id: 'words', title: 'واژه‌ها' },
];

/**
 * The forecast model, in full (T-1729, D-355; rebuilt T-1752, D-371): what
 * is on the site and how good it is now, what the model is made of and what
 * each version changed, every version's record, how versions are compared
 * and the comparison itself, calibration and the weekly trend per version,
 * the lab's ledger of everything tested, and what is not known. Every
 * figure is `GET /console/model`'s, from the stored forecasts and
 * evaluations; the make-up is `model-notes.ts`; the ledger is the
 * snapshot's. A version in shadow now is never given a figure of its
 * promotion conditions here: that look is the weekly watch's, once.
 */
export default async function ConsoleModelPage() {
  const [result, snapshot] = await Promise.all([consoleModel(), consoleSnapshot()]);
  const reports = snapshot.ok ? (snapshot.data.snapshot?.reports ?? []) : [];
  const weekly = reports
    .filter((r) => r.agent === 'model-scientist')
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const lab = snapshot.ok ? (snapshot.data.snapshot?.model_lab ?? null) : null;

  if (!result.ok || !Array.isArray(result.data.versions)) {
    return (
      <Card title="مدل پیش‌بینی">
        <p className="text-sm text-danger">
          اعداد مدل از API نرسید. چند دقیقه‌ی دیگر دوباره سر بزنید.
        </p>
      </Card>
    );
  }
  const report = result.data;
  return (
    <>
      <PageNav />
      <NowSection report={report} lab={lab} />
      <ModelSection report={report} />
      <RecordsSection report={report} />
      <CompareSection report={report} lab={lab} weekly={weekly} />
      <CalibrationSection report={report} />
      <LedgerSection lab={lab} />
      <UnknownSection report={report} />
      <Glossary />
    </>
  );
}

// --- Navigation -------------------------------------------------------------------

function PageNav() {
  const links = SECTIONS.map((s) => (
    <li key={s.id}>
      <a
        href={`#${s.id}`}
        className="inline-flex min-h-touch items-center rounded-pill border border-default bg-surface px-3 text-sm text-fg hover:border-strong"
      >
        {s.title}
      </a>
    </li>
  ));
  return (
    <nav aria-label="بخش‌های صفحه" data-testid="page-nav">
      <ul className="hidden flex-wrap gap-2 lg:flex">{links}</ul>
      <details className="lg:hidden">
        <summary className="min-h-touch cursor-pointer rounded-tile bg-surface px-3 py-2 text-sm text-fg">
          فهرست بخش‌ها
        </summary>
        <ul className="mt-2 grid grid-cols-2 gap-2">{links}</ul>
      </details>
    </nav>
  );
}

const Section = ({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) => (
  <div id={id} className="scroll-mt-20" data-testid={`section-${id}`}>
    <Card title={title}>
      {lead !== undefined && <p className="text-sm leading-7 text-muted">{lead}</p>}
      {children}
    </Card>
  </div>
);

const Sub = ({
  title,
  lead,
  children,
  testid,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  testid?: string;
}) => (
  <section className="mt-6 border-t border-default pt-5" data-testid={testid}>
    <h3 className="text-base font-bold text-fg">{title}</h3>
    {lead !== undefined && <p className="mt-1 text-sm leading-7 text-muted">{lead}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

// --- 1. Now -------------------------------------------------------------------------

function Tile({
  label,
  estimate,
  guess,
  better,
  format,
  guessWords,
}: {
  label: string;
  estimate: ConsoleModelEstimate;
  guess: number;
  better: 'lower' | 'higher';
  format: (v: number) => string;
  guessWords?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-tile bg-surface-raised p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-3xl font-bold text-fg">{format(estimate.mean)}</span>
      <span className="text-xs text-caption">
        {interval(estimate, format) === ''
          ? 'بازه ندارد'
          : `بازه‌ی ۹۵٪: ${interval(estimate, format)}`}
      </span>
      <TileStrip
        estimate={estimate}
        guess={guess}
        better={better}
        label={`${label} ${format(estimate.mean)}، بازه ${interval(estimate, format)}، حدس یک‌سوم ${format(guess)}`}
      />
      <span className="text-xs text-muted">
        {guessWords ?? 'حدس یک‌سوم'}: {format(guess)} ·{' '}
        {better === 'lower' ? 'کمتر بهتر است' : 'بیشتر بهتر است'}
      </span>
    </div>
  );
}

function NowSection({ report, lab }: { report: ConsoleModelReport; lab: ConsoleModelLab | null }) {
  const published = report.published;
  const site = report.versions.find((v) => v.state === 'published_now');
  const note =
    published === null
      ? undefined
      : MODEL_VERSIONS[versionNumber(published.model_version) as VersionNumber];
  const record = published?.record;
  const hours =
    report.last_updated_at === null
      ? null
      : (Date.parse(report.generated_at) - Date.parse(report.last_updated_at)) / 3_600_000;
  const ref = report.reference;
  return (
    <Section
      id="now"
      title="الان"
      lead="این صفحه فقط مدل آماری را نشان می‌دهد. تحلیل بنیان‌گذار و پیش‌بینی جامعه جدا هستند و اینجا شمرده نمی‌شوند."
    >
      {published === null ? (
        <p className="mt-3 text-sm text-fg" data-testid="no-published">
          هنوز هیچ پیش‌بینی منتشرشده‌ای ثبت نشده است.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm text-muted">نسخه‌ی منتشرشده</span>
            <span className="text-lg font-bold text-fg" dir="ltr" data-testid="published-version">
              {published.model_version}
            </span>
            <span className="text-sm text-muted">
              {published.since === null
                ? 'هنوز پیش‌بینی‌ای از آن ذخیره نشده'
                : `روی سایت از ${when(published.since, false)}`}
              {note !== undefined && <> · {note.decision}</>}
            </span>
          </div>
          {record === undefined || record.matches === 0 ? (
            <p className="text-sm text-muted" data-testid="no-accuracy">
              هنوز هیچ پیش‌بینی پیش از شروعی از نسخه‌ی منتشرشده ارزیابی نشده؛ عددی برای نشان دادن
              نیست.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted" data-testid="sample">
                همه‌ی اعداد زیر روی <span className="font-bold text-fg">{fa(record.matches)}</span>{' '}
                مسابقه، از {when(record.first_kickoff_at, false)} تا{' '}
                {when(record.last_kickoff_at, false)}؛ هر مسابقه یک بار، با آخرین پیش‌بینی پیش از
                سوت آغاز.
                {record.coverage === 'limited' &&
                  ` کمتر از ${fa(report.minimum_matches)} مسابقه است؛ رکورد اولیه.`}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpis">
                {record.accuracy !== null && (
                  <Tile
                    label="درصد درست"
                    estimate={record.accuracy}
                    guess={ref.uniform_accuracy}
                    better="higher"
                    format={(v) => percent(v)}
                  />
                )}
                {record.log_loss !== null && (
                  <Tile
                    label="log loss"
                    estimate={record.log_loss}
                    guess={ref.uniform_log_loss}
                    better="lower"
                    format={(v) => score(v)}
                  />
                )}
                {record.brier !== null && (
                  <Tile
                    label="Brier"
                    estimate={record.brier}
                    guess={ref.uniform_brier}
                    better="lower"
                    format={(v) => score(v)}
                  />
                )}
                {record.rps !== null && record.uniform_rps !== null && (
                  <Tile
                    label="RPS"
                    estimate={record.rps}
                    guess={record.uniform_rps}
                    better="lower"
                    format={(v) => score(v)}
                    guessWords="حدس یک‌سوم روی همین مسابقه‌ها"
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-col gap-1 text-xs text-caption">
        {report.service === 'unreachable' && (
          <p className="text-warning">
            سرویس مدل پاسخ نداد؛ نسخه‌ها از آخرین پیش‌بینی‌های ذخیره‌شده خوانده شد.
          </p>
        )}
        <p>
          آخرین ارزیابی: {when(report.last_updated_at)}
          {hours !== null && hours > STALE_HOURS && (
            <span className="text-warning">
              {' '}
              — بیش از سه روز است که مسابقه‌ی تازه‌ای ارزیابی نشده.
            </span>
          )}
        </p>
        {published?.unscored && (
          <p data-testid="unscored">
            از {fa(published.unscored.finished)} مسابقه‌ی تمام‌شده‌ی رقابت‌های این نسخه از آن زمان،{' '}
            {fa(published.unscored.without)} مسابقه هیچ پیش‌بینی منتشرشده‌ی پیش از شروعی ندارد (مدل
            نتوانست یا دیر شد) و در کارنامه نیست.
          </p>
        )}
        {site !== undefined && site.record.limited !== null && site.record.matches > 0 && (
          <p data-testid="limited">
            در {fa(site.record.limited)} مسابقه از {fa(site.record.matches)}، خود مدل داده‌اش را
            «محدود» گفته است؛ این‌ها هم شمرده شده‌اند.
          </p>
        )}
      </div>
      {report.candidates.length > 0 && (
        <div className="mt-5 border-t border-default pt-4" data-testid="shadow-now">
          <h3 className="text-sm font-bold text-fg">در shadow (آزمایشی، روی سایت نمی‌آید)</h3>
          <ul className="mt-2 flex flex-col gap-4">
            {report.candidates.map((c) => {
              const cnote = MODEL_VERSIONS[versionNumber(c.model_version) as VersionNumber];
              return (
                <li key={c.model_version} className="text-sm leading-7" data-testid="candidate">
                  <span className="font-bold text-fg" dir="ltr">
                    {c.model_version}
                  </span>
                  <span className="text-muted">
                    {' '}
                    · از {when(c.first_forecast_at, false)}
                    {cnote !== undefined && <> · {cnote.decision}</>}
                    {' · '}
                    {c.in_service === null
                      ? 'سرویس مدل پاسخ نداد'
                      : c.in_service
                        ? 'سرویس مدل الان آن را اجرا می‌کند'
                        : 'سرویس مدل دیگر آن را اجرا نمی‌کند'}
                  </span>
                  <p className="text-fg">
                    {cnote?.delta ?? 'شرح این نسخه هنوز در کنسول نوشته نشده است.'}
                  </p>
                  <div className="mt-2 grid gap-4 md:grid-cols-2">
                    <CountMeter
                      count={c.paired.matches}
                      needed={CONSOLE_MODEL_PAIRED_MINIMUM}
                      label={
                        cnote?.rule === 'D-336'
                          ? 'شرط «بدتر نیست»: مسابقه‌های مشترک'
                          : 'مسابقه‌های مشترک با نسخه‌ی منتشرشده'
                      }
                    />
                    {cnote?.rule === 'D-336' && (
                      <CountMeter
                        count={c.new_divisions.matches}
                        needed={CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM}
                        label="شرط «بهتر از حدس» در لیگ‌های تازه: مسابقه‌ها"
                      />
                    )}
                  </div>
                  <JudgementSlot lab={lab} modelVersion={c.model_version} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

/** What the weekly watch has recorded about a candidate's conditions, or that it has not. */
function JudgementSlot({
  lab,
  modelVersion,
}: {
  lab: ConsoleModelLab | null;
  modelVersion: string;
}) {
  const recorded = lab?.judgements.some((j) => j.model_version === modelVersion) ?? false;
  return (
    <div
      className="mt-2 rounded-tile border border-default p-3 text-sm"
      data-testid="judgement-slot"
    >
      <p className="text-fg">
        <span aria-hidden="true" className="me-1">
          🔒
        </span>
        حکم ثبت‌شده:{' '}
        {recorded ? (
          'به ترتیب زیر'
        ) : (
          <span className="text-muted">
            هنوز ثبت نشده؛ هر شرط فقط یک بار، در اولین پایش هفتگی که شمارش کامل است، داوری می‌شود
            (D-336، اصلاحیه‌ی T-1720). عددهای این مقایسه تا آن روز اینجا نمی‌آید.
          </span>
        )}
      </p>
      {lab !== null && <Judgements judgements={lab.judgements} modelVersion={modelVersion} />}
    </div>
  );
}

// --- 2. The model ------------------------------------------------------------------

function ModelSection({ report }: { report: ConsoleModelReport }) {
  const stored = report.versions.filter(
    (v, i, all) => all.findIndex((o) => o.model_version === v.model_version) === i,
  );
  return (
    <Section
      id="model"
      title="مدل چطور ساخته شده"
      lead="یک خط‌لوله برای همه‌ی نسخه‌ها؛ نسخه‌ها در این فرق دارند که کدام بخش را به‌کار می‌برند. روی هر جزء، یک گل‌میخ برای هر نسخه‌ای که پیش‌بینی ذخیره کرده: پر یعنی به‌کار می‌برد، «+» یعنی نخستین نسخه‌ی ذخیره‌شده‌ای که به‌کارش برد (نسخه‌های 0.2.0 تا 0.4.0 پیش‌بینی ذخیره نکردند؛ جدول زیر همه را دارد)."
    >
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="version-key">
        {stored.map((v) => (
          <div key={v.model_version} className="flex items-baseline gap-2">
            <dt className="font-bold text-fg" dir="ltr">
              {versionNumber(v.model_version)}
            </dt>
            <dd className="text-muted">
              {roleWords(v)} · {when(v.first_forecast_at, false)} تا{' '}
              {when(v.last_forecast_at, false)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <ModelSchematic inputs={report.inputs} versions={report.versions} />
      </div>
      {report.inputs.length === 0 && (
        <p className="text-xs text-warning" data-testid="inputs-uncounted">
          شمار داده‌ی ورودی این بار از پایگاه خوانده نشد.
        </p>
      )}
      <Sub
        title="هر نسخه چه چیزی را عوض کرد"
        lead="همه‌ی نسخه‌هایی که ساخته شده‌اند، حتی آن‌هایی که هرگز پیش‌بینی ذخیره نکردند. ستونی که از ستون قبلی فرق دارد با «تازه» نشان داده شده."
        testid="versions-makeup"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <MakeupMatrix />
          <VersionDeltas versions={report.versions} />
        </div>
      </Sub>
    </Section>
  );
}

// --- 3. Every version's record -----------------------------------------------------

const figureCell = (
  estimate: ConsoleModelEstimate | null,
  guess: number | null,
  format: (v: number) => string,
  better: 'lower' | 'higher',
) =>
  estimate === null ? (
    <span className="text-caption">—</span>
  ) : (
    <span className="flex flex-col">
      <span className="font-bold text-fg">{format(estimate.mean)}</span>
      {guess !== null && (
        <span className="text-xs text-muted">
          {better === 'higher'
            ? `${signed((estimate.mean - guess) * 100, 1)} واحد درصد`
            : signed(estimate.mean - guess, 4)}{' '}
          نسبت به حدس
        </span>
      )}
      <span className="text-xs text-caption" dir="ltr">
        {interval(estimate, format)}
      </span>
    </span>
  );

function RecordsSection({ report }: { report: ConsoleModelReport }) {
  const ref = report.reference;
  return (
    <Section
      id="records"
      title="کارنامه‌ی هر نسخه"
      lead="هر نسخه در هر نقشی که پیش‌بینی ذخیره کرده، روی مسابقه‌های خودش؛ هر مسابقه یک بار با آخرین پیش‌بینی پیش از سوت آغاز."
    >
      <p
        className="mt-2 rounded-tile bg-surface-raised p-3 text-sm leading-7 text-fg"
        data-testid="records-warning"
      >
        <span className="text-warning" aria-hidden="true">
          ⚠
        </span>{' '}
        ردیف‌ها روی مسابقه‌های متفاوت‌اند و فاصله‌ی آخرین پیش‌بینی تا سوت آغاز هم فرق دارد؛ مستقیم
        با هم مقایسه نکنید. مقایسه‌ی درست، جفتی است:{' '}
        <a href="#compare" className="text-accent underline">
          بخش بعد
        </a>
        .
      </p>
      {report.versions.length === 0 ? (
        <p className="mt-3 text-sm text-muted">هنوز هیچ نسخه‌ای پیش‌بینی ذخیره نکرده است.</p>
      ) : (
        <>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full text-sm" data-testid="records-table">
              <caption className="sr-only">کارنامه‌ی هر نسخه در هر نقش</caption>
              <thead className="text-xs text-caption">
                <tr>
                  <th className="p-2 text-start font-normal">نسخه</th>
                  <th className="p-2 text-start font-normal">دوره‌ی مسابقه‌ها</th>
                  <th className="p-2 text-start font-normal">مسابقه</th>
                  <th className="p-2 text-start font-normal">
                    درصد درست — حدس {percent(ref.uniform_accuracy)}
                  </th>
                  <th className="p-2 text-start font-normal">
                    log loss — حدس {score(ref.uniform_log_loss)}
                  </th>
                  <th className="p-2 text-start font-normal">
                    Brier — حدس {score(ref.uniform_brier)}
                  </th>
                  <th className="p-2 text-start font-normal">RPS — حدس هر نمونه</th>
                </tr>
              </thead>
              <tbody>
                {report.versions.map((v) => (
                  <tr
                    key={`${v.role}-${v.model_version}`}
                    className="border-t border-default align-top"
                    data-testid="version-row"
                  >
                    <td className="p-2">
                      <VersionCell v={v} />
                    </td>
                    <td className="p-2 text-muted">
                      {v.record.matches === 0
                        ? '—'
                        : `${when(v.record.first_kickoff_at, false)} تا ${when(v.record.last_kickoff_at, false)}`}
                    </td>
                    <td className="p-2 tabular-nums">
                      {v.record.matches === 0 ? (
                        <span className="text-caption">هنوز مسابقه‌ای ارزیابی نشده</span>
                      ) : (
                        fa(v.record.matches)
                      )}
                      {v.record.coverage === 'limited' && v.record.matches > 0 && (
                        <span className="block">
                          <Badge>رکورد اولیه</Badge>
                        </span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums">
                      {figureCell(
                        v.record.accuracy,
                        ref.uniform_accuracy,
                        (x) => percent(x),
                        'higher',
                      )}
                    </td>
                    <td className="p-2 tabular-nums">
                      {figureCell(
                        v.record.log_loss,
                        ref.uniform_log_loss,
                        (x) => score(x),
                        'lower',
                      )}
                    </td>
                    <td className="p-2 tabular-nums">
                      {figureCell(v.record.brier, ref.uniform_brier, (x) => score(x), 'lower')}
                    </td>
                    <td className="p-2 tabular-nums">
                      {figureCell(v.record.rps, v.record.uniform_rps, (x) => score(x), 'lower')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 flex flex-col gap-3 md:hidden" data-testid="records-cards">
            {report.versions.map((v) => (
              <li
                key={`${v.role}-${v.model_version}`}
                className="rounded-tile border border-default p-3 text-sm"
              >
                <VersionCell v={v} />
                <p className="mt-1 text-xs text-muted">
                  {v.record.matches === 0
                    ? 'هنوز مسابقه‌ای ارزیابی نشده'
                    : `${fa(v.record.matches)} مسابقه، ${when(v.record.first_kickoff_at, false)} تا ${when(v.record.last_kickoff_at, false)}`}
                </p>
                {v.record.matches > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2 tabular-nums">
                    <div>
                      <span className="text-xs text-muted">درصد درست</span>
                      {figureCell(
                        v.record.accuracy,
                        ref.uniform_accuracy,
                        (x) => percent(x),
                        'higher',
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted">log loss</span>
                      {figureCell(
                        v.record.log_loss,
                        ref.uniform_log_loss,
                        (x) => score(x),
                        'lower',
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted">Brier</span>
                      {figureCell(v.record.brier, ref.uniform_brier, (x) => score(x), 'lower')}
                    </div>
                    <div>
                      <span className="text-xs text-muted">RPS</span>
                      {figureCell(v.record.rps, v.record.uniform_rps, (x) => score(x), 'lower')}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Sub
            title="به تفکیک رقابت"
            lead="برای هر نسخه؛ نسخه‌ای که در shadow است فقط با شمارش آمده است."
            testid="competitions"
          >
            <div className="flex flex-col gap-2">
              {report.versions.map((v) => (
                <details
                  key={`${v.role}-${v.model_version}`}
                  open={v.state === 'published_now'}
                  data-testid="version-competitions"
                >
                  <summary className="min-h-touch cursor-pointer text-sm text-fg">
                    <span dir="ltr" className="font-bold">
                      {v.model_version}
                    </span>{' '}
                    <span className="text-muted">
                      · {roleWords(v)} · {fa(v.competitions.length)} رقابت
                    </span>
                  </summary>
                  <div className="mt-2">
                    <Competitions version={v} report={report} />
                  </div>
                </details>
              ))}
            </div>
          </Sub>
        </>
      )}
    </Section>
  );
}

function VersionCell({ v }: { v: ConsoleModelVersion }) {
  const counts = v.counts;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="font-bold text-fg" dir="ltr">
          {v.model_version}
        </span>
        <Badge
          tone={
            v.state === 'published_now' ? 'border-model text-model' : 'border-default text-muted'
          }
        >
          {roleWords(v)}
        </Badge>
      </span>
      <span className="text-xs text-caption">
        {fa(counts.evaluated)} پیش‌بینی سنجیده‌شده روی {fa(v.record.matches)} مسابقه
        {counts.awaiting > 0 && `؛ ${fa(counts.awaiting)} در انتظار نتیجه`}
        {counts.after_kickoff > 0 && `؛ ${fa(counts.after_kickoff)} پس از شروع (شمرده نمی‌شود)`}
        {counts.unavailable > 0 && `؛ ${fa(counts.unavailable)} ناتوان از پیش‌بینی`}
      </span>
      {v.record.matches > 0 && (
        <span className="text-xs text-caption">
          {v.record.limited !== null && `داده‌ی محدود در ${fa(v.record.limited)} مسابقه`}
          {v.record.median_lead_hours !== null &&
            `؛ میانه‌ی فاصله تا سوت آغاز ${
              v.record.median_lead_hours >= 48
                ? `${fa(Math.round(v.record.median_lead_hours / 24))} روز`
                : v.record.median_lead_hours >= 2
                  ? `${fa(Math.round(v.record.median_lead_hours))} ساعت`
                  : `${fa(Math.round(v.record.median_lead_hours * 60))} دقیقه`
            }`}
        </span>
      )}
    </div>
  );
}

function Competitions({
  version,
  report,
}: {
  version: ConsoleModelVersion;
  report: ConsoleModelReport;
}) {
  const ref = report.reference.uniform_log_loss;
  const ranked = version.competitions.filter(
    (c) => c.record.coverage === 'available' && c.record.log_loss !== null,
  );
  const thin = version.competitions.filter((c) => !ranked.includes(c));
  if (version.competitions.length === 0)
    return <p className="text-sm text-muted">هنوز هیچ رقابتی ارزیابی نشده.</p>;
  if (ranked.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="thin">
        {version.state === 'shadow_now'
          ? 'فقط شمارش، تا حکم ثبت شود: '
          : `هیچ رقابتی ${fa(report.minimum_matches)} مسابقه ندارد: `}
        {thin.map((c, i) => (
          <span key={c.competition.id}>
            {i > 0 && '، '}
            <span dir="ltr">{c.competition.name}</span> ({fa(c.record.matches)})
          </span>
        ))}
      </p>
    );
  }
  const scale = intervalScale(
    ranked.flatMap((c) => (c.record.log_loss === null ? [] : [c.record.log_loss])),
    ref,
  );
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">کارنامه در هر رقابت</caption>
          <thead className="text-xs text-caption">
            <tr>
              <th className="p-2 text-start font-normal">رقابت</th>
              <th className="p-2 text-start font-normal">مسابقه</th>
              <th className="p-2 text-start font-normal">log loss و بازه</th>
              <th className="w-[30%] min-w-[13rem] p-2 font-normal">
                <IntervalAxis scale={scale} reference={ref} />
              </th>
              <th className="p-2 text-start font-normal">درصد درست</th>
              <th className="p-2 text-start font-normal">RPS</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((c, i) => {
              const ll = c.record.log_loss as ConsoleModelEstimate;
              return (
                <tr key={c.competition.id} className="border-t border-default">
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-fg" dir="ltr">
                        {c.competition.name}
                      </span>
                      {ll.low !== null && ll.low > ref ? (
                        <Badge tone="border-danger text-danger">بدتر از حدس یک‌سوم</Badge>
                      ) : ranked.length >= 6 && i < 3 ? (
                        <Badge tone="border-model text-model">بهترین</Badge>
                      ) : ranked.length >= 6 && i >= ranked.length - 3 ? (
                        <Badge tone="border-warning text-warning">ضعیف‌ترین</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-2 tabular-nums">{fa(c.record.matches)}</td>
                  <td className="p-2 tabular-nums">
                    {score(ll.mean)} <span className="text-xs text-caption">{interval(ll)}</span>
                  </td>
                  <td className="p-2">
                    <IntervalStrip
                      estimate={ll}
                      scale={scale}
                      reference={ref}
                      label={`log loss ${score(ll.mean)} ${interval(ll)}`}
                    />
                  </td>
                  <td className="p-2 tabular-nums">
                    {c.record.accuracy === null ? '—' : percent(c.record.accuracy.mean)}
                  </td>
                  <td className="p-2 tabular-nums">
                    {c.record.rps === null ? '—' : score(c.record.rps.mean)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {thin.length > 0 && (
        <p className="mt-2 text-xs leading-6 text-caption" data-testid="thin">
          با کمتر از {fa(report.minimum_matches)} مسابقه، فقط شمارش:{' '}
          {thin.map((c, i) => (
            <span key={c.competition.id}>
              {i > 0 && '، '}
              <span dir="ltr">{c.competition.name}</span> ({fa(c.record.matches)})
            </span>
          ))}
        </p>
      )}
    </>
  );
}

// --- 4. The comparison --------------------------------------------------------------

const RULES: { id: string; title: string; text: string }[] = [
  {
    id: 'D-082',
    title: 'نامزد در shadow',
    text: 'نسخه‌ی نامزد کنار نسخه‌ی منتشرشده پیش‌بینی می‌کند و ذخیره می‌شود، ولی روی سایت نمی‌آید. فقط با کارنامه‌ی خودش و با تصمیم نگهدارنده ارتقا می‌یابد، پس از دست‌کم ۳۰۰ پیش‌بینی پیش از شروع.',
  },
  {
    id: 'D-139',
    title: 'یک عامل یا ثابت تازه',
    text: 'روی همان مسابقه‌ها باید از نامزد فعلی بهتر باشد با بازه‌ی ۹۵٪ جفتی که تماماً زیر صفر است؛ calibration بدتر نشود؛ در بیش از یک‌سوم لیگ‌ها بدتر نباشد؛ دست‌کم ۳۰۰ مسابقه در هر گروه.',
  },
  {
    id: 'D-336',
    title: 'نسخه‌ای که فقط لیگ اضافه می‌کند',
    text: `«بدتر نیست»: بالای بازه‌ی اختلاف جفتی روی ۳۰۰ مسابقه‌ی مشترک از +${score(CONSOLE_MODEL_NO_WORSE_MARGIN)} بالاتر نرود. «بهتر از حدس در لیگ‌های تازه»: روی ۱۰۰ مسابقه‌ی آن لیگ‌ها log loss با همه‌ی بازه‌اش زیر ${score(Math.log(3))} باشد. هر شرط فقط یک بار داوری می‌شود، در اولین پایش هفتگی که شمارش کامل است.`,
  },
];

function CompareSection({
  report,
  lab,
  weekly,
}: {
  report: ConsoleModelReport;
  lab: ConsoleModelLab | null;
  weekly: ConsoleReport | undefined;
}) {
  const stored = report.versions;
  const compared = new Set(
    report.comparisons.map((c) => `${c.subject.model_version}|${c.reference.model_version}`),
  );
  const unshared: string[] = [];
  for (let i = 0; i < stored.length; i += 1)
    for (let j = i + 1; j < stored.length; j += 1) {
      const a = stored[i] as ConsoleModelVersion;
      const b = stored[j] as ConsoleModelVersion;
      if (a.model_version === b.model_version) continue;
      if (
        !compared.has(`${a.model_version}|${b.model_version}`) &&
        !compared.has(`${b.model_version}|${a.model_version}`)
      )
        unshared.push(`${versionNumber(a.model_version)} و ${versionNumber(b.model_version)}`);
    }
  return (
    <Section
      id="compare"
      title="مقایسه‌ی نسخه‌ها"
      lead="دو نسخه فقط روی مسابقه‌هایی که هر دو پیش از شروع پیش‌بینی کرده‌اند با هم سنجیده می‌شوند."
    >
      <div className="mt-3">
        <MethodSchematic />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3" data-testid="rules">
        {RULES.map((rule) => (
          <div key={rule.id} className="rounded-tile bg-surface-raised p-3 text-sm leading-7">
            <span className="font-bold text-fg">{rule.title}</span>{' '}
            <span className="whitespace-nowrap text-xs text-caption">{rule.id}</span>
            <p className="text-muted">{rule.text}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm leading-7 text-muted">
        زیر {fa(report.minimum_matches)} مسابقه‌ی مشترک، رکورد اولیه است و فقط شمارش می‌آید. برای
        نسخه‌ای که در shadow است، هر شماری هم که رسیده باشد، عدد اینجا نمی‌آید: آن یک نگاه، نگاه
        پایش هفتگی است و حکمش در دفتر ثبت می‌شود.
      </p>
      <div className="mt-4 flex flex-col gap-4" data-testid="comparisons">
        {report.comparisons.length === 0 && (
          <p className="text-sm text-muted">هنوز دو نسخه‌ای مسابقه‌ی مشترک ندارند.</p>
        )}
        {report.comparisons.map((c) => (
          <PairCard
            key={`${c.subject.model_version}-${c.subject.role}-${c.reference.model_version}-${c.reference.role}`}
            pair={c}
            report={report}
            lab={lab}
          />
        ))}
        {unshared.length > 0 && (
          <p className="text-xs text-caption" data-testid="unshared">
            بدون مسابقه‌ی مشترک: {unshared.join('؛ ')}.
          </p>
        )}
      </div>
      {weekly !== undefined && (
        <p className="mt-3 text-sm text-muted">
          حکم‌ها و روش در{' '}
          <Link
            href={`/reports?path=${encodeURIComponent(weekly.path)}`}
            className="text-accent underline"
          >
            گزارش هفتگی دانشمند مدل ({when(weekly.date, false)})
          </Link>
          .
        </p>
      )}
    </Section>
  );
}

function PairCard({
  pair,
  report,
  lab,
}: {
  pair: ConsoleModelComparison;
  report: ConsoleModelReport;
  lab: ConsoleModelLab | null;
}) {
  const subject = versionNumber(pair.subject.model_version);
  const reference = versionNumber(pair.reference.model_version);
  const note = MODEL_VERSIONS[subject as VersionNumber];
  const judging = pair.kind === 'judging';
  const figures = pair.figures;
  const identicalShare = pair.matches === 0 ? 0 : pair.identical / pair.matches;
  const stripWords = {
    betterWords: `${subject} بهتر`,
    worseWords: `${subject} بدتر`,
  };
  return (
    <div
      className="rounded-tile border border-default p-4"
      data-testid="pair"
      data-kind={pair.kind}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-bold text-fg" dir="ltr">
          {pair.subject.model_version}
        </span>
        <span className="text-xs text-muted">
          {roleWords({ role: pair.subject.role, state: judging ? 'shadow_now' : undefined })}
        </span>
        <span className="text-sm text-muted">در برابر</span>
        <span className="text-sm font-bold text-fg" dir="ltr">
          {pair.reference.model_version}
        </span>
        <span className="text-xs text-muted">{roleWords({ role: pair.reference.role })}</span>
        <Badge tone={judging ? 'border-warning text-warning' : 'border-default text-muted'}>
          {judging ? 'در حال داوری' : 'سابقه'}
        </Badge>
        {judging && note?.rule !== undefined && <Badge>قاعده‌ی {note.rule}</Badge>}
      </div>
      <p className="mt-2 text-sm text-fg" data-testid="pair-counts">
        {fa(pair.matches)} مسابقه‌ی مشترک · {fa(pair.identical)} پیش‌بینی یکسان (
        {percent(identicalShare)})
        {pair.matches > 0 && pair.matches < report.minimum_matches && (
          <>
            {' '}
            <Badge>رکورد اولیه</Badge>
          </>
        )}
      </p>
      {judging ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="mx-auto w-full max-w-[32.5rem]">
            {/* Two widths, so the words stay full size on a phone. */}
            <div className="hidden sm:block">
              <WithheldStrip width={520} words="اختلاف این جفت عمداً نشان داده نمی‌شود" />
            </div>
            <div className="sm:hidden">
              <WithheldStrip width={260} words="عمداً نشان داده نمی‌شود" />
            </div>
          </div>
          <JudgementSlot lab={lab} modelVersion={pair.subject.model_version} />
        </div>
      ) : figures === null ? (
        <p className="mt-2 text-sm text-muted">
          کمتر از {fa(pair.minimum)} مسابقه‌ی مشترک؛ فقط شمارش.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_32.5rem]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="pair-figures">
              <caption className="sr-only">هر طرف روی مسابقه‌های مشترک</caption>
              <thead className="text-xs text-caption">
                <tr>
                  <th className="p-2 text-start font-normal" />
                  <th className="p-2 text-start font-normal">درصد درست</th>
                  <th className="p-2 text-start font-normal">log loss</th>
                  <th className="p-2 text-start font-normal">Brier</th>
                  <th className="p-2 text-start font-normal">RPS</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [subject, figures.subject],
                  [reference, figures.reference],
                ].map(([name, side]) => (
                  <tr key={name as string} className="border-t border-default">
                    <td className="p-2" dir="ltr">
                      {name as string}
                    </td>
                    <td className="p-2 tabular-nums">
                      {percent((side as typeof figures.subject).accuracy)}
                    </td>
                    <td className="p-2 tabular-nums">
                      {score((side as typeof figures.subject).log_loss, 4)}
                    </td>
                    <td className="p-2 tabular-nums">
                      {score((side as typeof figures.subject).brier, 4)}
                    </td>
                    <td className="p-2 tabular-nums">
                      {score((side as typeof figures.subject).rps, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            {[520, 260].map((w) => (
              <div key={w} className={w === 520 ? 'hidden sm:block' : 'sm:hidden'}>
                <DifferenceStrip
                  estimate={figures.difference}
                  half={PAIR_HALF}
                  width={w}
                  {...stripWords}
                  label={`اختلاف log loss ${subject} منهای ${reference}: ${signed(figures.difference.mean)} ${interval(figures.difference, (v) => signed(v))}`}
                />
              </div>
            ))}
            <p className="mt-1 text-sm text-muted" data-testid="pair-difference">
              اختلاف log loss ({subject} منهای {reference}؛ منفی یعنی {subject} بهتر):{' '}
              <span dir="ltr">
                {signed(figures.difference.mean)} {interval(figures.difference, (v) => signed(v))}
              </span>
              {figures.difference.low !== null &&
                figures.difference.high !== null &&
                figures.difference.low < 0 &&
                figures.difference.high > 0 && (
                  <> · بازه صفر را در بر می‌گیرد: این داده بهتر یا بدتر بودن را نشان نمی‌دهد.</>
                )}
            </p>
          </div>
        </div>
      )}
      {pair.competitions.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">
            به تفکیک رقابت ({fa(pair.competitions.length)})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">مسابقه‌های مشترک در هر رقابت</caption>
              <thead className="text-xs text-caption">
                <tr>
                  <th className="p-2 text-start font-normal">رقابت</th>
                  <th className="p-2 text-start font-normal">مشترک</th>
                  <th className="p-2 text-start font-normal">یکسان</th>
                  {!judging && <th className="p-2 text-start font-normal">اختلاف log loss</th>}
                </tr>
              </thead>
              <tbody>
                {pair.competitions.map((c) => (
                  <tr key={c.competition.id} className="border-t border-default">
                    <td className="p-2" dir="ltr">
                      {c.competition.name}
                    </td>
                    <td className="p-2 tabular-nums">{fa(c.matches)}</td>
                    <td className="p-2 tabular-nums">{fa(c.identical)}</td>
                    {!judging && (
                      <td className="p-2 tabular-nums">
                        {c.figures === null ? (
                          <span className="text-caption">
                            کمتر از {fa(report.minimum_matches)} مسابقه
                          </span>
                        ) : (
                          <>
                            <span dir="ltr">{signed(c.figures.difference.mean)}</span>{' '}
                            <span className="text-xs text-caption">
                              {interval(c.figures.difference, (v) => signed(v))}
                            </span>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// --- 5. Calibration and the weekly trend ------------------------------------------------

/** The model watch's rule: 100 forecasts or more, and seen more than 8 points from said or its interval excluding it. */
const flagged = (b: ConsoleModelCalibrationBand) =>
  b.forecasts >= 100 &&
  (Math.abs(b.seen.mean - b.said) > 0.08 ||
    (b.seen.low !== null && b.seen.high !== null && (b.said < b.seen.low || b.said > b.seen.high)));

function CalibrationSection({ report }: { report: ConsoleModelReport }) {
  const withBands = report.versions.filter((v) =>
    v.calibration.some((b) => b.forecasts >= CONSOLE_MODEL_CALIBRATION_MINIMUM),
  );
  const max = Math.max(0.6, ...withBands.map((v) => calibrationMax(v.calibration)));
  const withTrend = report.versions.filter(
    (v) => v.trend.filter((p) => p.log_loss !== null).length >= 2,
  );
  const domain = trendDomain(
    withTrend.map((v) => v.trend),
    report.reference.uniform_log_loss,
  );
  const weeks = [...new Set(withTrend.flatMap((v) => v.trend.map((p) => p.period_start)))].sort();
  return (
    <Section
      id="calibration"
      title="calibration و روند هفتگی"
      lead="برای هر نسخه جدا، همه روی یک مقیاس تا با هم خوانده شوند."
    >
      <Sub
        title="آنچه گفت در برابر آنچه شد"
        lead={
          <>
            اگر مدل به نتیجه‌ای ۴۰٪ بدهد، آن نتیجه باید در حدود ۴۰٪ این مسابقه‌ها رخ دهد. هر نقطه یک
            باند ده‌درصدی است با خط بازه‌ی ۹۵٪اش؛ روی خط مورب یعنی درست؛ نقطه‌ی توخالی یعنی کمتر از{' '}
            {fa(report.minimum_matches)} مسابقه. باندی که کمتر از{' '}
            {fa(CONSOLE_MODEL_CALIBRATION_MINIMUM)} پیش‌بینی دارد کشیده نمی‌شود.
          </>
        }
        testid="calibration"
      >
        {withBands.length === 0 ? (
          <p className="text-sm text-muted">هنوز هیچ باندی پیش‌بینی کافی ندارد.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {withBands.map((v) => {
              const off = v.calibration
                .filter((b) => b.forecasts >= CONSOLE_MODEL_CALIBRATION_MINIMUM)
                .filter(flagged);
              return (
                <details
                  key={`${v.role}-${v.model_version}`}
                  open={v.state === 'published_now'}
                  data-testid="version-calibration"
                >
                  <summary className="min-h-touch cursor-pointer text-sm text-fg">
                    <span dir="ltr" className="font-bold">
                      {v.model_version}
                    </span>{' '}
                    <span className="text-muted">
                      · {roleWords(v)} · {fa(v.record.matches)} مسابقه ·{' '}
                      {off.length === 0
                        ? 'هیچ باندی از قاعده رد نمی‌شود'
                        : `${fa(off.length)} باند از قاعده رد می‌شود`}
                    </span>
                  </summary>
                  <div className="mt-3">
                    <CalibrationPanels
                      bands={v.calibration}
                      id={`${v.role}-${versionNumber(v.model_version).replace(/\./g, '-')}`}
                      max={max}
                      minimum={report.minimum_matches}
                    />
                    {off.length > 0 && (
                      <div
                        className="mt-3 rounded-tile bg-surface-raised p-3 text-sm"
                        data-testid="calibration-off"
                      >
                        <p className="font-bold text-fg">
                          باندهایی که از قاعده‌ی پایش هفتگی رد می‌شوند (۱۰۰ مسابقه یا بیشتر، و
                          فاصله‌ی بیش از ۸ واحد درصد یا بازه‌ای که عدد مدل را در بر نمی‌گیرد):
                        </p>
                        <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                          {off.map((b) => (
                            <li key={`${b.outcome}${b.band}`}>
                              {OUTCOME_WORDS[b.outcome]} در باند {percent(b.band / 10, 0)} تا{' '}
                              {percent((b.band + 1) / 10, 0)}: مدل {percent(b.said)} گفت،{' '}
                              {percent(b.seen.mean)} رخ داد {interval(b.seen, (x) => percent(x))} ·{' '}
                              {fa(b.forecasts)} مسابقه
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-muted">
                        جدول همه‌ی باندها
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[30rem] whitespace-nowrap text-sm">
                          <caption className="sr-only">calibration هر باند</caption>
                          <thead className="text-xs text-caption">
                            <tr>
                              <th className="p-2 text-start font-normal">نتیجه</th>
                              <th className="p-2 text-start font-normal">باند</th>
                              <th className="p-2 text-start font-normal">مسابقه</th>
                              <th className="p-2 text-start font-normal">مدل گفت</th>
                              <th className="p-2 text-start font-normal">رخ داد</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v.calibration.map((b) => (
                              <tr key={`${b.outcome}${b.band}`} className="border-t border-default">
                                <td className="p-2">{OUTCOME_WORDS[b.outcome]}</td>
                                <td className="p-2">
                                  {percent(b.band / 10, 0)} تا {percent((b.band + 1) / 10, 0)}
                                </td>
                                <td className="p-2 tabular-nums">{fa(b.forecasts)}</td>
                                <td className="p-2 tabular-nums">{percent(b.said)}</td>
                                <td className="p-2 tabular-nums">
                                  {percent(b.seen.mean)}{' '}
                                  <span className="text-xs text-caption">
                                    {interval(b.seen, (x) => percent(x))}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Sub>
      <Sub
        title="هفته به هفته"
        lead={
          <>
            log loss هر هفته (هفته از دوشنبه، به تاریخ مسابقه) در برابر حدس یک‌سوم؛ یک تابلو برای هر
            نسخه روی یک محور زمان و یک محور عدد، پس اختلاف ارتفاع دو تابلو اختلاف واقعی است. نقطه‌ی
            توخالی یعنی کمتر از {fa(report.minimum_matches)} مسابقه.
          </>
        }
        testid="trend-section"
      >
        {domain === null || withTrend.length === 0 ? (
          <p className="text-sm text-muted">برای نمودار دست‌کم دو هفته‌ی ارزیابی‌شده لازم است.</p>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {withTrend.map((v) => (
                <figure key={`${v.role}-${v.model_version}`} data-testid="version-trend">
                  <figcaption className="text-sm text-fg">
                    <span dir="ltr" className="font-bold">
                      {v.model_version}
                    </span>{' '}
                    <span className="text-muted">
                      · {roleWords(v)} · {fa(v.record.matches)} مسابقه
                    </span>
                  </figcaption>
                  {/* Two widths, so the axis text stays full size on a phone. */}
                  {[480, 290].map((w) => (
                    <TrendPanel
                      key={w}
                      points={v.trend}
                      domain={domain}
                      reference={report.reference.uniform_log_loss}
                      minimum={report.minimum_matches}
                      width={w}
                      className={w === 480 ? 'hidden w-full sm:block' : 'w-full sm:hidden'}
                      label={`log loss هفتگی ${v.model_version}`}
                    />
                  ))}
                </figure>
              ))}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-muted">جدول هفته‌ها</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[30rem] whitespace-nowrap text-sm">
                  <caption className="sr-only">log loss هر هفته، هر نسخه</caption>
                  <thead className="text-xs text-caption">
                    <tr>
                      <th className="p-2 text-start font-normal">هفته‌ی</th>
                      {withTrend.map((v) => (
                        <th
                          key={`${v.role}-${v.model_version}`}
                          className="p-2 text-start font-normal"
                          dir="ltr"
                        >
                          {v.model_version}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((week) => (
                      <tr key={week} className="border-t border-default">
                        <td className="p-2">{when(week, false)}</td>
                        {withTrend.map((v) => {
                          const p: AccuracyPoint | undefined = v.trend.find(
                            (x) => x.period_start === week,
                          );
                          return (
                            <td
                              key={`${v.role}-${v.model_version}`}
                              className="p-2 tabular-nums"
                              dir="ltr"
                            >
                              {p === undefined || p.log_loss === null
                                ? '—'
                                : `${score(p.log_loss)} · ${fa(p.matches)}`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Sub>
    </Section>
  );
}

// --- 6. The ledger --------------------------------------------------------------------

function LedgerSection({ lab }: { lab: ConsoleModelLab | null }) {
  return (
    <Section
      id="ledger"
      title="دفتر آزمایش‌ها"
      lead="هر چیزی که روی مدل آزموده شد: چرا، روی چه داده‌ای، چه اندازه گرفته شد و چرا پذیرفته یا کنار گذاشته شد، با تصمیمی که آن را ثبت کرده. این صفحه از دفتر چیزی حساب نمی‌کند و حکمی نمی‌دهد."
    >
      {lab === null || lab.entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted" data-testid="ledger-missing">
          دفتر آزمایش‌ها هنوز از رایانه به کنسول نرسیده است؛ حکم‌ها در تصمیم‌ها (D-121، D-329،
          D-334، D-335) ثبت‌اند.
        </p>
      ) : (
        <>
          <div className="mt-2">
            <LedgerState lab={lab} />
          </div>
          <div className="mt-4">
            <Forest entries={lab.entries} />
          </div>
          <LedgerCards entries={lab.entries} />
        </>
      )}
    </Section>
  );
}

// --- 7. What is not known ----------------------------------------------------------------

function UnknownSection({ report }: { report: ConsoleModelReport }) {
  const site = report.versions.find((v) => v.state === 'published_now');
  const judging = report.comparisons.find((c) => c.kind === 'judging');
  const leads = report.versions
    .filter((v) => v.record.median_lead_hours !== null)
    .map(
      (v) =>
        `${versionNumber(v.model_version)}: ${(v.record.median_lead_hours as number) >= 48 ? `${fa(Math.round((v.record.median_lead_hours as number) / 24))} روز` : `${fa(Math.round((v.record.median_lead_hours as number) * 60))} دقیقه`}`,
    );
  const results = report.inputs.find((i) => i.key === 'results');
  const items: { head: string; text: string }[] = [
    {
      head: 'بازه‌ها مسابقه‌های هم‌هفته را مستقل فرض می‌کنند.',
      text: 'مسابقه‌های یک هفته به هم شبیه‌اند؛ بازه‌ی نرمال و Wilson این را نمی‌بیند و کمی باریک‌تر از واقع است. پایش هفتگی برای حکم ارتقا بوت‌استرپ جفتی را به‌کار می‌برد، نه این بازه‌ها را.',
    },
    {
      head: 'نسخه‌ها روی مسابقه‌های متفاوت و با فاصله‌ی متفاوت تا بازی سنجیده شده‌اند.',
      text: `میانه‌ی فاصله‌ی آخرین پیش‌بینی تا سوت آغاز: ${leads.join('؛ ')}. کارنامه‌ی دو نسخه با فاصله‌ی متفاوت هم‌جنس نیست؛ فقط مقایسه‌ی جفتی روی همان مسابقه‌ها معتبر است.`,
    },
    {
      head: 'بخشی از کارنامه با داده‌ی «محدود» است.',
      text:
        site === undefined || site.record.limited === null
          ? 'شمار مسابقه‌های با داده‌ی محدود این بار خوانده نشد.'
          : `در ${fa(site.record.limited)} مسابقه از ${fa(site.record.matches)} نسخه‌ی منتشرشده، مدل داده‌اش را محدود گفته (Elo به‌کار نرفته یا یکی از تیم‌ها کمتر از ۱۵ مسابقه داشته)؛ این‌ها با بقیه یک‌جا شمرده شده‌اند.`,
    },
    {
      head: 'آنچه در کارنامه نیست.',
      text:
        report.published?.unscored == null
          ? 'شمار مسابقه‌های بدون پیش‌بینی این بار خوانده نشد.'
          : `${fa(report.published.unscored.without)} مسابقه از ${fa(report.published.unscored.finished)} مسابقه‌ی تمام‌شده‌ی رقابت‌های نسخه‌ی منتشرشده، پیش‌بینی پیش از شروعی ندارد (مدل نتوانست، یا دیر شد). پیش‌بینی پس از شروع ذخیره می‌شود و هرگز شمرده نمی‌شود.`,
    },
    {
      head: 'نسخه‌ی در shadow فقط لیگ اضافه نکرده است.',
      text:
        judging === undefined
          ? 'الان نسخه‌ای در shadow نیست.'
          : `از ${fa(judging.matches)} مسابقه‌ی مشترک ${versionNumber(judging.subject.model_version)} با ${versionNumber(judging.reference.model_version)}، ${fa(judging.matches - judging.identical)} مسابقه پیش‌بینی متفاوت دارد؛ به تفکیک رقابت در کارت مقایسه دیده می‌شود. برازش میان‌لیگی هر نسخه لیگ‌های خودش را می‌خواند، پس پیش‌بینی جام‌ها فرق می‌کند. اینکه قاعده‌ی D-336 یا D-139 به آن می‌خورد، تصمیم نگهدارنده است (یافته‌ی mod-2026-11-06-01).`,
    },
    {
      head: 'نتیجه‌های برخی لیگ‌ها دیر به انبار می‌رسد.',
      text:
        results === undefined
          ? 'شمار این بار خوانده نشد.'
          : (results.late_groups ?? 0) > 0
            ? `در ${fa(results.late_groups ?? 0)} لیگ از ${fa(results.groups ?? 0)} لیگِ در فصل، نتیجه‌ای از ده روز اخیر در انبار نیست؛ برازش آن لیگ‌ها هفته‌ی گذشته را نمی‌بیند.`
            : 'الان هیچ لیگِ در فصلی نتیجه‌ی ده روز اخیر را کم ندارد.',
    },
    {
      head: 'نشانه‌ی زنده‌ی calibration هنوز تصمیمی ندارد.',
      text: 'باند مساوی ۲۰ تا ۳۰٪ و برد میهمان ۴۰ تا ۵۰٪ روی سابقه‌ی زنده از قاعده رد می‌شوند، در حالی که بازکالیبره‌ی تساوی روی داده‌ی توسعه (T-1657) بی‌اثر بود. D-334 این را برای تصمیمی جداگانه کنار گذاشته است.',
    },
    {
      head: 'ورودی‌ها همان‌طور که انبار الان دارد شمرده شده‌اند، نه همان‌طور که هر نسخه دیده بود.',
      text: 'شمار و تازگی بالا وضعیت امروز است. اینکه پیشین Elo در بخشی از برازش‌ها به‌کار نرفته (داده‌ی «محدود») توضیح داده نشده است.',
    },
    {
      head: 'پایش هفتگی تا ۲۰۲۶-۱۱-۰۲ پیش‌بینی‌ها را می‌شمرد، نه مسابقه‌ها را.',
      text: 'عددهای آن گزارش‌ها (مثلاً ۱٬۸۳۱) شمار پیش‌بینی است؛ این صفحه هر مسابقه را یک بار می‌شمرد. یافته‌ی mod-2026-11-06-02 اصلاح پرس‌وجوی پایش را می‌خواهد.',
    },
  ];
  return (
    <Section
      id="unknown"
      title="آنچه نمی‌دانیم یا نمی‌سنجیم"
      lead="به زبان ساده، تا عددهای بالا بیش از آنچه هستند خوانده نشوند."
    >
      <ol className="mt-3 flex flex-col gap-2 text-sm leading-7" data-testid="unknown-list">
        {items.map((item) => (
          <li key={item.head}>
            <span className="font-bold text-fg">{item.head}</span>{' '}
            <span className="text-muted">{item.text}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// --- 8. Glossary ---------------------------------------------------------------------

function Glossary() {
  const rows: [string, string][] = [
    [
      'درصد درست',
      'سهم مسابقه‌هایی که محتمل‌ترین نتیجه‌ی مدل همان شد. حدس یک‌سوم به‌طور میانگین ۳۳٪ می‌گیرد.',
    ],
    [
      'log loss',
      'منفیِ لگاریتم احتمالی که مدل به نتیجه‌ی واقعی داده بود، میانگین روی مسابقه‌ها. هر چه کمتر بهتر؛ اطمینان زیاد به نتیجه‌ی غلط را سخت جریمه می‌کند.',
    ],
    [
      'Brier',
      'مجموع مربع فاصله‌ی سه احتمال از آنچه رخ داد (یک برای نتیجه‌ی واقعی، صفر برای دو تای دیگر)؛ از صفر تا دو، هر چه کمتر بهتر.',
    ],
    [
      'RPS',
      'مانند Brier، ولی ترتیب نتیجه‌ها را می‌بیند: برد میزبان به مساوی نزدیک‌تر است تا به برد میهمان. حدسش روی هر نمونه فرق دارد، چون به شمار مساوی‌ها بستگی دارد.',
    ],
    [
      'حدس یک‌سوم',
      'پیش‌بینی‌ای که به هر سه نتیجه ۳۳٪ می‌دهد: کمترین چیزی که مدل باید از آن بهتر باشد.',
    ],
    [
      'بازه‌ی ۹۵٪',
      'با این تعداد مسابقه، عدد واقعی به احتمال زیاد در این فاصله است؛ هر چه مسابقه بیشتر، بازه باریک‌تر.',
    ],
    [
      'calibration',
      'اینکه احتمال‌ها راست می‌گویند یا نه: از مسابقه‌هایی که مدل به یک نتیجه ۴۰٪ داده، باید حدود ۴۰٪ همان نتیجه را داده باشند.',
    ],
    ['shadow', 'نسخه‌ای که پیش‌بینی می‌کند و ثبت و سنجیده می‌شود، ولی روی سایت نمی‌آید.'],
    [
      'مسابقه‌ی مشترک',
      'مسابقه‌ای که هر دو نسخه پیش از شروع پیش‌بینی کرده‌اند؛ تنها جایی که دو نسخه با هم سنجیده می‌شوند.',
    ],
    ['اختلاف جفتی', 'برای هر مسابقه‌ی مشترک، log loss یک نسخه منهای دیگری؛ میانگین و بازه‌ی آن.'],
    [
      'پنجره‌ی توسعه و فصل کنارگذاشته',
      'عامل‌ها روی فصل ۲۰۲۴/۲۵ ساخته و سنجیده می‌شوند؛ فصل بعد کنار گذاشته می‌شود و فقط یک بار برای نامزد نهایی خرج می‌شود (D-303).',
    ],
    [
      'وضعیت داده',
      '«کامل» یا «محدود»: خود مدل می‌گوید پیشینه‌ی Elo و ۱۵ مسابقه برای هر تیم داشته یا نه.',
    ],
  ];
  return (
    <Section id="words" title="واژه‌ها">
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm md:grid-cols-[10rem_minmax(0,1fr)]">
        {rows.map(([term, meaning]) => (
          <div key={term} className="contents">
            <dt className="font-bold text-fg">{term}</dt>
            <dd className="leading-7 text-muted">{meaning}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
