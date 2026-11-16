import type { Metadata } from 'next';
import type {
  ConsoleChecklistItem,
  ConsoleChecklistList,
  ConsoleChecklistStatus,
} from '@fmip/contracts';
import { CONSOLE_CHECKLIST_LISTS, CONSOLE_CHECKLIST_STATUSES } from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleChecklist } from '@/lib/console-api';
import { ProgressBar, ProgressWords, SectionCard } from '../../checklist';
import {
  AGENTS_WORDS,
  LIST_WORDS,
  NOBODY_WORDS,
  STATUS_TONE,
  STATUS_WORDS,
  progressOf,
  whoKey,
} from '../../checklist-words';
import { Card, fa } from '../../ui';

export const metadata: Metadata = { title: 'فهرست راه‌اندازی' };

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ tab?: Param; who?: Param; status?: Param }> };

const one = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const CHIP = `inline-flex min-h-touch items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-sm ${FOCUS}`;
const CHIP_ON = 'border-accent bg-surface-raised font-bold text-fg';
const CHIP_OFF = 'border-default bg-surface text-muted hover:text-fg';

/**
 * The pre-launch checklist (T-1840, D-428): two tabs, the family-and-friends
 * launch and the public launch, each in its sections; in front of every
 * item its status, who must do it, and its notes and history behind a
 * toggle. Progress per tab and per section; filters by who (`?who=`: a
 * username, `agents`, `none`) and by status (`?status=`), kept in the
 * address with the tab (`?tab=`). Server-rendered; the item's controls are
 * the one client part (`checklist-item.tsx`).
 */
export default async function ConsoleChecklistPage({ searchParams }: Props) {
  const params = await searchParams;
  const rawTab = one(params.tab);
  const tab: ConsoleChecklistList = (CONSOLE_CHECKLIST_LISTS as readonly unknown[]).includes(rawTab)
    ? (rawTab as ConsoleChecklistList)
    : 'friends';
  const rawStatus = one(params.status);
  const status = (CONSOLE_CHECKLIST_STATUSES as readonly unknown[]).includes(rawStatus)
    ? (rawStatus as ConsoleChecklistStatus)
    : undefined;
  const rawWho = one(params.who);

  const result = await consoleChecklist();
  if (!result.ok) {
    return (
      <>
        <h1 className="text-xl font-bold">فهرست بررسی پیش از راه‌اندازی</h1>
        <p className="text-sm text-danger" role="alert">
          فهرست خوانده نشد. کمی بعد دوباره امتحان کنید.
        </p>
      </>
    );
  }
  const { sections, people } = result.data;
  const whoOptions = [
    ...people.map((p) => ({ key: p.username, label: p.display_name })),
    { key: 'agents', label: AGENTS_WORDS },
    { key: 'none', label: NOBODY_WORDS },
  ];
  const who = whoOptions.some((o) => o.key === rawWho) ? rawWho : undefined;

  const href = (next: { tab?: ConsoleChecklistList; who?: string; status?: string }) => {
    const query = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t !== 'friends') query.set('tab', t);
    if (next.who !== undefined) query.set('who', next.who);
    if (next.status !== undefined) query.set('status', next.status);
    const q = query.toString();
    return `/checklist${q === '' ? '' : `?${q}`}`;
  };

  const listSections = sections.filter((s) => s.list === tab);
  const listItems = listSections.flatMap((s) => s.items);
  const matches = (item: ConsoleChecklistItem) =>
    (status === undefined || item.status === status) &&
    (who === undefined || whoKey(item.assignee, people) === who);
  const filtered = status !== undefined || who !== undefined;
  const shownCount = listItems.filter(matches).length;
  const progress = progressOf(listItems);
  const countOf = (key: string) =>
    listItems.filter((i) => whoKey(i.assignee, people) === key).length;

  const sectionTitle = Object.fromEntries(
    sections.map((s) => [s.id, `${LIST_WORDS[s.list].short} — ${s.title}`]),
  );
  const sectionChoices = sections.map((s) => ({ id: s.id, label: sectionTitle[s.id]! }));

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">فهرست بررسی پیش از راه‌اندازی</h1>
        <p className="max-w-measure text-sm text-muted">
          هر مورد را با وضعیت و مسئولش در همان ردیف تغییر دهید؛ یادداشت‌ها، تاریخچه‌ی تغییرها و
          مدیریت مورد (ویرایش متن، انتقال، ترتیب، حذف با دلیل) با دکمه‌ی «یادداشت» باز می‌شود. هر
          تغییر با نام و زمان در تاریخچه‌ی مورد و کارنامه‌ی کنسول می‌ماند.
        </p>
      </div>

      <nav aria-label="فهرست‌ها">
        <ul className="grid gap-2 md:grid-cols-2">
          {CONSOLE_CHECKLIST_LISTS.map((list) => {
            const p = progressOf(sections.filter((s) => s.list === list).flatMap((s) => s.items));
            const active = list === tab;
            return (
              <li key={list}>
                <Link
                  href={href({ tab: list, who, status })}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-touch flex-col gap-2 rounded-card border p-3 ${FOCUS} ${
                    active
                      ? 'border-brand bg-surface shadow-sm'
                      : 'border-default bg-surface-raised hover:border-strong'
                  }`}
                  data-testid="checklist-tab"
                >
                  <span
                    className={`text-sm leading-6 ${active ? 'font-bold text-fg' : 'text-muted'}`}
                  >
                    {LIST_WORDS[list].title}
                  </span>
                  <ProgressBar progress={p} size="sm" />
                  <ProgressWords progress={p} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Card title={`پیشرفت و فیلترها — ${LIST_WORDS[tab].short}`}>
        <div className="flex flex-col gap-3">
          <ProgressBar progress={progress} />
          <ProgressWords progress={progress} />
          <nav aria-label="وضعیت" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
            <ul className="flex gap-1.5">
              <li>
                <Link
                  href={href({ who })}
                  aria-current={status === undefined ? 'page' : undefined}
                  className={`${CHIP} ${status === undefined ? CHIP_ON : CHIP_OFF}`}
                >
                  همه‌ی وضعیت‌ها
                  <span className="text-xs">{fa(listItems.length)}</span>
                </Link>
              </li>
              {CONSOLE_CHECKLIST_STATUSES.map((s) => (
                <li key={s}>
                  <Link
                    href={href({ who, status: s })}
                    aria-current={status === s ? 'page' : undefined}
                    className={`${CHIP} ${status === s ? CHIP_ON : CHIP_OFF}`}
                    data-testid="status-filter"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2.5 rounded-pill ${STATUS_TONE[s].dot}`}
                    />
                    {STATUS_WORDS[s]}
                    <span className="text-xs">{fa(progress.by[s])}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="مسئول" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
            <ul className="flex items-center gap-1.5">
              <li className="whitespace-nowrap text-xs text-muted">مسئول:</li>
              <li>
                <Link
                  href={href({ status })}
                  aria-current={who === undefined ? 'page' : undefined}
                  className={`${CHIP} ${who === undefined ? CHIP_ON : CHIP_OFF}`}
                >
                  همه
                </Link>
              </li>
              {whoOptions.map((o) => (
                <li key={o.key}>
                  <Link
                    href={href({ who: o.key, status })}
                    aria-current={who === o.key ? 'page' : undefined}
                    className={`${CHIP} ${who === o.key ? CHIP_ON : CHIP_OFF}`}
                    data-testid="who-filter"
                  >
                    <span dir="auto">{o.label}</span>
                    <span className="text-xs">{fa(countOf(o.key))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {filtered && (
            <p className="text-sm text-muted" role="status">
              {fa(shownCount)} مورد از {fa(listItems.length)} با این فیلتر.{' '}
              <Link href={href({})} className={`font-bold text-brand underline ${FOCUS}`}>
                برداشتن فیلترها
              </Link>
            </p>
          )}
        </div>
      </Card>

      {filtered && shownCount === 0 ? (
        <Card>
          <p className="text-sm text-muted">موردی با این فیلتر در این فهرست نیست.</p>
        </Card>
      ) : (
        listSections.map((section) => {
          const shown = section.items.filter(matches);
          if (filtered && shown.length === 0) return null;
          return (
            <SectionCard
              key={section.id}
              section={section}
              shown={shown}
              people={people}
              sections={sectionChoices}
              sectionTitle={sectionTitle}
              filtered={filtered}
            />
          );
        })
      )}
    </>
  );
}
