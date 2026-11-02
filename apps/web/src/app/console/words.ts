import type { ConsoleCommandKind } from '@fmip/contracts';

/**
 * The console's Persian for what reaches it in English (T-1725, D-352): the
 * API's error messages, the audit trail's actions and system reasons, the
 * computer's command outcomes and who decided. Each known English sentence
 * has its Persian; an unknown one falls back to a Persian sentence for its
 * kind, never to the English (the console is Persian only).
 */

const fa = (n: string) => new Intl.NumberFormat('fa-IR').format(Number(n));

/** The API's console messages (`agents-console.controller.ts`, `console-rules.ts`). */
const API_MESSAGES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Sign in to the console\.$/, () => 'وارد کنسول شوید.'],
  [
    /^Wrong name or password/,
    () => 'نام کاربری یا رمز درست نیست، یا این نام پس از چند تلاش ناموفق مدتی قفل شده است.',
  ],
  [/^This invitation is used or has expired\.$/, () => 'این دعوت استفاده شده یا وقتش گذشته است.'],
  [/^This invitation link is not whole\.$/, () => 'لینک دعوت کامل نیست.'],
  [
    /^A name of 3 to 32 /,
    () => 'نام کاربری: ۳ تا ۳۲ نویسه از حرف کوچک انگلیسی، رقم، نقطه، خط تیره یا زیرخط.',
  ],
  [
    /^A password of (\d+) to (\d+) characters\.$/,
    (m) => `رمز باید ${fa(m[1]!)} تا ${fa(m[2]!)} نویسه باشد.`,
  ],
  [/^That name is taken/, () => 'این نام کاربری گرفته شده است؛ نام دیگری انتخاب کنید.'],
  [/^No such card\.$/, () => 'چنین کارتی نیست.'],
  [/^No such agent\.$/, () => 'چنین عاملی نیست.'],
  [/^No such open decision\.$/, () => 'چنین تصمیم بازی نیست.'],
  [/^before is a message id\.$/, () => 'نشانی پیام‌های قدیمی‌تر درست نیست.'],
  [
    /^That is the most messages/,
    () => 'به سقف پیام‌های یک ساعت به عامل‌ها رسیده‌اید؛ کمی بعد بفرستید.',
  ],
  [/^Say what to do\.$/, () => 'دستور را بگویید.'],
  [/^Not a command the console knows\.$/, () => 'کنسول این دستور را نمی‌شناسد.'],
  [/^Give a reason, up to (\d+) characters\.$/, (m) => `دلیل را بنویسید (تا ${fa(m[1]!)} نویسه).`],
  [/^Every value must be text\.$/, () => 'همه‌ی مقدارها باید متن باشند.'],
  [/^Choose an answer\.$/, () => 'یک گزینه را انتخاب کنید.'],
  [/^Not a model the agents run on\.$/, () => 'عامل‌ها با این مدل کار نمی‌کنند.'],
  [/^Not a schedule the daily run knows\.$/, () => 'اجرای روزانه این برنامه را نمی‌شناسد.'],
  [/^Write a message\.$/, () => 'پیامی بنویسید.'],
  [/^A message is at most (\d+) characters\.$/, (m) => `پیام حداکثر ${fa(m[1]!)} نویسه است.`],
  [/^Send the card\.$/, () => 'کارت را بفرستید.'],
  [/^A title, up to 200 characters\.$/, () => 'عنوان لازم است (تا ۲۰۰ نویسه).'],
  [/^The text is too long\.$/, () => 'متن خیلی بلند است.'],
  [/^Not a column of the board\.$/, () => 'این ستون در تابلو نیست.'],
  [/^A position is a whole number\.$/, () => 'جایگاه باید عدد صحیح باشد.'],
  [/^Up to ten labels of 40 characters\.$/, () => 'حداکثر ده برچسب، هرکدام تا ۴۰ نویسه.'],
  [/^An assignee is a name\.$/, () => 'مسئول باید یک نام باشد.'],
  [/^A due date is YYYY-MM-DD\.$/, () => 'موعد باید به شکل YYYY-MM-DD باشد.'],
  [/^A new card needs a title and a column\.$/, () => 'کارت تازه عنوان و ستون می‌خواهد.'],
];

const hasLatin = (text: string) => /[A-Za-z]{2,}/.test(text);

/** An API error for a form: its Persian, or the form's own Persian when the message is unknown. */
export function apiErrorWords(message: string | undefined, fallback: string): string {
  if (message === undefined || message === '') return fallback;
  for (const [pattern, words] of API_MESSAGES) {
    const match = pattern.exec(message);
    if (match !== null) return words(match);
  }
  return hasLatin(message) ? fallback : message;
}

export const COMMAND_WORDS: Record<ConsoleCommandKind, string> = {
  'agent.pause': 'توقف',
  'agent.resume': 'ادامه',
  'agent.run': 'اجرای فوری',
  'agent.model': 'تغییر مدل',
  'agent.schedule': 'تغییر برنامه',
  'decision.answer': 'پاسخ به تصمیم',
};

const SCHEDULES: Record<string, string> = {
  daily: 'روزانه',
  weekly: 'هفتگی',
  monthly: 'ماهانه',
  'on-demand': 'هر وقت خواسته شود',
};

/** The computer's outcome of a command; the publisher writes Persian since D-352, older rows are English. */
export function outcomeWords(outcome: string): string {
  const legacy: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^Paused/, () => 'متوقف شد: اجرای روزانه از آن می‌گذرد.'],
    [/^Resumed/, () => 'ادامه دارد: اجرای روزانه دوباره اجرایش می‌کند.'],
    [/^Runs on (\S+) from its next run\.$/, (m) => `از اجرای بعدی با ${m[1]} کار می‌کند.`],
    [/^Scheduled (\S+)\.$/, (m) => `برنامه: ${SCHEDULES[m[1]!] ?? m[1]}.`],
    [/^Waiting for the next sync/, () => 'منتظر همگام‌سازی بعدی برای شروع.'],
    [/^Answer recorded/, () => 'پاسخ برای اجرای روزانه ثبت شد.'],
    [/^No agent (\S+) on the computer\.$/, (m) => `عاملی به نام ${m[1]} روی رایانه نیست.`],
  ];
  for (const [pattern, words] of legacy) {
    const match = pattern.exec(outcome);
    if (match !== null) return words(match);
  }
  return outcome;
}

/** Who decided: a console person's name as it is, the desk, the maintainer, the teammate or an agent in Persian. */
export function deciderWords(by: string | null): string {
  if (by === null || by === '') return '';
  if (/^the decision desk$/i.test(by)) return 'میز تصمیم';
  if (/^maintainer\b/i.test(by)) return 'نگهدارنده';
  if (/^teammate\b/i.test(by)) return 'هم‌تیمی';
  if (/^agent\b/i.test(by)) return 'یک عامل';
  return by;
}

const AUDIT_ACTIONS: Record<string, string> = {
  'console.sign_in': 'ورود',
  'console.sign_in_failed': 'ورود ناموفق',
  'console.locked': 'قفل شدن نام',
  'console.invitation_accepted': 'باز کردن حساب با دعوت',
  'board.card_created': 'کارت تازه',
  'board.card_changed': 'تغییر کارت',
  'board.card_archived': 'بایگانی کارت',
  'chat.message_posted': 'پیام به عامل',
};

/** An audit row's action in Persian (`command.agent_pause` from `COMMAND_WORDS`); an unknown one keeps its id. */
export function auditActionWords(action: string): { words: string; known: boolean } {
  const command = /^command\.(.+)$/.exec(action)?.[1]?.replace('_', '.');
  const words =
    AUDIT_ACTIONS[action] ??
    (command !== undefined ? COMMAND_WORDS[command as ConsoleCommandKind] : undefined);
  return words === undefined ? { words: action, known: false } : { words, known: true };
}

/** The reasons the API writes itself; a person's own reason is shown as written. */
export function auditReasonWords(reason: string): string {
  const system: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^signed in$/, () => 'وارد شد'],
    [/^wrong name or password$/, () => 'نام یا رمز نادرست'],
    [/^locked until (.+)$/, () => 'قفل تا مدتی پس از چند تلاش ناموفق'],
    [/^account opened for (.+)$/, (m) => `حساب برای ${m[1]} باز شد`],
    [/^card added$/, () => 'کارت اضافه شد'],
    [/^moved from (.+)$/, (m) => `آورده‌شده از ${m[1]}`],
    [/^card changed$/, () => 'کارت تغییر کرد'],
    [/^card archived$/, () => 'کارت بایگانی شد'],
    [/^message to the agent$/, () => 'پیام به عامل'],
  ];
  for (const [pattern, words] of system) {
    const match = pattern.exec(reason);
    if (match !== null) return words(match);
  }
  return reason;
}
