import type { ReactNode } from 'react';
import type { ConsoleAgent, ConsoleFinding, ConsoleSeverity } from '@fmip/contracts';

/**
 * The agents console's building blocks (D-340): server components only, in
 * Persian for the maintainer and the teammate, with the site's tokens and
 * logical properties (rule 7).
 */

/** Each agent's role in Persian, beside its name. */
export const AGENT_TITLES: Record<string, string> = {
  'chief-of-staff': 'مدیر دفتر',
  'data-auditor': 'بازرس داده',
  'ops-release': 'عملیات و انتشار',
  'qa-engineer': 'مهندس کیفیت',
  'code-reviewer': 'بازبین کد',
  'model-scientist': 'دانشمند مدل',
  architect: 'معمار',
  designer: 'طراح',
  security: 'امنیت',
  'product-strategist': 'محصول و راهبرد',
  'content-community': 'محتوا و جامعه',
  'business-adviser': 'مشاور کسب‌وکار',
  'marketing-manager': 'مدیر بازاریابی',
  'seo-search': 'جست‌وجو و سئو',
  'social-media': 'شبکه‌های اجتماعی',
  'growth-analyst': 'تحلیلگر رشد',
};
export const agentTitle = (name: string): string => AGENT_TITLES[name] ?? name;

/**
 * Each agent's job in one Persian sentence (T-1725, D-352), shown instead of
 * its file's English description; a console spec fails on an agent without one.
 */
export const AGENT_DESCRIPTIONS: Record<string, string> = {
  'chief-of-staff':
    'یافته‌ها و گزارش‌های همه‌ی عامل‌ها، PRها و تصمیم‌های منتظر را می‌خواند و هر روز یک صفحه خلاصه‌ی فارسی با گزینه‌ها و پیشنهادش برای نگهدارنده می‌نویسد؛ هماهنگ می‌کند و چیزی نمی‌سازد، merge یا deploy نمی‌کند.',
  'data-auditor':
    'درستی داده‌ی production و سایت زنده را با بررسی‌های فقط‌خواندنی می‌سنجد (نتیجه‌ها، جدول‌ها، ترکیب‌ها، موجودیت‌های تکراری، کارهای کهنه، پیش‌بینی‌ها) و برای هر خطا اصلاح و بررسی تازه پیشنهاد می‌کند؛ داده را عوض نمی‌کند.',
  'ops-release':
    'سرور، کانتینرها، دیسک، پشتیبان‌ها، کارهای دریافت داده و پاسخ سایت را با snapshot فقط‌خواندنی می‌پاید و فهرست بررسی پیش و پس از هر deploy را اجرا می‌کند؛ سرور را تغییر نمی‌دهد.',
  'qa-engineer':
    'آزمون‌های هر PR را بررسی و اجرا می‌کند، هر روز سایت زنده را در دو زبان و در عرض گوشی و دسکتاپ می‌گردد و اسکرین‌شات‌های پیش از انتشار را می‌گیرد؛ آزمون را فقط به درخواست نشست مهندسی می‌نویسد.',
  'code-reviewer':
    'هر شاخه یا PR را با چشم تازه در برابر قواعد CLAUDE.md و خطاهای شناخته‌شده بازبینی می‌کند و حکم APPROVE یا CHANGES REQUESTED با یافته‌های فایل و خط می‌دهد؛ ویرایش، commit یا merge نمی‌کند.',
  'model-scientist':
    'کارنامه‌ی زنده‌ی مدل پیش‌بینی (log loss، Brier، calibration، نسخه‌ی منتشرشده در برابر shadow) را می‌پاید و آمادگی ارتقا را طبق D-139 می‌سنجد؛ نسخه‌ای را ارتقا یا ویرایش نمی‌کند.',
  architect:
    'پیش از هر تغییر بزرگ دو یا سه گزینه با پیامدهایشان می‌چیند، یکی را پیشنهاد و تصمیمش را پیش‌نویس می‌کند و هر ماه مرز ماژول‌ها و دفتر بدهی فنی را بررسی می‌کند؛ کد را ویرایش نمی‌کند.',
  designer:
    'هر تغییر دیدنی را پیش از ساخت روی داده‌ی واقعی در design system می‌کشد و صفحه‌ها و اسکرین‌شات‌ها را از نظر سلسله‌مراتب، دسترس‌پذیری، RTL و حالت تاریک بازبینی می‌کند؛ کد را ویرایش نمی‌کند.',
  security:
    'PRها را از نظر مجوز، ورودی، SQL، XSS، رازها و وابستگی‌ها بازبینی می‌کند و سرور و سایت را دوره‌ای با snapshot فقط‌خواندنی می‌سنجد؛ کد یا سرور را تغییر نمی‌دهد.',
  'product-strategist':
    'درخواست‌ها و بازخوردها را به کار با معیار پذیرش تبدیل و اولویت‌بندی می‌کند، رقبا را زیر نظر دارد و سلامت جست‌وجو و اشتراک‌گذاری را فقط‌خواندنی بررسی می‌کند؛ چیزی نمی‌سازد.',
  'content-community':
    'خبرخوان‌ها (منبع خاموش یا خراب، مجوز تصویر، فقط فوتبال)، صف بازبینی جامعه و متن فارسی و راست‌به‌چپ را می‌پاید و پرونده آماده می‌کند؛ منتشر نمی‌کند و درباره‌ی بازبینی تصمیم نمی‌گیرد.',
  'business-adviser':
    'دفتر مجوز همه‌ی منابع داده، خبر و تصویر، هزینه‌ها و تکلیف‌های حریم خصوصی را نگه می‌دارد و تصمیم‌های پولی و حقوقی را به شکل گزینه با هزینه و ریسک می‌نویسد؛ مشاوره‌ی حقوقی یا مالی نیست و چیزی نمی‌خرد.',
  'marketing-manager':
    'برنامه‌ی رشد (مخاطب، جایگاه، پیام، کانال‌ها، تقویم کمپین) را نگه می‌دارد، اولویت‌های جست‌وجو، شبکه‌های اجتماعی و تحلیلگر رشد را می‌چیند و گزارش دوشنبه را می‌نویسد؛ منتشر نمی‌کند، خرج نمی‌کند و حساب باز نمی‌کند.',
  'seo-search':
    'دیده‌شدن در Google و پاسخ‌های هوش مصنوعی را می‌سنجد: کلیدواژه‌ها، robots و sitemap، داده‌ی ساختاریافته، canonical و hreflang، عنوان‌ها و کارت‌های اشتراک، هر یافته با URL دقیقش؛ سایت را ویرایش نمی‌کند.',
  'social-media':
    'از داده‌ی واقعی سایت پیش‌نویس پست‌های Telegram، Instagram و X به فارسی و انگلیسی می‌نویسد تا نگهدارنده تأیید و منتشر کند؛ خودش منتشر نمی‌کند و وارد هیچ شبکه‌ای نمی‌شود.',
  'growth-analyst':
    'قیف ثبت‌نام و بازگشت، گروه‌های هفتگی، دنبال‌کردن‌ها و پیش‌بینی‌های جامعه را از پایگاه داده‌ی خود سایت با SQL فقط‌خواندنی می‌سنجد و فقط شمار کلی گزارش می‌کند؛ ردیاب اضافه نمی‌کند.',
};
export const agentDescription = (name: string): string =>
  AGENT_DESCRIPTIONS[name] ?? 'شرح فارسی این عامل هنوز در کنسول نوشته نشده است.';

export const SEVERITY_WORDS: Record<ConsoleSeverity, string> = {
  critical: 'بحرانی',
  major: 'مهم',
  minor: 'جزئی',
  info: 'اطلاع',
};

/**
 * The publisher's words for access and the workflow's ends, in Persian; the
 * snapshot keeps them in English (D-340), and an unknown one shows as sent.
 */
const PLAIN_WORDS: Record<string, string> = {
  'Reads the repository and the ops files': 'مخزن کد و پوشه‌ی عملیات را می‌خواند',
  'Writes its own reports and findings': 'گزارش‌ها و یافته‌های خودش را می‌نویسد',
  'Runs commands: scripts, git, and the server over ssh (read-only by the charter)':
    'فرمان اجرا می‌کند: اسکریپت‌ها، git، و سرور از راه ssh (طبق منشور فقط‌خواندنی)',
  'Searches and reads the web': 'در وب جست‌وجو می‌کند و می‌خواند',
  'Opens the live site in the built-in browser': 'سایت زنده را در مرورگر داخلی باز می‌کند',
  'Reads and writes the claude.ai pages (the desk)':
    'صفحه‌های claude.ai (میز تصمیم) را می‌خواند و می‌نویسد',
  'Asks other agents': 'از عامل‌های دیگر کمک می‌گیرد',
  'Uses the team skills': 'از مهارت‌های تیم استفاده می‌کند',
  'Other tools': 'ابزارهای دیگر',
  'The project rules and the charter': 'قواعد پروژه و منشور تیم',
  'Findings in E:/FMIP/ops/findings/': 'یافته‌ها در E:/FMIP/ops/findings/',
  'The daily brief and the desk questions': 'خلاصه‌ی روز و پرسش‌های میز تصمیم',
  'Its instructions': 'دستورالعمل خودش',
  'The project rules': 'قواعد پروژه',
  'The team charter': 'منشور تیم',
  'Its past findings': 'یافته‌های قبلی‌اش',
  'Its past reports': 'گزارش‌های قبلی‌اش',
  'Its own memory': 'حافظه‌ی خودش',
};
export const plain = (words: string): string =>
  (
    PLAIN_WORDS[words] ??
    words.replace(/^Reports in /, 'گزارش‌ها در ').replace(/^Skill: /, 'مهارت: ')
  ).replace(/\/$/, ''); // a trailing slash jumps to the wrong end in right-to-left text

export const SCHEDULE_WORDS: Record<string, string> = {
  daily: 'روزانه',
  weekly: 'هفتگی',
  monthly: 'ماهانه',
  'on-demand': 'هر وقت خواسته شود',
};

export const STATUS_WORDS: Record<string, string> = {
  open: 'باز',
  fixed: 'رفع شده',
  wontfix: 'رفع نمی‌شود',
  duplicate: 'تکراری',
  queued: 'در صف',
  taken: 'برداشته شد',
  done: 'انجام شد',
  failed: 'ناموفق',
  cancelled: 'لغو شد',
};

const TEHRAN = 'Asia/Tehran';

/** A time in Persian, in Tehran time. */
export function when(iso: string | null, withTime = true): string {
  if (iso === null || iso === '') return '—';
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: TEHRAN,
    day: 'numeric',
    month: 'long',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export const fa = (n: number): string => new Intl.NumberFormat('fa-IR').format(n);

export const inputClass =
  'min-h-touch w-full rounded-control border border-strong bg-canvas px-3 text-sm text-fg focus:outline-2 focus:outline-focus';

/** How old the snapshot is; past a day it says so (rule 4). */
export function freshness(loadedAt: string | null, now: Date): { words: string; stale: boolean } {
  if (loadedAt === null) return { words: 'هنوز داده‌ای از رایانه نرسیده است.', stale: true };
  const hours = (now.getTime() - new Date(loadedAt).getTime()) / 3_600_000;
  const stale = hours > 26;
  return {
    words: `آخرین به‌روزرسانی: ${when(loadedAt)}${stale ? ' — کهنه است؛ اجرای روزانه انجام نشده.' : ''}`,
    stale,
  };
}

export function Card({
  title,
  children,
  action,
}: {
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-default bg-surface p-4 md:p-5">
      {(title !== undefined || action !== undefined) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title !== undefined && <h2 className="text-base font-bold text-fg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const SEVERITY_TONE: Record<ConsoleSeverity, string> = {
  critical: 'border-danger text-danger',
  major: 'border-warning text-warning',
  minor: 'border-strong text-muted',
  info: 'border-default text-caption',
};

export function Badge({
  children,
  tone = 'border-default text-muted',
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs ${tone}`}
    >
      {children}
    </span>
  );
}

export const SeverityBadge = ({ severity }: { severity: ConsoleSeverity }) => (
  <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_WORDS[severity]}</Badge>
);

export function Stat({
  label,
  value,
  tone = 'text-fg',
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-tile bg-surface-raised p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

/** Findings per run, newest at the inline end: a bar a run. */
export function RunsBars({ runs }: { runs: ConsoleAgent['runs'] }) {
  if (runs.length === 0) return <p className="text-sm text-muted">هنوز اجرایی ثبت نشده.</p>;
  const ordered = [...runs].reverse();
  const most = Math.max(1, ...ordered.map((run) => run.findings));
  return (
    <div className="flex items-end gap-1.5" style={{ blockSize: '7rem' }} data-testid="runs">
      {ordered.map((run) => (
        <div key={run.at} className="flex min-w-6 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-xs text-muted">{fa(run.findings)}</span>
          <div
            className={
              run.status === 'failed'
                ? 'w-full rounded-t-sm bg-danger'
                : 'w-full rounded-t-sm bg-brand'
            }
            style={{ blockSize: `${Math.max(4, (run.findings / most) * 64)}px` }}
            title={`${when(run.at, false)}: ${fa(run.findings)} یافته`}
          />
          <span className="text-[0.625rem] text-caption">{when(run.at, false)}</span>
        </div>
      ))}
    </div>
  );
}

export function FindingRow({ finding }: { finding: ConsoleFinding }) {
  return (
    <li className="border-b border-default py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <Badge>{STATUS_WORDS[finding.status] ?? finding.status}</Badge>
        <span className="text-xs text-caption" dir="ltr">
          {finding.id}
        </span>
        <span className="text-xs text-caption">
          · {agentTitle(finding.agent)} · {when(finding.opened_at, false)}
        </span>
      </div>
      <p className="mt-1 text-sm font-bold text-fg">{finding.title}</p>
      {finding.detail === null ? (
        <p className="mt-1 text-xs text-caption">
          جزئیات یافته‌ی امنیتی باز فقط روی رایانه‌ی شماست (D-340).
        </p>
      ) : (
        finding.detail !== '' && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted">جزئیات</summary>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{finding.detail}</p>
          </details>
        )
      )}
    </li>
  );
}
