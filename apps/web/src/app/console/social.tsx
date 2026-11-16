import type { ReactNode } from 'react';
import type {
  SocialAutomation,
  SocialConsoleAuditRow,
  SocialConsolePost,
  SocialConsoleView,
  SocialPostKind,
  SocialPostState,
} from '@fmip/contracts';
import {
  approveSocial,
  clearSocialKey,
  editSocial,
  rejectSocial,
  setSocialKey,
  setSocialLevel,
  setSocialSwitch,
  settleSocial,
} from '@/lib/console-actions';
import { ConsoleForm } from './console-form';
import { Badge, Card, Stat, fa, inputClass, when } from './ui';
import { SOCIAL_GATE_WORDS, auditActionWords, auditReasonWords } from './words';

/**
 * The agents console's «شبکه‌های اجتماعی» tab (T-1836, D-427, the approved
 * design of 2026-11-15): the queue with each post's card and its English
 * captions inside `dir="ltr"`, approve, reject with a reason, a caption's
 * words, settling a post the network never answered for, the kill switch,
 * each kind's level and clean run, today's slots, the publisher's key
 * (write-only), the history and the trail. Server-rendered; the forms are
 * server actions. The owner's controls are drawn only for the owner, and the
 * API refuses them to anyone else whatever this page draws.
 */

export const SOCIAL_ELIGIBLE = 14;

export const KIND_WORDS: Record<SocialPostKind, string> = {
  forecast_pre_match: 'پیش‌بینی مدل پیش از بازی',
  model_verdict: 'بررسی مدل پس از بازی',
  result: 'نتیجه‌ی بازی',
};

export const STATE_WORDS: Record<SocialPostState, string> = {
  pending_approval: 'منتظر تأیید',
  approved: 'تأییدشده، در نوبت انتشار',
  publishing: 'در حال ارسال',
  published: 'منتشر شد',
  refused: 'ارسال نشد؛ در نوبت بعدی دوباره',
  unknown: 'بی‌پاسخ از شبکه',
  rejected: 'رد شد',
  expired: 'منقضی شد',
  superseded: 'جایگزین شد',
};

const STATE_TONE: Partial<Record<SocialPostState, string>> = {
  pending_approval: 'border-warning text-warning',
  approved: 'border-success text-success',
  published: 'border-success text-success',
  refused: 'border-danger text-danger',
  unknown: 'border-danger text-danger',
};

export const SENSITIVE_WORDS: Record<string, string> = {
  politics: 'سیاست',
  accident: 'حادثه یا بیماری ناگهانی',
  death: 'درگذشت',
  racism: 'نژادپرستی و تبعیض',
  violence: 'خشونت',
  betting: 'شرط‌بندی',
  headlines_unreadable: 'خبرها خوانده نشد',
};

export const LEVEL_WORDS = { approval: 'تأیید دستی', automatic: 'خودکار' } as const;

const NETWORK_LIMITS = { x: 280, instagram: 2200 } as const;

/** Why a post is rejected: the design's chips; the person's note follows. */
export const REJECT_REASONS = ['داده‌ی نادرست', 'متن یا لحن', 'بازی مهم نیست', 'تکراری', 'دیگر'];

const DANGER_BUTTON =
  'min-h-touch rounded-control border border-danger px-4 text-sm font-bold text-danger disabled:opacity-60';
const QUIET_BUTTON =
  'min-h-touch rounded-control border border-strong px-4 text-sm text-fg disabled:opacity-60';

/** The card's picture, from the post's frozen payload (T-1835): the same route Buffer fetches. */
export const cardSrc = (id: string): string => `/social-card/${id}/card.png`;

/** The match as the card names it, in English. */
export const matchName = (post: SocialConsolePost): string =>
  `${post.payload.home.name} v ${post.payload.away.name}`;

/** The match page's address the X caption carries, if it has one. */
export const linkIn = (body: string): string | null => /https?:\/\/\S+/.exec(body)?.[0] ?? null;

/** The networks' posts of one match and kind, one queue item. */
export interface QueueItem {
  key: string;
  kind: SocialPostKind;
  posts: SocialConsolePost[];
}

export function queueItems(queue: SocialConsolePost[]): QueueItem[] {
  const items = new Map<string, QueueItem>();
  for (const post of queue) {
    const key = `${post.fixture_id}:${post.kind}`;
    const item = items.get(key) ?? { key, kind: post.kind, posts: [] };
    item.posts.push(post);
    items.set(key, item);
  }
  return [...items.values()];
}

/** `n` of `total` as segments, the filled ones in the given colour. */
export function Meter({
  n,
  total,
  tone = 'bg-accent',
  label,
}: {
  n: number;
  total: number;
  tone?: string;
  label: string;
}) {
  return (
    <div role="img" aria-label={label} className="mt-2 flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-pill ${i < n ? tone : 'bg-canvas'}`}
          style={{ minInlineSize: '0.25rem' }}
        />
      ))}
    </div>
  );
}

const Ltr = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <bdi dir="ltr" lang="en" className={className === '' ? undefined : className}>
    {children}
  </bdi>
);

/** A system's English stays as data (inside `dir="ltr"`); a person's Persian reads as written. */
function Reason({ text }: { text: string }) {
  const words = auditReasonWords(text);
  return /[A-Za-z]{2,}/.test(words) ? <Ltr>{words}</Ltr> : <span>{words}</span>;
}

// --- The parts -----------------------------------------------------------------

export function SocialBanners({ view }: { view: SocialConsoleView }) {
  const { key } = view;
  return (
    <>
      {view.switch.stopped && (
        <div
          role="alert"
          className="rounded-card border-2 border-danger bg-surface p-4 text-sm text-danger"
        >
          <p className="font-bold">ارسال خودکار متوقف است؛ هیچ پستی منتشر نمی‌شود.</p>
          {view.switch.changed_at !== null && (
            <p className="mt-1 text-muted">
              <Ltr>{view.switch.changed_by ?? '—'}</Ltr> · {when(view.switch.changed_at)} · دلیل:{' '}
              {view.switch.reason === null ? '—' : <Reason text={view.switch.reason} />}
            </p>
          )}
        </div>
      )}
      {key.state === 'rejected' && (
        <div role="alert" className="rounded-card border-2 border-danger bg-surface p-4 text-sm">
          <p className="font-bold text-danger">
            Buffer کلید را نپذیرفت؛ کلید را دوباره وارد کنید. تا آن وقت چیزی منتشر نمی‌شود.
          </p>
        </div>
      )}
      {key.state === 'unreadable' && (
        <div role="alert" className="rounded-card border-2 border-danger bg-surface p-4 text-sm">
          <p className="font-bold text-danger">
            کلید ذخیره‌شده خوانده نمی‌شود؛ دوباره وارد کنید. تا آن وقت چیزی منتشر نمی‌شود.
          </p>
        </div>
      )}
    </>
  );
}

export function SwitchCard({ view }: { view: SocialConsoleView }) {
  const stopped = view.switch.stopped;
  return (
    <section
      className={`rounded-card bg-surface p-4 md:p-5 ${stopped ? 'border-2 border-danger' : 'border border-default'}`}
      aria-labelledby="social-switch"
    >
      <h2 id="social-switch" className="flex items-center gap-2 text-base font-bold">
        <span
          aria-hidden="true"
          className={`inline-block size-2.5 rounded-pill ${stopped ? 'bg-danger' : 'bg-success'}`}
        />
        ارسال خودکار: {stopped ? 'متوقف' : 'فعال'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        هر دو حساب کنسول می‌توانند ارسال را متوقف کنند یا از سر بگیرند؛ دلیل لازم است و در کارنامه
        می‌ماند. صف تأیید نگه داشته می‌شود.
      </p>
      <div className="mt-3">
        <ConsoleForm
          action={setSocialSwitch}
          submit={stopped ? 'از سرگیری ارسال' : 'توقف همه‌ی ارسال‌ها'}
          submitClassName={stopped ? undefined : DANGER_BUTTON}
          className="flex flex-col gap-2 md:flex-row md:items-end"
        >
          <input type="hidden" name="stop" value={stopped ? 'false' : 'true'} />
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-muted">دلیل</span>
            <input name="reason" required maxLength={500} className={inputClass} />
          </label>
        </ConsoleForm>
      </div>
    </section>
  );
}

export function Counters({ view, items }: { view: SocialConsoleView; items: QueueItem[] }) {
  const waiting = view.queue.filter((p) => p.state === 'pending_approval');
  const oldest = waiting[0]?.created_at ?? null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {view.today.networks.map((n) => (
        <div key={n.network} className="rounded-tile bg-surface-raised p-3">
          <div className="text-xs text-muted">
            پست‌های امروز در <Ltr>{n.network === 'x' ? 'X' : 'Instagram'}</Ltr> (روز لندن)
          </div>
          <div className="mt-1 text-xl font-bold">
            {fa(n.used)} از {fa(n.cap)}
          </div>
          <Meter
            n={n.used}
            total={n.cap}
            tone="bg-brand"
            label={`${fa(n.used)} از ${fa(n.cap)} نوبت امروز`}
          />
        </div>
      ))}
      <Stat
        label="منتظر تأیید"
        value={
          <span>
            {fa(items.filter((i) => i.posts.some((p) => p.state === 'pending_approval')).length)}
            <span className="ms-2 text-xs font-normal text-muted">
              {oldest === null ? 'صف خالی است' : `قدیمی‌ترین: ${when(oldest)}`}
            </span>
          </span>
        }
      />
    </div>
  );
}

export function HealthCard({ view }: { view: SocialConsoleView }) {
  const { health } = view;
  const keyWords = {
    set: 'تنظیم‌شده',
    not_set: 'تنظیم نشده',
    unreadable: 'خوانده نمی‌شود',
    rejected: 'رد شده از سوی Buffer',
  }[health.key];
  return (
    <Card title="وضعیت ارسال">
      <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        <li>
          کلید:{' '}
          <span className={health.key === 'set' ? 'text-success' : 'text-danger'}>{keyWords}</span>
        </li>
        <li>
          کار زمان‌بندی‌شده روی این سرور: {health.scheduled ? 'روشن (هر پنج دقیقه)' : 'خاموش'}
        </li>
        {health.paused_until !== null && (
          <li className="text-warning">Buffer خواسته تا {when(health.paused_until)} صبر کنیم.</li>
        )}
        {health.networks.map((n) => (
          <li key={n.network}>
            <Ltr>{n.network === 'x' ? 'X' : 'Instagram'}</Ltr>: آخرین انتشار{' '}
            {when(n.last_published_at)}
            {n.last_attempt !== null &&
              ` · آخرین تلاش ${when(n.last_attempt.at)} (${STATE_WORDS[n.last_attempt.state]})`}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-caption">خوانده‌شده در {when(health.checked_at)}</p>
    </Card>
  );
}

function PostCaption({ post }: { post: SocialConsolePost }) {
  const count = [...post.body].length;
  const limit = NETWORK_LIMITS[post.network];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge>
          <Ltr>{post.network === 'x' ? 'X' : 'Instagram'}</Ltr>
        </Badge>
        <Badge tone={STATE_TONE[post.state] ?? 'border-default text-muted'}>
          {STATE_WORDS[post.state]}
        </Badge>
        <span className="text-caption">
          {fa(count)} از {fa(limit)} نویسه
        </span>
        {post.edited_from !== null && <Badge>متن ویرایش‌شده</Badge>}
      </div>
      <pre
        dir="ltr"
        lang="en"
        className="overflow-x-auto whitespace-pre-wrap break-words rounded-tile bg-canvas p-3 text-start font-sans text-sm text-fg"
      >
        {post.body}
      </pre>
      {post.approved_by !== null && (
        <p className="text-xs text-muted">
          تأیید: {post.approved_by === 'automation' ? 'خودکار' : <Ltr>{post.approved_by}</Ltr>} ·{' '}
          {when(post.approved_at)}
        </p>
      )}
      {post.last_error !== null && (
        <p className="text-xs text-danger">
          خطای آخر: <Ltr>{post.last_error}</Ltr>
        </p>
      )}
    </div>
  );
}

function EditCaption({ post }: { post: SocialConsolePost }) {
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-touch cursor-pointer items-center gap-1 text-muted">
        ویرایش متن <Ltr>{post.network === 'x' ? 'X' : 'Instagram'}</Ltr>
      </summary>
      <ConsoleForm
        action={editSocial}
        submit="ذخیره‌ی متن تازه"
        className="mt-2 flex flex-col gap-2"
      >
        <input type="hidden" name="id" value={post.id} />
        <p className="text-xs text-muted">
          فقط کلمه‌ها عوض می‌شوند؛ خط‌هایی که عدد، نام تیم، نام مدل، نتیجه‌ی بررسی یا پیوند دارند
          ثابت می‌مانند. پست ویرایش‌شده دوباره منتظر تأیید می‌ماند و رشته‌ی پست‌های پاک صفر می‌شود.
        </p>
        <textarea
          name="body"
          dir="ltr"
          lang="en"
          rows={6}
          defaultValue={post.body}
          aria-label="متن تازه"
          className={`${inputClass} py-2`}
        />
        <label className="flex flex-col gap-1">
          <span className="text-muted">دلیل ویرایش</span>
          <input name="reason" required maxLength={500} className={inputClass} />
        </label>
      </ConsoleForm>
    </details>
  );
}

function SettleForm({ post }: { post: SocialConsolePost }) {
  return (
    <ConsoleForm action={settleSocial} submit="ثبت وضعیت" className="flex flex-col gap-2 text-sm">
      <input type="hidden" name="id" value={post.id} />
      <p className="text-xs text-muted">
        شبکه پاسخی نداد؛ در صفحه‌ی Buffer ببینید منتشر شده یا نه و همین‌جا ثبت کنید. کار
        زمان‌بندی‌شده این پست را دوباره نمی‌فرستد.
      </p>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">وضعیت در Buffer</legend>
        <label className="inline-flex min-h-touch items-center gap-2">
          <input type="radio" name="state" value="published" required /> منتشر شد
        </label>
        <label className="inline-flex min-h-touch items-center gap-2">
          <input type="radio" name="state" value="refused" /> منتشر نشد
        </label>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-muted">شناسه‌ی پست در Buffer (اگر منتشر شد)</span>
        <input name="reference" dir="ltr" maxLength={200} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">دلیل</span>
        <input name="reason" required maxLength={500} className={inputClass} />
      </label>
    </ConsoleForm>
  );
}

export function QueueItemCard({ item, stopped }: { item: QueueItem; stopped: boolean }) {
  const first = item.posts[0]!;
  const waiting = item.posts.filter((p) => p.state === 'pending_approval');
  const isModel = item.kind !== 'result';
  const sensitive = item.posts.find((p) => p.sensitive !== null)?.sensitive ?? null;
  const failed = [...new Set(item.posts.flatMap((p) => p.failed_gates))];
  const networkBoxes = waiting.map((p) => (
    <label key={p.id} className="inline-flex min-h-touch items-center gap-2 text-sm">
      <input type="checkbox" name="id" value={p.id} defaultChecked />
      <Ltr>{p.network === 'x' ? 'X' : 'Instagram'}</Ltr>
    </label>
  ));
  return (
    <li className="flex flex-col gap-4 rounded-card border border-default bg-surface p-4 md:flex-row">
      <div className="shrink-0" style={{ inlineSize: 'min(100%, 216px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the card as published, drawn from the frozen post (T-1835), not an optimisable asset */}
        <img
          src={cardSrc(first.id)}
          alt={`کارت ${KIND_WORDS[item.kind]}`}
          width={216}
          height={270}
          loading="lazy"
          className="block h-auto w-full rounded-tile border border-default bg-canvas"
          style={{ aspectRatio: '4 / 5' }}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isModel ? 'border-model text-model' : 'border-default text-muted'}>
            {KIND_WORDS[item.kind]}
          </Badge>
          {sensitive !== null && (
            <Badge tone="border-danger text-danger">
              موضوع حساس: {SENSITIVE_WORDS[sensitive] ?? sensitive}
            </Badge>
          )}
          {item.kind === 'forecast_pre_match' && (
            <Badge tone="border-warning text-warning">باید پیش از شروع بازی منتشر شود</Badge>
          )}
        </div>
        <div>
          <p className="text-base font-bold">
            <Ltr>{matchName(first)}</Ltr>
          </p>
          <p className="text-xs text-muted">
            <Ltr>{first.payload.competition.name}</Ltr> · شروع {when(first.payload.kick_off)} ·
            پیش‌نویس {when(first.created_at)} · اعتبار تا {when(first.expires_at)}
          </p>
          {failed.length > 0 && (
            <p className="mt-1 text-xs text-danger">
              شرط‌هایی که در آخرین بررسی برقرار نبود:{' '}
              {failed.map((g) => SOCIAL_GATE_WORDS[g] ?? g).join('، ')}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {item.posts.map((post) => (
            <div key={post.id} className="flex min-w-0 flex-col gap-2">
              <PostCaption post={post} />
              {post.state === 'pending_approval' && <EditCaption post={post} />}
              {post.state === 'unknown' && <SettleForm post={post} />}
            </div>
          ))}
        </div>
        {waiting.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-default pt-3">
            {stopped ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled className={QUIET_BUTTON}>
                  تأیید و ارسال به Buffer
                </button>
                <span className="text-xs text-muted">
                  تا ارسال از سر گرفته نشود تأیید خاموش است.
                </span>
              </div>
            ) : (
              <ConsoleForm
                action={approveSocial}
                submit="تأیید و ارسال به Buffer"
                className="flex flex-col gap-2"
              >
                <fieldset className="flex flex-wrap gap-4">
                  <legend className="sr-only">شبکه‌ها برای تأیید</legend>
                  {networkBoxes}
                </fieldset>
              </ConsoleForm>
            )}
            <details>
              <summary className="inline-flex min-h-touch cursor-pointer items-center text-sm text-danger">
                رد با دلیل
              </summary>
              <ConsoleForm
                action={rejectSocial}
                submit="رد کردن"
                submitClassName={DANGER_BUTTON}
                className="mt-2 flex flex-col gap-2 text-sm"
              >
                <fieldset className="flex flex-wrap gap-4">
                  <legend className="sr-only">شبکه‌ها برای رد</legend>
                  {networkBoxes}
                </fieldset>
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-1 text-muted">چرا؟</legend>
                  {REJECT_REASONS.map((why, i) => (
                    <label
                      key={why}
                      className="inline-flex min-h-touch items-center gap-1.5 rounded-pill border border-default px-3"
                    >
                      <input type="radio" name="why" value={why} defaultChecked={i === 0} /> {why}
                    </label>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1">
                  <span className="text-muted">توضیح (لازم)</span>
                  <input name="note" required maxLength={400} className={inputClass} />
                </label>
              </ConsoleForm>
            </details>
          </div>
        )}
      </div>
    </li>
  );
}

export function LevelRow({
  auto,
  owner,
  stopped,
}: {
  auto: SocialAutomation;
  owner: boolean;
  stopped: boolean;
}) {
  const run = Math.min(auto.clean_run, SOCIAL_ELIGIBLE);
  const canRaise = auto.eligible && !stopped;
  return (
    <li className="flex flex-col gap-2 border-b border-default py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{KIND_WORDS[auto.kind]}</span>
        <Badge tone={auto.level === 'automatic' ? 'border-model text-model' : undefined}>
          {LEVEL_WORDS[auto.level]}
        </Badge>
        {auto.eligible && auto.level === 'approval' && (
          <Badge tone="border-success text-success">آماده‌ی خودکار شدن (۱۴ پست پاک)</Badge>
        )}
      </div>
      <div className="text-sm">
        پست پاک پشت‌سرهم: {fa(auto.clean_run)} از {fa(SOCIAL_ELIGIBLE)}
        <Meter
          n={run}
          total={SOCIAL_ELIGIBLE}
          label={`${fa(auto.clean_run)} از ${fa(SOCIAL_ELIGIBLE)} پست پاک`}
        />
      </div>
      {auto.level_changed_at !== null && (
        <p className="text-xs text-muted">
          آخرین تغییر: <Ltr>{auto.level_changed_by ?? '—'}</Ltr> · {when(auto.level_changed_at)}
        </p>
      )}
      {owner ? (
        <ConsoleForm
          action={setSocialLevel}
          submit="ثبت سطح"
          className="flex flex-col gap-2 text-sm md:flex-row md:items-end"
        >
          <input type="hidden" name="kind" value={auto.kind} />
          <fieldset className="flex flex-wrap gap-4">
            <legend className="sr-only">سطح خودکارسازی</legend>
            <label className="inline-flex min-h-touch items-center gap-2">
              <input
                type="radio"
                name="level"
                value="approval"
                defaultChecked={auto.level === 'approval'}
              />{' '}
              {LEVEL_WORDS.approval}
            </label>
            <label className="inline-flex min-h-touch items-center gap-2">
              <input
                type="radio"
                name="level"
                value="automatic"
                defaultChecked={auto.level === 'automatic'}
                disabled={auto.level !== 'automatic' && !canRaise}
              />{' '}
              {LEVEL_WORDS.automatic}
            </label>
          </fieldset>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-muted">دلیل</span>
            <input name="reason" required maxLength={500} className={inputClass} />
          </label>
        </ConsoleForm>
      ) : null}
      {owner && auto.level === 'approval' && !canRaise && (
        <p className="text-xs text-caption">
          {stopped
            ? 'تا ارسال متوقف است خودکار کردن ممکن نیست.'
            : `خودکار کردن پس از ${fa(SOCIAL_ELIGIBLE)} پست پاک پشت‌سرهم باز می‌شود.`}
        </p>
      )}
    </li>
  );
}

export function KeyCard({ view }: { view: SocialConsoleView }) {
  const { key } = view;
  const status =
    key.state === 'not_set' ? (
      'تنظیم نشده است؛ تا کلیدی وارد نشود چیزی منتشر نمی‌شود.'
    ) : (
      <>
        تنظیم‌شده در {when(key.set_at)} توسط <Ltr>{key.set_by}</Ltr>
        {key.state === 'unreadable'
          ? ' — خوانده نمی‌شود؛ دوباره وارد کنید.'
          : key.state === 'rejected'
            ? ' — Buffer آن را نپذیرفت؛ دوباره وارد کنید.'
            : ''}
      </>
    );
  return (
    <Card title="کلید Buffer">
      <p className="text-sm" data-testid="social-key-status">
        {status}
      </p>
      <p className="mt-1 text-xs text-caption">
        کلید رمزشده نگه داشته می‌شود و هیچ‌جا نشان داده یا برگردانده نمی‌شود.
      </p>
      {/* Either console person enters or clears it (the maintainer, 2026-11-16). */}
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ConsoleForm
          action={setSocialKey}
          submit={key.state === 'not_set' ? 'ذخیره‌ی کلید' : 'جایگزینی کلید'}
          className="flex flex-col gap-2 text-sm"
        >
          <label className="flex flex-col gap-1">
            <span className="text-muted">کلید تازه</span>
            <input
              type="password"
              name="key"
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={1024}
              dir="ltr"
              className={inputClass}
            />
          </label>
        </ConsoleForm>
        {key.state !== 'not_set' && (
          <ConsoleForm
            action={clearSocialKey}
            submit="پاک کردن کلید"
            submitClassName={DANGER_BUTTON}
            className="flex flex-col gap-2 text-sm"
          >
            <label className="flex flex-col gap-1">
              <span className="text-muted">دلیل پاک کردن</span>
              <input name="reason" required maxLength={500} className={inputClass} />
            </label>
          </ConsoleForm>
        )}
      </div>
    </Card>
  );
}

function HistoryLinks({ post }: { post: SocialConsolePost }) {
  const link = linkIn(post.body);
  return (
    <span className="flex flex-wrap gap-3">
      {post.state === 'published' && (
        <a
          href={cardSrc(post.id)}
          className="text-brand underline"
          target="_blank"
          rel="noreferrer"
        >
          کارت
        </a>
      )}
      {link !== null && (
        <a href={link} className="text-brand underline" target="_blank" rel="noreferrer">
          صفحه‌ی بازی
        </a>
      )}
    </span>
  );
}

const historyTime = (post: SocialConsolePost) =>
  post.published_at ?? post.decided_at ?? post.updated_at;

export function HistoryCard({ history }: { history: SocialConsolePost[] }) {
  return (
    <Card title="تاریخچه‌ی انتشار">
      {history.length === 0 ? (
        <p className="text-sm text-muted">هنوز پستی منتشر، رد یا منقضی نشده است.</p>
      ) : (
        <>
          <table className="hidden w-full text-start text-sm md:table">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 text-start font-normal">زمان</th>
                <th className="py-2 text-start font-normal">نوع</th>
                <th className="py-2 text-start font-normal">بازی</th>
                <th className="py-2 text-start font-normal">شبکه</th>
                <th className="py-2 text-start font-normal">وضعیت</th>
                <th className="py-2 text-start font-normal">پیوند</th>
              </tr>
            </thead>
            <tbody>
              {history.map((post) => (
                <tr key={post.id} className="border-t border-default align-top">
                  <td className="py-2 pe-3 whitespace-nowrap text-muted">
                    {when(historyTime(post))}
                  </td>
                  <td className="py-2 pe-3">{KIND_WORDS[post.kind]}</td>
                  <td className="py-2 pe-3">
                    <Ltr>{matchName(post)}</Ltr>
                  </td>
                  <td className="py-2 pe-3">
                    <Ltr>{post.network === 'x' ? 'X' : 'Instagram'}</Ltr>
                  </td>
                  <td className="py-2 pe-3">
                    {STATE_WORDS[post.state]}
                    {post.decided_reason !== null && (
                      <span className="block text-xs text-muted">
                        <Reason text={post.decided_reason} />
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <HistoryLinks post={post} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col md:hidden">
            {history.map((post) => (
              <li key={post.id} className="border-t border-default py-3 text-sm first:border-t-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATE_TONE[post.state] ?? undefined}>
                    {STATE_WORDS[post.state]}
                  </Badge>
                  <span className="text-xs text-muted">{when(historyTime(post))}</span>
                </div>
                <p className="mt-1 font-bold">
                  <Ltr>{matchName(post)}</Ltr>
                </p>
                <p className="text-xs text-muted">
                  {KIND_WORDS[post.kind]} · <Ltr>{post.network === 'x' ? 'X' : 'Instagram'}</Ltr>
                </p>
                {post.decided_reason !== null && (
                  <p className="text-xs text-muted">
                    <Reason text={post.decided_reason} />
                  </p>
                )}
                <div className="mt-1">
                  <HistoryLinks post={post} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

const previousText = (previous: SocialConsoleAuditRow['previous']): string =>
  previous === null
    ? '—'
    : Object.entries(previous)
        .map(([k, v]) => `${k}: ${v === null ? '—' : String(v)}`)
        .join(' · ') || '—';

export function SocialAuditCard({ rows }: { rows: SocialConsoleAuditRow[] }) {
  return (
    <Card title="کارنامه‌ی شبکه‌های اجتماعی">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">هنوز کاری ثبت نشده.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row, i) => {
            const action = auditActionWords(row.action);
            return (
              <li
                key={`${row.at}-${i}`}
                className="grid grid-cols-1 gap-1 border-t border-default py-2 text-sm first:border-t-0 md:grid-cols-[10rem_8rem_1fr]"
              >
                <span className="text-muted">{when(row.at)}</span>
                <span>{row.actor === 'automation' ? 'خودکار' : <Ltr>{row.actor}</Ltr>}</span>
                <span className="min-w-0">
                  <span className="font-bold">
                    {action.known ? action.words : <Ltr>{row.action}</Ltr>}
                  </span>
                  {' · '}
                  <Reason text={row.reason} />
                  <span className="block text-xs text-caption">
                    مقدار قبلی: <Ltr className="break-all">{previousText(row.previous)}</Ltr>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The whole tab, in the design's order (phone: the same, one column). */
export function SocialTab({ view }: { view: SocialConsoleView }) {
  const items = queueItems(view.queue);
  const stopped = view.switch.stopped;
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">شبکه‌های اجتماعی</h1>
        <p className="max-w-measure text-sm text-muted">
          پست‌های X و Instagram از داده‌ی خود سایت ساخته می‌شوند و تا وقتی نوعشان خودکار نشده، هر
          پست اینجا منتظر تأیید یکی از دو حساب کنسول می‌ماند. متن پست‌ها انگلیسی است. هر شبکه حداکثر
          پنج پست در روز لندن دارد.
        </p>
      </div>
      <SocialBanners view={view} />
      <SwitchCard view={view} />
      <Counters view={view} items={items} />
      <Card title="صف تأیید">
        {items.length === 0 ? (
          <p className="text-sm text-muted">صف خالی است.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {items.map((item) => (
              <QueueItemCard key={item.key} item={item} stopped={stopped} />
            ))}
          </ul>
        )}
      </Card>
      <Card title="سطح خودکارسازی هر نوع">
        <p className="text-sm text-muted">
          هر نوع پس از ۱۴ پست پاک پشت‌سرهم (بی‌ویرایش، بی‌رد و بی‌خطای ارسال) آماده‌ی خودکار شدن
          می‌شود؛ خودکار کردن و برگرداندن فقط با مالک کنسول است. پست حساس هرگز خودکار نمی‌رود.
        </p>
        <ul className="mt-2">
          {view.automation.map((auto) => (
            <LevelRow key={auto.kind} auto={auto} owner={view.viewer.owner} stopped={stopped} />
          ))}
        </ul>
      </Card>
      <KeyCard view={view} />
      <HealthCard view={view} />
      <HistoryCard history={view.history} />
      <SocialAuditCard rows={view.audit} />
    </>
  );
}
