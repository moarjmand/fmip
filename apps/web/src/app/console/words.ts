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
  // Teammate requests (T-1728): `request-rules.ts` and the controller.
  [/^No such request\.$/, () => 'چنین درخواستی نیست.'],
  [/^Give the request a title\.$/, () => 'عنوان درخواست را بنویسید.'],
  [/^A title is at most (\d+) characters\.$/, (m) => `عنوان حداکثر ${fa(m[1]!)} نویسه است.`],
  [/^The details are text\.$/, () => 'جزئیات باید متن باشد.'],
  [/^The details are at most (\d+) characters\.$/, (m) => `جزئیات حداکثر ${fa(m[1]!)} نویسه است.`],
  [/^A priority is normal or high\.$/, () => 'اولویت باید عادی یا فوری باشد.'],
  [/^Say what to change\.$/, () => 'بگویید چه چیزی عوض شود.'],
  [/^The action is cancel or reopen\.$/, () => 'فقط لغو یا بازگشایی ممکن است.'],
  [/^execute is true or false\.$/, () => 'علامت اجرا درست فرستاده نشد.'],
  [
    /^Choose agree, disagree or another view\.$/,
    () => 'یکی از «موافقم»، «مخالفم» یا «نظر دیگر» را انتخاب کنید.',
  ],
  [/^The decision text is text\.$/, () => 'متن تصمیم باید متن باشد.'],
  [
    /^The decision text is at most (\d+) characters\.$/,
    (m) => `متن تصمیم حداکثر ${fa(m[1]!)} نویسه است.`,
  ],
  [/^Write your view when you choose another view\.$/, () => 'برای «نظر دیگر» نظرتان را بنویسید.'],
  [/^Not a status a request has\.$/, () => 'چنین وضعیتی برای درخواست نیست.'],
  [
    /^A closed request is reopened before it is edited\.$/,
    () => 'این درخواست بسته است؛ برای ویرایش اول آن را بازگشایی کنید.',
  ],
  [/^This request is closed already\.$/, () => 'این درخواست از قبل بسته است.'],
  [/^This request is open already\.$/, () => 'این درخواست از قبل باز است.'],
  [/^This request waits for a decision first\.$/, () => 'این درخواست اول منتظر تصمیم است.'],
  [
    /^A closed request is reopened before it is run\.$/,
    () => 'این درخواست بسته است؛ برای اجرا اول آن را بازگشایی کنید.',
  ],
  [/^This request has no open question\.$/, () => 'این درخواست پرسش بازی ندارد.'],
  [
    /^That is the most changes to the requests/,
    () => 'به سقف تغییرهای یک ساعت در درخواست‌ها رسیده‌اید؛ کمی بعد دوباره امتحان کنید.',
  ],
  // Pictures on a request (T-1731): `request-images.ts`, the store, the routes.
  [/^No such picture\.$/, () => 'چنین تصویری نیست.'],
  [
    /^A request holds at most (\d+) pictures\.$/,
    (m) => `هر درخواست حداکثر ${fa(m[1]!)} تصویر دارد.`,
  ],
  [
    /^A closed request is reopened before its pictures change\.$/,
    () => 'این درخواست بسته است؛ برای تغییر تصویرها اول آن را بازگشایی کنید.',
  ],
  [/^The picture is empty\.$/, () => 'فایل تصویر خالی است.'],
  [/^A picture is at most (\d+) MB\.$/, (m) => `هر تصویر حداکثر ${fa(m[1]!)} مگابایت است.`],
  [
    /^HEIC pictures cannot be read here\./,
    () =>
      'تصویرهای آیفون با قالب اچ‌ئی‌آی‌سی اینجا خوانده نمی‌شوند؛ از آن اسکرین‌شات بگیرید یا جی‌پگ بفرستید.',
  ],
  [
    /^Only PNG, JPEG, WebP and GIF pictures/,
    () => 'فقط تصویرهای پی‌ان‌جی، جی‌پگ، وب‌پی و گیف پذیرفته می‌شود.',
  ],
  [/^The picture could not be read\.$/, () => 'این تصویر خوانده نشد؛ شاید فایل خراب است.'],
  [
    /^The picture has too many pixels\.$/,
    () => 'این تصویر بیش از اندازه بزرگ است؛ نسخهٔ کوچک‌تری بفرستید.',
  ],
  [/^A caption is text\.$/, () => 'توضیح تصویر باید متن باشد.'],
  [
    /^A caption is at most (\d+) characters\.$/,
    (m) => `توضیح تصویر حداکثر ${fa(m[1]!)} نویسه است.`,
  ],
  [/^Send the picture's own bytes/, () => 'فایل تصویر درست فرستاده نشد.'],
  [/^Send JSON\.$/, () => 'درخواست درست فرستاده نشد.'],
  [/^This upload is not from the console\.$/, () => 'این بارگذاری از صفحهٔ کنسول نیامده است.'],
  [
    /^That is the most pictures an hour allows/,
    () => 'به سقف تصویرهای یک ساعت رسیده‌اید؛ کمی بعد دوباره امتحان کنید.',
  ],
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
  'request.created': 'درخواست تازه',
  'request.edited': 'ویرایش درخواست',
  'request.cancelled': 'لغو درخواست',
  'request.reopened': 'بازگشایی درخواست',
  'request.execute_requested': 'علامت «اجرا شود»',
  'request.execute_withdrawn': 'برداشتن علامت اجرا',
  'request.asked': 'پرسش برای هم‌تیمی',
  'request.decided': 'تصمیم روی درخواست',
  'request.result': 'نتیجه‌ی درخواست',
  'request.image_added': 'افزودن تصویر به درخواست',
  'request.image_removed': 'حذف تصویر درخواست',
  'request.image_captioned': 'توضیح تصویر درخواست',
  'calendar.event_created': 'رویداد تازه در تقویم',
  'calendar.event_changed': 'ویرایش رویداد تقویم',
  'calendar.event_deleted': 'حذف رویداد تقویم',
  'calendar.subscription_added': 'اشتراک تازه',
  'calendar.subscription_changed': 'تغییر اشتراک',
  'calendar.reminders_on': 'روشن کردن یادآور در مرورگر',
  'calendar.reminders_off': 'خاموش کردن یادآور در مرورگر',
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
    [/^moved from (\S+), filed for (.+)$/, (m) => `آورده‌شده از ${m[1]} به نام ${m[2]}`],
    [/^moved from (.+)$/, (m) => `آورده‌شده از ${m[1]}`],
    [/^card changed$/, () => 'کارت تغییر کرد'],
    [/^card archived$/, () => 'کارت بایگانی شد'],
    [/^message to the agent$/, () => 'پیام به عامل'],
    [/^request added$/, () => 'درخواست ثبت شد'],
    [/^request edited$/, () => 'درخواست ویرایش شد'],
    [/^request cancelled$/, () => 'درخواست لغو شد'],
    [/^request reopened$/, () => 'درخواست بازگشایی شد'],
    [/^marked to run now$/, () => 'برای اجرا علامت خورد'],
    [/^run mark withdrawn$/, () => 'علامت اجرا برداشته شد'],
    [/^question put on the maintainer's word$/, () => 'پرسش به گفتهٔ نگهدارنده گذاشته شد'],
    [/^decision recorded$/, () => 'تصمیم ثبت شد'],
    [/^result written$/, () => 'نتیجه نوشته شد'],
    [/^picture added$/, () => 'تصویر اضافه شد'],
    [/^picture removed$/, () => 'تصویر حذف شد'],
    [/^picture caption changed$/, () => 'توضیح تصویر تغییر کرد'],
    [/^event added$/, () => 'رویداد اضافه شد'],
    [/^event edited$/, () => 'رویداد ویرایش شد'],
    [/^event deleted$/, () => 'رویداد حذف شد'],
    [/^import-calendar, filed for (.+)$/, (m) => `بارگذاری فهرست اشتراک‌ها به نام ${m[1]}`],
    [/^reminders switched on in a browser$/, () => 'یادآور در یک مرورگر روشن شد'],
    [/^reminders switched off in a browser$/, () => 'یادآور در یک مرورگر خاموش شد'],
  ];
  for (const [pattern, words] of system) {
    const match = pattern.exec(reason);
    if (match !== null) return words(match);
  }
  return reason;
}
