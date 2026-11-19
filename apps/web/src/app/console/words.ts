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
  // The pre-launch checklist (T-1840, D-428).
  [/^An item needs its text\.$/, () => 'متن مورد را بنویسید.'],
  [
    /^An item's text is at most (\d+) characters\.$/,
    (m) => `متن مورد حداکثر ${fa(m[1]!)} نویسه است.`,
  ],
  [/^A note needs its text\.$/, () => 'متن یادداشت را بنویسید.'],
  [/^A note is at most (\d+) characters\.$/, (m) => `یادداشت حداکثر ${fa(m[1]!)} نویسه است.`],
  [/^Say why the item is removed\.$/, () => 'دلیل حذف را بنویسید.'],
  [/^A reason is at most (\d+) characters\.$/, (m) => `دلیل حداکثر ${fa(m[1]!)} نویسه است.`],
  [/^No such console account\.$/, () => 'این حساب در کنسول نیست یا غیرفعال شده است.'],
  [/^No such checklist item\.$/, () => 'این مورد دیگر در فهرست نیست؛ صفحه را تازه کنید.'],
  [/^No such (checklist )?section\.$/, () => 'این بخش در فهرست نیست.'],
  [
    /^That is the most checklist changes an hour allows/,
    () => 'به سقف تغییرهای یک ساعت فهرست رسیده‌اید؛ کمی بعد دوباره امتحان کنید.',
  ],
  // The business model canvas (T-1856, D-441).
  [
    /^A card needs its text in Persian or English\.$/,
    () => 'متن کارت را دست‌کم به یکی از دو زبان بنویسید.',
  ],
  [
    /^A card's (Persian|English) (text|note) is at most (\d+) characters\.$/,
    (m) =>
      `${m[2] === 'text' ? 'متن' : 'یادداشت'} ${m[1] === 'Persian' ? 'فارسی' : 'انگلیسی'} کارت حداکثر ${fa(m[3]!)} نویسه است.`,
  ],
  [
    /^A card's source is at most (\d+) characters\.$/,
    (m) => `منبع کارت حداکثر ${fa(m[1]!)} نویسه است.`,
  ],
  [/^No such canvas card\.$/, () => 'این کارت دیگر روی بوم نیست؛ صفحه را تازه کنید.'],
  [/^That card is on the canvas, not in the bin\.$/, () => 'این کارت روی بوم است، نه در سطل.'],
  [
    /^That is the most canvas changes an hour allows/,
    () => 'به سقف تغییرهای یک ساعت بوم رسیده‌اید؛ کمی بعد دوباره امتحان کنید.',
  ],
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
  // T-1880: the commands' limits, and the push service a browser may name.
  [
    /^A command carries up to (\d+) values of (\d+) characters\.$/,
    (m) => `هر دستور حداکثر ${fa(m[1]!)} مقدار دارد و هر مقدار تا ${fa(m[2]!)} نویسه است.`,
  ],
  [
    /^That is the most commands an hour allows/,
    () => 'به سقف دستورهای یک ساعت رسیده‌اید؛ کمی بعد دوباره امتحان کنید.',
  ],
  [
    /^That is the most immediate runs an hour allows/,
    () => 'به سقف اجراهای فوری یک ساعت رسیده‌اید؛ کمی بعد دوباره امتحان کنید.',
  ],
  [
    /^This agent already has a run waiting\.$/,
    () =>
      'برای این عامل یک اجرای فوری در صف است؛ تا رایانه آن را برندارد، اجرای دیگری ثبت نمی‌شود.',
  ],
  [
    /^That is the most test messages an hour allows/,
    () => 'به سقف پیام‌های آزمایشی یک ساعت رسیده‌اید؛ کمی بعد دوباره امتحان کنید.',
  ],
  [
    /^endpoint is the https:\/\/ address of a browser's push service\.$/,
    () =>
      'نشانی اعلانی که این مرورگر داد از سرویس‌های اعلان شناخته‌شده نیست؛ یادآور روی این مرورگر روشن نشد.',
  ],
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
  // The social tab (T-1836): `social-console.controller.ts`.
  [/^No such post\.$/, () => 'چنین پستی نیست.'],
  [/^No such kind\.$/, () => 'چنین نوع پستی نیست.'],
  [/^This post is not waiting for approval\.$/, () => 'این پست دیگر منتظر تأیید نیست.'],
  [
    /^A gate fails now: (.*)\.$/,
    (m) =>
      `این پست اکنون از شرط‌ها نمی‌گذرد: ${m[1]!
        .split(/,\s*/)
        .filter((g) => g !== '')
        .map((g) => SOCIAL_GATE_WORDS[g] ?? g)
        .join('، ')}.`,
  ],
  [/^Give a reason\.$/, () => 'دلیل را بنویسید.'],
  [/^A reason is at most (\d+) characters\.$/, (m) => `دلیل حداکثر ${fa(m[1]!)} نویسه است.`],
  [
    /^Only a post with no answer from the network is settled\.$/,
    () => 'فقط پستی که شبکه به آن پاسخی نداده تعیین وضعیت می‌شود.',
  ],
  [/^Choose published or refused\.$/, () => '«منتشر شد» یا «منتشر نشد» را انتخاب کنید.'],
  [/^Give the reference of the published post\.$/, () => 'شناسه‌ی پست منتشرشده را بنویسید.'],
  [/^That reference is too long\.$/, () => 'این شناسه خیلی بلند است.'],
  [/^It is already so\.$/, () => 'همین حالا هم همین‌طور است.'],
  [/^stop is true or false\.$/, () => 'فرمان توقف درست فرستاده نشد.'],
  [
    /^Only the console owner changes a level\.$/,
    () => 'فقط مالک کنسول سطح خودکارسازی را عوض می‌کند.',
  ],
  [/^A level is approval or automatic\.$/, () => 'سطح باید «تأیید دستی» یا «خودکار» باشد.'],
  [
    /^A kind is raised only after 14 clean posts in a row\.$/,
    () => 'این نوع فقط پس از ۱۴ پست پاک پشت‌سرهم خودکار می‌شود.',
  ],
  [
    /^Publishing is stopped; resume it before raising a level\.$/,
    () => 'ارسال متوقف است؛ پیش از خودکار کردن، ارسال را از سر بگیرید.',
  ],
  [/^Give this change a reason of its own\.$/, () => 'برای این تغییر دلیل تازه‌ای بنویسید.'],
  [/^Write the caption\.$/, () => 'متن پست را بنویسید.'],
  [/^The caption is too long for its network\.$/, () => 'متن برای این شبکه بلند است.'],
  [
    /^Only the words may change/,
    () => 'فقط کلمه‌ها عوض می‌شوند؛ عدد، نام تیم، مدل، نتیجه‌ی بررسی و پیوند ثابت می‌مانند.',
  ],
  [
    /^A caption names no other prediction\.$/,
    () => 'متن پست پیش‌بینی دیگری جز مدل را نام نمی‌برد.',
  ],
  [/^The caption touches a sensitive topic\.$/, () => 'متن پست به موضوع حساسی می‌پردازد.'],
  [/^That is not a key/, () => 'این کلید درست نیست: بدون فاصله و حداکثر ۱۰۲۴ نویسه.'],
  [
    /^The server cannot seal a key/,
    () => 'سرور نمی‌تواند کلید را رمز کند (رمز نشست تنظیم نشده است).',
  ],
  [/^No key is set\.$/, () => 'کلیدی تنظیم نشده است.'],
  [
    /^Only the console owner sets or clears the publisher key\.$/,
    () => 'فقط مالک کنسول کلید Buffer را وارد یا پاک می‌کند.',
  ],
];

/** The social posts' gates (D-427 point 3), as an approval's refusal names them. */
export const SOCIAL_GATE_WORDS: Record<string, string> = {
  fixture_status: 'وضعیت بازی',
  coverage: 'پوشش داده',
  freshness: 'تازگی داده',
  score_dispute: 'اختلاف در نتیجه',
  forecast_shown: 'پیش‌بینی نمایش‌داده‌شده عوض شده',
  evaluation_stored: 'ارزیابی ذخیره‌شده',
  one_product: 'یک محصول در هر پست',
};

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
  'calendar.push_test': 'پیام آزمایشی یادآور',
  'calendar.reminders_off': 'خاموش کردن یادآور در مرورگر',
  'requests.alerts_on': 'روشن کردن اعلان درخواست‌های تازه',
  'requests.alerts_off': 'خاموش کردن اعلان درخواست‌های تازه',
  // The social posts (T-1836, D-427): a person's actions and the job's own.
  'social.approve': 'تأیید پست',
  'social.reject': 'رد پست',
  'social.edit': 'ویرایش متن پست',
  'social.settle': 'تعیین وضعیت پست بی‌پاسخ',
  'social.kill': 'کلید توقف ارسال',
  'social.level': 'تغییر سطح خودکارسازی',
  'social.credential': 'کلید Buffer',
  'social.claim': 'گرفتن نوبت انتشار',
  'social.finish': 'پاسخ شبکه',
  'social.expire': 'منقضی شدن پست',
  'social.supersede': 'جایگزینی پست',
  'social.withdraw': 'پس گرفتن تأیید',
  'social.sensitive': 'علامت موضوع حساس',
  'console.owner_set': 'تعیین مالک کنسول',
  'checklist.item_created': 'مورد تازه در فهرست راه‌اندازی',
  'checklist.item_changed': 'تغییر مورد فهرست راه‌اندازی',
  'checklist.item_moved': 'جابه‌جایی مورد فهرست راه‌اندازی',
  'checklist.item_removed': 'حذف مورد از فهرست راه‌اندازی',
  'checklist.note_added': 'یادداشت روی مورد فهرست راه‌اندازی',
  'canvas.card_created': 'کارت تازه در بوم کسب‌وکار',
  'canvas.card_changed': 'تغییر کارت بوم کسب‌وکار',
  'canvas.card_moved': 'جابه‌جایی کارت بوم کسب‌وکار',
  'canvas.card_removed': 'حذف کارت از بوم کسب‌وکار',
  'canvas.card_restored': 'بازگرداندن کارت به بوم کسب‌وکار',
};

/** An audit row's action in Persian (`command.agent_pause` from `COMMAND_WORDS`); an unknown one keeps its id. */
export function auditActionWords(action: string): { words: string; known: boolean } {
  const command = /^command\.(.+)$/.exec(action)?.[1]?.replace('_', '.');
  const words =
    AUDIT_ACTIONS[action] ??
    (command !== undefined ? COMMAND_WORDS[command as ConsoleCommandKind] : undefined);
  return words === undefined ? { words: action, known: false } : { words, known: true };
}

/** A checklist change's fields (T-1840), as `changed status, assigned` names them. */
const CHANGE_WORDS: Record<string, string> = {
  retitled: 'متن',
  sectioned: 'بخش',
  status: 'وضعیت',
  assigned: 'مسئول',
};

/** A canvas card's fields (T-1856), as `changed tag, text_en` names them. */
const CANVAS_FIELD_WORDS: Record<string, string> = {
  block: 'بخش',
  tag: 'برچسب',
  text_fa: 'متن فارسی',
  text_en: 'متن انگلیسی',
  note_fa: 'یادداشت فارسی',
  note_en: 'یادداشت انگلیسی',
  source: 'منبع',
};

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
    [/^test message asked$/, () => 'پیام آزمایشی خواسته شد'],
    [/^reminders switched off in a browser$/, () => 'یادآور در یک مرورگر خاموش شد'],
    [/^new-request notifications switched on$/, () => 'اعلان درخواست‌های تازه روشن شد'],
    [/^new-request notifications switched off$/, () => 'اعلان درخواست‌های تازه خاموش شد'],
    // The social posts (T-1836): the reasons the store and the job write.
    [/^approved by a person, its gates passing$/, () => 'با تأیید یک نفر، شرط‌ها برقرار'],
    [/^the publisher key was entered$/, () => 'کلید وارد شد'],
    [/^became sensitive after approval$/, () => 'پس از تأیید حساس شد'],
    [/^its validity ended$/, () => 'زمان اعتبارش گذشت'],
    [/^publishing was stopped$/, () => 'ارسال متوقف شد'],
    [/^edited: (.+)$/, (m) => `ویرایش شد: ${m[1]}`],
    [/^\w+ is automatic: a clean template post$/, () => 'این نوع خودکار است؛ پست قالبی پاک'],
    [/^claimed slot (\d) of ([\d-]+)$/, (m) => `نوبت ${fa(m[1]!)} از روز ${m[2]}`],
    [/^item added$/, () => 'مورد اضافه شد'],
    [
      // Only the API's own list of fields; a person's own reason is shown as written.
      /^changed ((?:retitled|sectioned|status|assigned)(?:, (?:retitled|sectioned|status|assigned))*)$/,
      (m) =>
        `تغییر ${m[1]!
          .split(', ')
          .map((k) => CHANGE_WORDS[k] ?? k)
          .join('، ')}`,
    ],
    [/^moved up$/, () => 'یک جا بالاتر رفت'],
    [/^moved down$/, () => 'یک جا پایین‌تر رفت'],
    [/^note added$/, () => 'یادداشت اضافه شد'],
    [/^card added$/, () => 'کارت اضافه شد'],
    [/^card removed$/, () => 'کارت به سطل رفت'],
    [/^card restored$/, () => 'کارت از سطل برگشت'],
    [
      // Only the API's own list of fields; a person's own reason is shown as written.
      /^changed ((?:block|tag|text_fa|text_en|note_fa|note_en|source)(?:, (?:block|tag|text_fa|text_en|note_fa|note_en|source))*)$/,
      (m) =>
        `تغییر ${m[1]!
          .split(', ')
          .map((k) => CANVAS_FIELD_WORDS[k] ?? k)
          .join('، ')}`,
    ],
  ];
  for (const [pattern, words] of system) {
    const match = pattern.exec(reason);
    if (match !== null) return words(match);
  }
  return reason;
}
