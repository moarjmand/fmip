import type { ReactNode } from 'react';
import type {
  ConsoleAgent,
  ConsoleFinding,
  ConsoleHeartbeat,
  ConsoleHeartbeatState,
  ConsoleSeverity,
} from '@fmip/contracts';
import {
  CONSOLE_DAILY_RUN_TIME,
  CONSOLE_SILENT_HOURS,
  CONSOLE_SYNC_GRACE_MINUTES,
  CONSOLE_SYNC_TIME_ZONE,
  CONSOLE_SYNC_TIMES,
  consolePcState,
  wallClock,
} from '@fmip/contracts/console';
import { WITHHELD_TITLE, findingParts, titleWithheld } from './triage';
import { tehranClock as clock } from './words';

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
  // T-1907: a person's triage. «پذیرفته», as D-456 point 2 has it for `planned`.
  planned: 'پذیرفته',
  rejected: 'رد شده',
  snoozed: 'به تعویق افتاده',
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

// --- The computer's heartbeat (T-1906, D-456) --------------------------------

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** A wall-clock time such as `09:25` in Persian digits. */
const faClock = (time: string): string => time.replace(/\d/g, (d) => FA_DIGITS[Number(d)] ?? d);

/** An instant's day and time in Tehran, «۲۸ آبان ۰۱:۵۴». */
function dayAndClock(date: Date): string {
  const day = new Intl.DateTimeFormat('fa-IR', {
    timeZone: CONSOLE_SYNC_TIME_ZONE,
    day: 'numeric',
    month: 'long',
  }).format(date);
  return `${day} ${clock(date)}`;
}

const sameDay = (a: Date, b: Date): boolean =>
  wallClock(a, CONSOLE_SYNC_TIME_ZONE).date === wallClock(b, CONSOLE_SYNC_TIME_ZONE).date;

/** How long ago, from whole minutes: minutes under an hour, hours under two days, then days. */
function ago(minutes: number): string {
  if (minutes < 1) return 'کمتر از یک دقیقه پیش';
  if (minutes < 60) return `${fa(minutes)} دقیقه پیش`;
  if (minutes < 48 * 60) return `${fa(Math.floor(minutes / 60))} ساعت پیش`;
  return `${fa(Math.floor(minutes / (24 * 60)))} روز پیش`;
}

const HEARTBEAT_WORDS: Record<ConsoleHeartbeatState, string> = {
  fresh: 'هم‌گام',
  late: 'دیر شده',
  silent: 'خاموش',
  never: 'بی‌داده',
};

/** What the last sync says about the computer, in Persian (rule 4). */
export interface Freshness {
  state: ConsoleHeartbeatState;
  /** The state as one word, shown beside its shape. */
  word: string;
  /**
   * The bold sentence that says the state and nothing that ages: the one
   * part a screen reader is told about, so it speaks when the state changes
   * and not each time "two hours ago" becomes three.
   */
  title: string;
  /** The rest of the bold line: how long ago and when, or empty. It ages; it is not announced. */
  since: string;
  /** The muted sentence under it. */
  detail: string;
  /** The next sync time by the schedule, «۱۵:۲۵»: a time on the timetable, not a promise. */
  next: string;
}

/**
 * The computer's state from the newest snapshot's arrival, worded: fresh,
 * late, silent («رایانه خاموش است», an inference from silence) or never
 * synced, which is not "nothing exists". The limits and the sync's times are
 * `@fmip/contracts/console`'s.
 */
export function freshness(loadedAt: string | null, now: Date): Freshness {
  const pc = consolePcState(loadedAt, now);
  const next = clock(pc.nextSlot);
  const base = { state: pc.state, word: HEARTBEAT_WORDS[pc.state], next };
  if (pc.lastSync === null || pc.ageMinutes === null)
    return {
      ...base,
      title: 'هنوز هیچ هم‌گام‌سازی از رایانه نرسیده است',
      since: '',
      detail:
        'یافته‌ها، گزارش‌ها و وضعیت عامل‌ها خالی‌اند چون از رایانه نیامده‌اند، نه چون چیزی نیست.',
    };
  const age = ago(pc.ageMinutes);
  const stamp = dayAndClock(pc.lastSync);
  if (pc.state === 'silent')
    return {
      ...base,
      title: 'رایانه خاموش است؛ دستورها در صف می‌مانند.',
      since: '',
      detail: `آخرین هم‌گام‌سازی: ${stamp}، ${age}. در این مدت هیچ عاملی اجرا نشده و یافته‌ها و گزارش‌ها همان زمان‌اند.`,
    };
  const today = sameDay(pc.lastSync, now);
  if (pc.state === 'late')
    return {
      ...base,
      title: 'هم‌گام‌سازی دیر شده؛',
      since: `آخرین: ${age} (${stamp})`,
      // What is known: a sync that was due did not arrive. Whether the agents
      // ran on the computer meanwhile is not, so it is not said.
      detail: `هم‌گام‌سازی نوبت ${pc.missedSlot === null ? 'پیش' : clock(pc.missedSlot)} نرسیده است. آنچه می‌بینید از آخرین هم‌گام‌سازی در ${today ? clock(pc.lastSync) : stamp} است.`,
    };
  return {
    ...base,
    title: 'آخرین هم‌گام‌سازی:',
    since: `${age} (${today ? `امروز ${clock(pc.lastSync)}` : stamp})`,
    detail:
      pc.dueSlot === null
        ? `هم‌گام‌سازی بعدی حدود ${next}. دستورها و پیام‌های تازه تا آن‌وقت در صف می‌مانند.`
        : `هم‌گام‌سازی نوبت ${clock(pc.dueSlot)} هنوز نرسیده است. دستورها و پیام‌های تازه تا رسیدنش در صف می‌مانند.`,
  };
}

const COUNT_WORDS: Record<number, string> = { 1: 'یک', 2: 'دو', 3: 'سه', 4: 'چهار' };
const syncTimes = (separator: string): string => CONSOLE_SYNC_TIMES.map(faClock).join(separator);

/**
 * The sentence above an agent's controls: how often the computer syncs, from
 * the one list of its times, and the next one. With the computer silent or
 * never seen no next time is named.
 */
export function syncSentence(fresh: Freshness): string {
  const times = CONSOLE_SYNC_TIMES.length;
  const often = `هم‌گام‌سازی روزی ${COUNT_WORDS[times] ?? fa(times)} بار است (${syncTimes('، ')}؛ وقت تهران)`;
  const next =
    fresh.state === 'silent' || fresh.state === 'never' ? '.' : `؛ بعدی حدود ${fresh.next}.`;
  return `هر دستور در صف می‌ماند تا رایانه آن را بردارد. ${often}${next}`;
}

type HeartbeatLook = ConsoleHeartbeatState | 'unread';

/** Each state's colours; the word and the shape carry the state, the colour only repeats it. */
const HEARTBEAT_TONE: Record<HeartbeatLook, { box: string; icon: string; badge: string }> = {
  fresh: { box: 'border-default bg-surface', icon: 'text-fg', badge: 'border-fg text-fg' },
  late: {
    box: 'border-warning bg-selected',
    icon: 'text-warning',
    badge: 'border-warning text-warning',
  },
  silent: {
    box: 'border-danger bg-surface',
    icon: 'text-danger',
    badge: 'border-danger text-danger',
  },
  never: {
    box: 'border-danger bg-surface',
    icon: 'text-danger',
    badge: 'border-danger text-danger',
  },
  unread: {
    box: 'border-strong bg-surface',
    icon: 'text-muted',
    badge: 'border-strong text-muted',
  },
};

/** A fact beside the sentences: the badge's pill, but free to wrap on a narrow phone. */
const HEARTBEAT_CHIP = 'rounded-pill border border-default px-2 py-0.5 text-xs text-muted';

/** A shape per state: a check, a triangle, a power sign, a question mark. */
function HeartbeatIcon({ look }: { look: HeartbeatLook }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[1.125rem] flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {look === 'fresh' && <path d="M4 12l5 5L20 6" />}
      {look === 'late' && (
        <>
          <path d="M12 3l10 18H2z" />
          <path d="M12 10v5M12 18v.5" />
        </>
      )}
      {(look === 'silent' || look === 'never') && (
        <>
          <path d="M12 3v9" />
          <path d="M6.5 6.5a8 8 0 1 0 11 0" />
        </>
      )}
      {look === 'unread' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.4c-.8.5-1.2 1-1.2 1.8M12 17v.5" />
        </>
      )}
    </svg>
  );
}

/** The sync's timetable and what "late" and "silent" mean, from the same constants the state uses. */
function SyncSchedule() {
  const grace =
    CONSOLE_SYNC_GRACE_MINUTES === 60 ? 'یک ساعت' : `${fa(CONSOLE_SYNC_GRACE_MINUTES)} دقیقه`;
  return (
    <>
      برنامه‌ی هم‌گام‌سازی (وقت تهران): <b className="font-bold">{syncTimes(' · ')}</b> و اجرای
      روزانه‌ی تیم {faClock(CONSOLE_DAILY_RUN_TIME)}. «دیر شده» یعنی {grace} از نوبت گذشته؛ «خاموش»
      یعنی بیش از {fa(CONSOLE_SILENT_HOURS)} ساعت.
    </>
  );
}

/**
 * The computer's heartbeat bar (T-1906, D-456), on every console page and,
 * `compact`, above an agent's controls: the state as a shape and a word, when
 * the last sync was, what follows from it, and what waits in the queue. A
 * standing state, so `role="status"` and never an alert; nothing moves. The
 * live region is the state's word and sentence alone: the "… ago" beside it
 * and the sentence under it change with the clock and with every new render,
 * and are read when a person gets to them, not announced.
 *
 * `heartbeat` is `null` when the server did not answer, which is said as
 * that: neither "off" nor "never synced" is claimed without a time to rest
 * on. The queue's chips go when the counts could not be read; the sentences
 * stay.
 */
export function PcHeartbeat({
  heartbeat,
  now,
  compact = false,
}: {
  heartbeat: ConsoleHeartbeat | null;
  now: Date;
  compact?: boolean;
}) {
  const fresh = heartbeat === null ? null : freshness(heartbeat.loaded_at, now);
  const look: HeartbeatLook = fresh?.state ?? 'unread';
  const tone = HEARTBEAT_TONE[look];
  const word = fresh?.word ?? 'نامعلوم';
  const title = fresh?.title ?? 'وضعیت رایانه خوانده نشد';
  const since = fresh?.since ?? '';
  const detail =
    fresh?.detail ??
    'زمان آخرین هم‌گام‌سازی از سرور خوانده نشد؛ این یعنی نمی‌دانیم، نه این‌که رایانه خاموش است. صفحه را دوباره باز کنید.';
  const heading = (
    <p className="text-[0.9375rem] font-bold text-fg">
      <span role={compact ? undefined : 'status'}>
        <span className="me-2 inline-flex align-middle">
          <Badge tone={tone.badge}>{word}</Badge>
        </span>
        {title}
      </span>
      {since !== '' && ` ${since}`}
    </p>
  );
  if (compact)
    return (
      <div
        data-testid="pc-heartbeat-compact"
        data-state={look}
        className={`mb-3 flex items-start gap-3 rounded-control border border-s-[5px] px-3 py-2 ${tone.box}`}
      >
        <span className={`mt-0.5 ${tone.icon}`}>
          <HeartbeatIcon look={look} />
        </span>
        <div className="min-w-0 flex-1">{heading}</div>
      </div>
    );
  const queued = heartbeat?.queued ?? null;
  return (
    <div
      data-testid="pc-heartbeat"
      data-state={look}
      className={`flex items-start gap-3.5 rounded-tile border border-s-[5px] px-4 py-3.5 ${tone.box}`}
    >
      <span className={`mt-0.5 ${tone.icon}`}>
        <HeartbeatIcon look={look} />
      </span>
      <div className="min-w-0 flex-1">
        {heading}
        <p className="mt-0.5 text-[0.8125rem] text-muted">{detail}</p>
        {fresh !== null && (
          <>
            <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1.5">
              {fresh.state !== 'never' && queued !== null && (
                <>
                  <li className={HEARTBEAT_CHIP}>{fa(queued.commands)} دستور در صف</li>
                  <li className={HEARTBEAT_CHIP}>{fa(queued.messages)} پیام در صف</li>
                </>
              )}
              <li className={HEARTBEAT_CHIP}>مدل، تقویم و یادآورها بدون رایانه کار می‌کنند</li>
            </ul>
            <p className="mt-1.5 hidden text-xs text-caption md:block">
              <SyncSchedule />
            </p>
            <details className="mt-1.5 md:hidden">
              <summary className="min-h-6 cursor-pointer text-[0.8125rem] leading-6 font-semibold text-accent">
                برنامه‌ی هم‌گام‌سازی
              </summary>
              <p className="mt-1 text-xs text-caption">
                <SyncSchedule />
              </p>
            </details>
          </>
        )}
      </div>
    </div>
  );
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
  // Many runs scroll inside their own box, not the page (T-1906: on a 375 px
  // phone the agent page went 72 px wide, and its heartbeat bar with it).
  return (
    <div
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-focus"
      role="group"
      aria-label="نمودار اجراها؛ برای دیدن همه به پهلو بلغزانید"
      tabIndex={0}
    >
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
    </div>
  );
}

/**
 * A finding's title (T-1908, D-456 point 3; the withheld title was decided
 * on 2026-11-22, T-1948): as written, in `bdi dir="auto"` so an English title
 * keeps its own direction inside the Persian page; and for a security
 * finding whose detail is withheld, a fixed phrase in its place, whatever
 * the snapshot carries.
 */
export function FindingTitle({ finding }: { finding: ConsoleFinding }) {
  return titleWithheld(finding) ? (
    <span data-withheld="title">{WITHHELD_TITLE}</span>
  ) : (
    <bdi dir="auto">{finding.title}</bdi>
  );
}

/**
 * A finding's detail as the computer wrote it, its labelled paragraphs worded
 * in Persian (T-1908): the evidence, the likely cause, the proposal, and a
 * person's triage line, which is the computer's own English and stays
 * left to right.
 */
export function FindingDetail({ detail }: { detail: string }) {
  const parts = findingParts(detail);
  const block = 'mt-1 whitespace-pre-wrap break-words text-sm text-muted';
  return (
    <>
      {parts.evidence !== '' && (
        <p dir="auto" className={block}>
          {parts.evidence}
        </p>
      )}
      {parts.cause !== '' && (
        <p className={block}>
          علت احتمالی: <bdi dir="auto">{parts.cause}</bdi>
        </p>
      )}
      {parts.proposal !== '' && (
        <p className={block}>
          پیشنهاد: <bdi dir="auto">{parts.proposal}</bdi>
        </p>
      )}
      {parts.triage !== '' && (
        <p dir="ltr" className="mt-1 break-words text-start text-xs text-caption">
          {parts.triage}
        </p>
      )}
    </>
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
      <p className="mt-1 text-sm font-bold text-fg">
        <FindingTitle finding={finding} />
      </p>
      {finding.detail === null ? (
        <p className="mt-1 text-xs text-caption">
          جزئیات این یافته‌ی امنیتی در کنسول نمایش داده نمی‌شود.
        </p>
      ) : (
        finding.detail !== '' && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted">جزئیات</summary>
            <FindingDetail detail={finding.detail} />
          </details>
        )
      )}
    </li>
  );
}
