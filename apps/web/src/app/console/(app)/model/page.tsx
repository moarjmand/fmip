import { ConsoleLink as Link } from '@/app/console/console-link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  CONSOLE_MODEL_CALIBRATION_MINIMUM,
  CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM,
  CONSOLE_MODEL_NO_WORSE_MARGIN,
  CONSOLE_MODEL_PAIRED_MINIMUM,
  type ConsoleModelCalibrationBand,
  type ConsoleModelCandidate,
  type ConsoleModelCompetition,
  type ConsoleModelReport,
  type ConsoleReport,
} from '@fmip/contracts';
import { consoleModel, consoleSnapshot } from '@/lib/console-api';
import {
  CalibrationPanels,
  CountMeter,
  IntervalAxis,
  IntervalStrip,
  OUTCOME_WORDS,
  TrendChart,
  interval,
  intervalScale,
  percent,
  score,
} from '../../model-charts';
import { MODEL_NOTES, REJECTED_FACTORS } from '../../model-notes';
import { Badge, Card, fa, when } from '../../ui';

export const metadata: Metadata = { title: 'مدل پیش‌بینی' };

/** Past this, no match has been scored for a while, and the page says so (rule 4). */
const STALE_HOURS = 72;

const Ltr = ({ children }: { children: ReactNode }) => (
  <span dir="ltr" className="font-mono text-[0.8125rem]">
    {children}
  </span>
);

/**
 * The forecast model, simply and exactly (T-1729, D-355): what the published
 * version is and what it reads, what is in shadow, and how accurate the
 * published version is now -- every figure from `GET /console/model`, with
 * its sample and window; the make-up of each version from `model-notes.ts`;
 * the promotion verdicts left to the model scientist's weekly report.
 */
export default async function ConsoleModelPage() {
  const [result, snapshot] = await Promise.all([consoleModel(), consoleSnapshot()]);
  const reports = snapshot.ok ? (snapshot.data.snapshot?.reports ?? []) : [];
  const weekly = reports
    .filter((r) => r.agent === 'model-scientist')
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  if (!result.ok) {
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
      <NowSection report={report} />
      <InputsSection report={report} />
      <AccuracySection report={report} weekly={weekly} />
      <Glossary />
    </>
  );
}

// --- 1. What the model is now -------------------------------------------------

function NowSection({ report }: { report: ConsoleModelReport }) {
  const published = report.published;
  const note = published === null ? undefined : MODEL_NOTES[published.model_version];
  const hours =
    report.last_updated_at === null
      ? null
      : (Date.parse(report.generated_at) - Date.parse(report.last_updated_at)) / 3_600_000;
  return (
    <Card title="مدل الان چیست">
      <p className="text-sm leading-7 text-muted">
        این صفحه فقط مدل آماری را نشان می‌دهد. تحلیل بنیان‌گذار و پیش‌بینی جامعه جدا هستند و اینجا
        شمرده نمی‌شوند.
      </p>
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
          <p className="text-sm leading-7 text-fg">
            مدل از نتیجه‌ی مسابقه‌های گذشته‌ی هر لیگ، قدرت حمله و دفاع هر تیم را تخمین می‌زند؛
            رتبه‌ی Elo خود سکو این تخمین را به سمت قدرت کلی تیم می‌کشد. از این‌ها میانگین گل هر طرف
            به دست می‌آید و جدول احتمال نتیجه‌ها به سه عدد تبدیل می‌شود: برد میزبان، مساوی، برد
            میهمان.
          </p>
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
      </div>
      {report.candidates.length > 0 && (
        <div className="mt-5 border-t border-default pt-4">
          <h3 className="text-sm font-bold text-fg">در shadow (آزمایشی، روی سایت نمی‌آید)</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {report.candidates.map((c) => {
              const cnote = MODEL_NOTES[c.model_version];
              return (
                <li key={c.model_version} className="text-sm leading-7">
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
                    {cnote?.adds ?? 'شرح این نسخه هنوز در کنسول نوشته نشده است.'}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

// --- 2. What it works on -------------------------------------------------------

function InputsSection({ report }: { report: ConsoleModelReport }) {
  const published = report.published;
  const inputs = published === null ? undefined : MODEL_NOTES[published.model_version]?.inputs;
  const shadowNotes = report.candidates.flatMap((c) => {
    const note = MODEL_NOTES[c.model_version];
    return note?.adds === undefined ? [] : [{ id: c.model_version, adds: note.adds }];
  });
  return (
    <Card title="بر اساس چه چیزهایی">
      {inputs === undefined ? (
        <p className="text-sm text-muted">
          {published === null
            ? 'نسخه‌ی منتشرشده‌ای نیست.'
            : 'شرح ورودی‌های این نسخه هنوز در کنسول نوشته نشده است.'}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            به ترتیبی که هر پیش‌بینی ساخته می‌شود. همه از داده‌ی ثبت‌شده‌ی خود سکوست: نتیجه‌ی
            مسابقه‌ها و رتبه‌ی Elo که از همان نتیجه‌ها حساب می‌شود.
          </p>
          <ol className="mt-4 flex flex-col gap-0" data-testid="inputs">
            {inputs.map((input, i) => (
              <li
                key={input.technical}
                className="relative flex gap-3 border-s-2 border-model/30 ps-4 pb-4 last:pb-0"
              >
                <span
                  className="absolute -start-[0.8rem] top-0 inline-flex size-6 items-center justify-center rounded-pill bg-model text-xs font-bold text-surface"
                  aria-hidden="true"
                >
                  {fa(i + 1)}
                </span>
                <div className="flex flex-col gap-0.5 ps-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-bold text-fg">{input.title}</span>
                    <span className="text-xs text-caption">
                      <Ltr>{input.technical}</Ltr>
                    </span>
                  </div>
                  <p className="text-sm leading-7 text-fg">{input.plain}</p>
                  {input.detail !== undefined && (
                    <p className="text-xs text-caption">{input.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="mt-5 grid gap-5 border-t border-default pt-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-muted">در نسخه‌ی آزمایشی (shadow)</h3>
          {shadowNotes.length === 0 ? (
            <p className="mt-2 text-sm text-caption">نسخه‌ی آزمایشی شرح‌داده‌شده‌ای نیست.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2 text-sm text-muted">
              {shadowNotes.map((s) => (
                <li key={s.id}>
                  <Ltr>{s.id}</Ltr>: {s.adds}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-bold text-muted">آزمایش‌شده و کنار گذاشته</h3>
          <p className="mt-1 text-xs text-caption">
            هر کدام روی مسابقه‌هایی که مدل ندیده بود سنجیده شد و از معیار D-139 رد نشد.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted" data-testid="rejected">
            {REJECTED_FACTORS.map((f) => (
              <li key={f.technical}>
                <span className="text-fg">{f.title}</span>{' '}
                <span className="text-xs text-caption">
                  <Ltr>{f.technical}</Ltr>
                </span>
                {'؛ '}
                {f.why} · <span className="whitespace-nowrap">{f.decision}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// --- 3. How accurate it is now --------------------------------------------------

function AccuracySection({
  report,
  weekly,
}: {
  report: ConsoleModelReport;
  weekly: ConsoleReport | undefined;
}) {
  const record = report.published?.record;
  const ref = report.reference;
  if (record === undefined || record.matches === 0) {
    return (
      <Card title="دقت الان">
        <p className="text-sm text-muted" data-testid="no-accuracy">
          هنوز هیچ پیش‌بینی پیش از شروعی از نسخه‌ی منتشرشده ارزیابی نشده؛ عددی برای نشان دادن نیست.
        </p>
        <Candidates report={report} weekly={weekly} />
      </Card>
    );
  }
  const window = `${when(record.first_kickoff_at, false)} تا ${when(record.last_kickoff_at, false)}`;
  return (
    <Card title="دقت الان">
      <p className="text-sm text-muted" data-testid="sample">
        فقط پیش‌بینی‌های پیش از شروع بازی، هر مسابقه یک بار با آخرین پیش‌بینی پیش از سوت آغاز: روی{' '}
        <span className="font-bold text-fg">{fa(record.matches)}</span> مسابقه، از {window}.
        {record.coverage === 'limited' &&
          ` کمتر از ${fa(report.minimum_matches)} مسابقه است؛ عددها هنوز سست‌اند.`}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="kpis">
        {record.accuracy !== null && (
          <Kpi
            label="درصد درست"
            value={percent(record.accuracy.mean)}
            range={interval(record.accuracy, (v) => percent(v))}
            baseline={`حدس یک‌سوم: ${percent(ref.uniform_accuracy)}`}
            direction="بیشتر بهتر است"
          />
        )}
        {record.log_loss !== null && (
          <Kpi
            label="log loss"
            value={score(record.log_loss.mean)}
            range={interval(record.log_loss)}
            baseline={`حدس یک‌سوم: ${score(ref.uniform_log_loss)}`}
            direction="کمتر بهتر است"
          />
        )}
        {record.brier !== null && (
          <Kpi
            label="Brier"
            value={score(record.brier.mean)}
            range={interval(record.brier)}
            baseline={`حدس یک‌سوم: ${score(ref.uniform_brier)}`}
            direction="کمتر بهتر است"
          />
        )}
      </div>

      <Calibration bands={report.calibration} />
      <Trend report={report} />
      <Competitions report={report} />
      <Candidates report={report} weekly={weekly} />
    </Card>
  );
}

function Kpi({
  label,
  value,
  range,
  baseline,
  direction,
}: {
  label: string;
  value: string;
  range: string;
  baseline: string;
  direction: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-tile bg-surface-raised p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-3xl font-bold text-fg">{value}</span>
      {range !== '' && <span className="text-xs text-caption">بازه‌ی ۹۵٪: {range}</span>}
      <span className="text-xs text-muted">{baseline}</span>
      <span className="text-xs text-caption">{direction}</span>
    </div>
  );
}

const Section = ({
  title,
  lead,
  children,
  testid,
}: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
  testid: string;
}) => (
  <section className="mt-6 border-t border-default pt-5" data-testid={testid}>
    <h3 className="text-base font-bold text-fg">{title}</h3>
    <p className="mt-1 text-sm leading-7 text-muted">{lead}</p>
    <div className="mt-3">{children}</div>
  </section>
);

/** The model watch's rule: 100 forecasts or more, and seen more than 8 points from said or its interval excluding it. */
const flagged = (b: ConsoleModelCalibrationBand) =>
  b.forecasts >= 100 &&
  (Math.abs(b.seen.mean - b.said) > 0.08 ||
    (b.seen.low !== null && b.seen.high !== null && (b.said < b.seen.low || b.said > b.seen.high)));

function Calibration({ bands }: { bands: ConsoleModelCalibrationBand[] }) {
  const shown = bands.filter((b) => b.forecasts >= CONSOLE_MODEL_CALIBRATION_MINIMUM);
  const off = shown.filter(flagged);
  return (
    <Section
      testid="calibration"
      title="آنچه گفت در برابر آنچه شد (calibration)"
      lead={
        <>
          اگر مدل به نتیجه‌ای ۴۰٪ بدهد، آن نتیجه باید در حدود ۴۰٪ این مسابقه‌ها رخ دهد. هر نقطه یک
          باند ده‌درصدی است با خط بازه‌ی ۹۵٪اش؛ روی خط مورب یعنی درست. باندی که کمتر از{' '}
          {fa(CONSOLE_MODEL_CALIBRATION_MINIMUM)} پیش‌بینی دارد کشیده نمی‌شود.
        </>
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-muted">هنوز هیچ باندی پیش‌بینی کافی ندارد.</p>
      ) : (
        <>
          <CalibrationPanels bands={bands} />
          {off.length > 0 && (
            <div
              className="mt-3 rounded-tile bg-surface-raised p-3 text-sm"
              data-testid="calibration-off"
            >
              <p className="font-bold text-fg">
                باندهایی که از قاعده‌ی پایش هفتگی رد می‌شوند (۱۰۰ پیش‌بینی یا بیشتر، و فاصله‌ی بیش
                از ۸ واحد درصد یا بازه‌ای که عدد مدل را در بر نمی‌گیرد):
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                {off.map((b) => (
                  <li key={`${b.outcome}${b.band}`}>
                    {OUTCOME_WORDS[b.outcome]} در باند {percent(b.band / 10, 0)} تا{' '}
                    {percent((b.band + 1) / 10, 0)}: مدل {percent(b.said)} گفت،{' '}
                    {percent(b.seen.mean)} رخ داد {interval(b.seen, (v) => percent(v))} ·{' '}
                    {fa(b.forecasts)} پیش‌بینی
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted">جدول همه‌ی باندها</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[30rem] whitespace-nowrap text-sm">
                <caption className="sr-only">calibration هر باند</caption>
                <thead className="text-xs text-caption">
                  <tr>
                    <th className="p-2 text-start font-normal">نتیجه</th>
                    <th className="p-2 text-start font-normal">باند</th>
                    <th className="p-2 text-start font-normal">پیش‌بینی</th>
                    <th className="p-2 text-start font-normal">مدل گفت</th>
                    <th className="p-2 text-start font-normal">رخ داد</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b) => (
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
                          {interval(b.seen, (v) => percent(v))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Section>
  );
}

function Trend({ report }: { report: ConsoleModelReport }) {
  const points = report.trend.filter((p) => p.log_loss !== null);
  return (
    <Section
      testid="trend-section"
      title="هفته به هفته"
      lead={
        <>
          log loss هر هفته (هفته از دوشنبه) در برابر حدس یک‌سوم. هفته‌های کم‌مسابقه نوسان بیشتری
          دارند؛ نقطه‌ی توخالی یعنی کمتر از {fa(report.minimum_matches)} مسابقه.
        </>
      }
    >
      {points.length < 2 ? (
        <p className="text-sm text-muted">برای نمودار دست‌کم دو هفته‌ی ارزیابی‌شده لازم است.</p>
      ) : (
        <TrendChart
          points={points}
          reference={report.reference.uniform_log_loss}
          minimum={report.minimum_matches}
        />
      )}
      {points.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">جدول هفته‌ها</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[30rem] whitespace-nowrap text-sm">
              <caption className="sr-only">دقت هر هفته</caption>
              <thead className="text-xs text-caption">
                <tr>
                  <th className="p-2 text-start font-normal">هفته‌ی</th>
                  <th className="p-2 text-start font-normal">مسابقه</th>
                  <th className="p-2 text-start font-normal">log loss</th>
                  <th className="p-2 text-start font-normal">Brier</th>
                  <th className="p-2 text-start font-normal">درصد درست</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.period_start} className="border-t border-default">
                    <td className="p-2">{when(p.period_start, false)}</td>
                    <td className="p-2 tabular-nums">{fa(p.matches)}</td>
                    <td className="p-2 tabular-nums">{score(p.log_loss ?? 0)}</td>
                    <td className="p-2 tabular-nums">{p.brier === null ? '—' : score(p.brier)}</td>
                    <td className="p-2 tabular-nums">
                      {p.accuracy === null ? '—' : percent(p.accuracy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Section>
  );
}

function Competitions({ report }: { report: ConsoleModelReport }) {
  const ref = report.reference.uniform_log_loss;
  const ranked = report.competitions.filter(
    (c) => c.record.coverage === 'available' && c.record.log_loss !== null,
  );
  const thin = report.competitions.filter((c) => !ranked.includes(c));
  const scale = intervalScale(
    ranked.flatMap((c) => (c.record.log_loss === null ? [] : [c.record.log_loss])),
    ref,
  );
  const badge = (c: ConsoleModelCompetition, i: number) => {
    const ll = c.record.log_loss;
    if (ll !== null && ll.low !== null && ll.low > ref)
      return <Badge tone="border-danger text-danger">بدتر از حدس یک‌سوم</Badge>;
    if (ranked.length >= 6 && i < 3) return <Badge tone="border-model text-model">بهترین</Badge>;
    if (ranked.length >= 6 && i >= ranked.length - 3)
      return <Badge tone="border-warning text-warning">ضعیف‌ترین</Badge>;
    return null;
  };
  return (
    <Section
      testid="competitions"
      title="به تفکیک رقابت"
      lead={
        <>
          از بهترین تا ضعیف‌ترین بر پایه‌ی log loss؛ نقطه میانگین است و خط بازه‌ی ۹۵٪، خط عمودی حدس
          یک‌سوم ({score(ref)}). رقابتی که کمتر از {fa(report.minimum_matches)} مسابقه دارد فقط با
          شمارش آمده است.
        </>
      }
    >
      {ranked.length === 0 ? (
        <p className="text-sm text-muted">
          هنوز هیچ رقابتی {fa(report.minimum_matches)} مسابقه‌ی ارزیابی‌شده ندارد.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">دقت نسخه‌ی منتشرشده در هر رقابت</caption>
            <thead className="text-xs text-caption">
              <tr>
                <th className="p-2 text-start font-normal">رقابت</th>
                <th className="p-2 text-start font-normal">مسابقه</th>
                <th className="p-2 text-start font-normal">log loss و بازه</th>
                <th className="w-[30%] p-2 font-normal">
                  <IntervalAxis scale={scale} reference={ref} />
                </th>
                <th className="p-2 text-start font-normal">درصد درست</th>
                <th className="p-2 text-start font-normal">Brier</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((c, i) => {
                const ll = c.record.log_loss!;
                return (
                  <tr key={c.competition.id} className="border-t border-default">
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-fg" dir="ltr">
                          {c.competition.name}
                        </span>
                        {badge(c, i)}
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
                      {c.record.brier === null ? '—' : score(c.record.brier.mean)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {thin.length > 0 && (
        <p className="mt-3 text-xs leading-6 text-caption" data-testid="thin">
          با کمتر از {fa(report.minimum_matches)} مسابقه:{' '}
          {thin.map((c, i) => (
            <span key={c.competition.id}>
              {i > 0 && '، '}
              <span dir="ltr">{c.competition.name}</span> ({fa(c.record.matches)})
            </span>
          ))}
        </p>
      )}
    </Section>
  );
}

function Candidates({
  report,
  weekly,
}: {
  report: ConsoleModelReport;
  weekly: ConsoleReport | undefined;
}) {
  const published = report.published?.model_version;
  return (
    <Section
      testid="candidates"
      title="نسخه‌ی منتشرشده در برابر shadow"
      lead={
        <>
          روی همان مسابقه‌ها، هر طرف با آخرین پیش‌بینی پیش از شروع. ارتقا تصمیم نگه‌دارنده است
          (D-082)؛ هر شرط فقط یک بار، در اولین پایش هفتگی که شمارش کامل است، داوری می‌شود (D-336،
          اصلاحیه‌ی <span className="whitespace-nowrap">T-1720</span>)، و تا آن وقت فقط شمار گزارش
          می‌شود، نه بازه.
        </>
      }
    >
      {report.candidates.length === 0 ? (
        <p className="text-sm text-muted">الان نسخه‌ای در shadow نیست.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {report.candidates.map((c) => (
            <CandidateCard key={c.model_version} candidate={c} published={published} />
          ))}
        </div>
      )}
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

function CandidateCard({
  candidate: c,
  published,
}: {
  candidate: ConsoleModelCandidate;
  published: string | undefined;
}) {
  const rule = MODEL_NOTES[c.model_version]?.rule;
  const figures = c.paired.figures;
  const reached = c.paired.matches >= CONSOLE_MODEL_PAIRED_MINIMUM;
  return (
    <div className="rounded-tile border border-default p-4" data-testid="candidate">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-bold text-fg" dir="ltr">
          {c.model_version}
        </span>
        <span className="text-sm text-muted">در برابر</span>
        <span className="text-sm text-fg" dir="ltr">
          {published ?? '—'}
        </span>
        <Badge>{rule === 'D-336' ? 'نسخه‌ی پوششی، قاعده‌ی D-336' : 'قاعده‌ی D-139 و D-140'}</Badge>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <CountMeter
          count={c.paired.matches}
          needed={CONSOLE_MODEL_PAIRED_MINIMUM}
          label={rule === 'D-336' ? 'شرط «بدتر نیست»: مسابقه‌های جفتی' : 'مسابقه‌های جفتی'}
        />
        {rule === 'D-336' && (
          <CountMeter
            count={c.new_divisions.matches}
            needed={CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM}
            label="شرط «بهتر از حدس یک‌سوم در لیگ‌های تازه»: مسابقه‌ها"
          />
        )}
      </div>
      <p className="mt-3 text-sm leading-7 text-fg" data-testid="verdict-state">
        {reached
          ? 'شمار مسابقه‌های جفتی رسیده است. حکم یک بار در پایش هفتگی ثبت می‌شود؛ عددهای زیر زنده‌اند و حکم نیستند.'
          : `شمار هنوز نرسیده: ${fa(c.paired.matches)} از ${fa(CONSOLE_MODEL_PAIRED_MINIMUM)} مسابقه‌ی جفتی.`}
        {c.paired.matches > 0 &&
          ` در ${fa(c.paired.identical)} مسابقه از ${fa(c.paired.matches)} (${percent(
            c.paired.identical / c.paired.matches,
          )}) هر دو نسخه دقیقاً یک پیش‌بینی داده‌اند.`}
      </p>
      {figures !== null && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" data-testid="paired-figures">
            <caption className="sr-only">مقایسه‌ی جفتی</caption>
            <thead className="text-xs text-caption">
              <tr>
                <th className="p-2 text-start font-normal" />
                <th className="p-2 text-start font-normal">log loss</th>
                <th className="p-2 text-start font-normal">Brier</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-default">
                <td className="p-2">منتشرشده</td>
                <td className="p-2 tabular-nums">{score(figures.published_log_loss, 4)}</td>
                <td className="p-2 tabular-nums">{score(figures.published_brier, 4)}</td>
              </tr>
              <tr className="border-t border-default">
                <td className="p-2">shadow</td>
                <td className="p-2 tabular-nums">{score(figures.candidate_log_loss, 4)}</td>
                <td className="p-2 tabular-nums">{score(figures.candidate_brier, 4)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-sm text-muted">
            اختلاف log loss (shadow منهای منتشرشده؛ منفی یعنی بهتر):{' '}
            <span dir="ltr">{score(figures.difference.mean, 5)}</span>{' '}
            {interval(figures.difference, (v) => score(v, 5))}
            {rule === 'D-336' &&
              ` · سقف «بدتر نیست» برای بالای بازه: +${score(CONSOLE_MODEL_NO_WORSE_MARGIN)}`}
          </p>
        </div>
      )}
      {rule === 'D-336' && c.new_divisions.log_loss !== null && (
        <p className="mt-2 text-sm text-muted">
          log loss روی {fa(c.new_divisions.matches)} مسابقه‌ی لیگ‌های تازه:{' '}
          {score(c.new_divisions.log_loss.mean)} {interval(c.new_divisions.log_loss)}
        </p>
      )}
      {c.own.matches > 0 && c.own.log_loss !== null && c.own.accuracy !== null && (
        <p className="mt-2 text-xs text-caption">
          کارنامه‌ی خودش روی {fa(c.own.matches)} مسابقه (مسابقه‌هایی متفاوت با نسخه‌ی منتشرشده، پس
          مستقیم مقایسه نکنید): log loss {score(c.own.log_loss.mean)}، درصد درست{' '}
          {percent(c.own.accuracy.mean)}.
        </p>
      )}
    </div>
  );
}

// --- 4. Glossary -----------------------------------------------------------------

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
      'calibration',
      'اینکه احتمال‌ها راست می‌گویند یا نه: از مسابقه‌هایی که مدل به یک نتیجه ۴۰٪ داده، باید حدود ۴۰٪ همان نتیجه را داده باشند.',
    ],
    [
      'بازه‌ی ۹۵٪',
      'با این تعداد مسابقه، عدد واقعی به احتمال زیاد در این فاصله است؛ هر چه مسابقه بیشتر، بازه باریک‌تر.',
    ],
    ['shadow', 'نسخه‌ای که پیش‌بینی می‌کند و ثبت و سنجیده می‌شود، ولی روی سایت نمی‌آید.'],
  ];
  return (
    <Card title="واژه‌ها">
      <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-[10rem_minmax(0,1fr)]">
        {rows.map(([term, meaning]) => (
          <div key={term} className="contents">
            <dt className="font-bold text-fg">{term}</dt>
            <dd className="leading-7 text-muted">{meaning}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
