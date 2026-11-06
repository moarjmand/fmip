import type {
  ConsoleLabEntry,
  ConsoleLabGroup,
  ConsoleLabGroupKey,
  ConsoleLabJudgement,
  ConsoleLabVerdict,
  ConsoleModelLab,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { DifferenceStrip, score, signed } from './model-charts';
import { Badge, fa, when } from './ui';

/**
 * The model lab's ledger on the console (T-1752, D-371): everything ever
 * tested, as the snapshot carries it from the model scientist's file. The
 * page computes nothing from it and judges nothing: a forest plot of every
 * measured difference on one scale (left is better), one row per entry and
 * one per large family, then a card per entry with why it was tried, what
 * was measured and why it was set aside, with its decision. Verdicts have a
 * glyph and a word, never colour alone; a figure with no interval is drawn
 * hollow; an entry with no difference shows its count or its words.
 */

export const VERDICT_WORDS: Record<ConsoleLabVerdict, string> = {
  adopted: 'پذیرفته شد',
  rejected: 'رد شد',
  insufficient: 'مسابقه‌ی کافی نبود',
  parked: 'در انتظار تصمیم',
  running: 'در حال اجرا',
  scheduled: 'برنامه‌ریزی‌شده',
  not_run: 'اجرا نشد',
};

const VERDICT_GLYPHS: Record<ConsoleLabVerdict, string> = {
  adopted: '✓',
  rejected: '×',
  insufficient: '◔',
  parked: '‖',
  running: '▶',
  scheduled: '▶',
  not_run: '◌',
};

/** The groups of the forest, largest and most asked about first. */
const VERDICT_ORDER: ConsoleLabVerdict[] = [
  'rejected',
  'insufficient',
  'adopted',
  'running',
  'scheduled',
  'parked',
  'not_run',
];

export const GROUP_WORDS: Record<ConsoleLabGroupKey, string> = {
  football_data: 'لیگ‌های football-data',
  our_records: 'سوابق خود ما',
  cross_league: 'مسابقه‌های میان‌لیگی',
  all: 'همه',
};

const GROUP_MARK: Record<ConsoleLabGroupKey, 'circle' | 'diamond' | 'square'> = {
  football_data: 'circle',
  our_records: 'diamond',
  cross_league: 'square',
  all: 'circle',
};

const RESULT_WORDS: Record<ConsoleLabGroup['result'], string> = {
  passed: 'گذشت',
  failed: 'رد شد',
  insufficient: 'کافی نبود',
  not_judged: 'داوری نشد',
};

/** The forest's scale: a log-loss difference per match, ±0.02 on every row. */
const FOREST_HALF = 0.02;
/** A family of this many entries is one row of the forest and one card. */
const BIG_FAMILY = 5;

export const VerdictBadge = ({ verdict }: { verdict: ConsoleLabVerdict }) => (
  <Badge
    tone={
      verdict === 'adopted'
        ? 'border-model text-model'
        : verdict === 'rejected'
          ? 'border-strong text-fg'
          : 'border-default text-muted'
    }
  >
    <span aria-hidden="true" className="me-1">
      {VERDICT_GLYPHS[verdict]}
    </span>
    {VERDICT_WORDS[verdict]}
  </Badge>
);

const Ltr = ({ children }: { children: ReactNode }) => (
  <span dir="ltr" className="font-mono text-[0.8125rem]">
    {children}
  </span>
);

const anchor = (key: string) => `t-${key.replace(/[^a-z0-9_-]/g, '')}`;

/** One group's difference in words, `−۰٫۰۰۳۲ [−۰٫۰۰۵۲، −۰٫۰۰۱۰]`, or the words for none. */
function differenceWords(group: ConsoleLabGroup): string {
  if (group.difference === null) return 'اختلافی ثبت نشده';
  const interval =
    group.low !== null && group.high !== null
      ? ` [${signed(group.low)}، ${signed(group.high)}]`
      : ' (بدون بازه)';
  return `${signed(group.difference)}${interval}`;
}

const worseWords = (group: ConsoleLabGroup): string | null =>
  group.worse_divisions === null
    ? null
    : `بدتر در ${fa(group.worse_divisions)}${group.divisions === null ? '' : ` از ${fa(group.divisions)}`} لیگ`;

// --- Families -------------------------------------------------------------------

export interface Family {
  title: string;
  entries: ConsoleLabEntry[];
  /** Its entries' verdicts, counted. */
  verdicts: Partial<Record<ConsoleLabVerdict, number>>;
  /** The verdict the forest files it under: that of most of its entries. */
  verdict: ConsoleLabVerdict;
  big: boolean;
}

/** Entries by family, in the ledger's order; a family's verdict is that of most of its entries. */
export function families(entries: readonly ConsoleLabEntry[]): Family[] {
  const byTitle = new Map<string, ConsoleLabEntry[]>();
  for (const entry of entries)
    byTitle.set(entry.family, [...(byTitle.get(entry.family) ?? []), entry]);
  return [...byTitle.entries()].map(([title, own]) => {
    const verdicts: Partial<Record<ConsoleLabVerdict, number>> = {};
    for (const entry of own) verdicts[entry.verdict] = (verdicts[entry.verdict] ?? 0) + 1;
    const verdict = (Object.entries(verdicts) as [ConsoleLabVerdict, number][]).sort(
      (a, b) => b[1] - a[1] || VERDICT_ORDER.indexOf(a[0]) - VERDICT_ORDER.indexOf(b[0]),
    )[0]?.[0] as ConsoleLabVerdict;
    return { title, entries: own, verdicts, verdict, big: own.length >= BIG_FAMILY };
  });
}

/** One row of the forest: an entry, or a whole large family. */
interface Row {
  key: string;
  title: string;
  verdict: ConsoleLabVerdict;
  words: string;
  /** The measured groups to draw; empty where there is nothing to draw. */
  groups: ConsoleLabGroup[];
  /** What is drawn in place of marks: a count toward 300, or a sentence. */
  instead: { count: number; needed: number } | string | null;
  href: string;
}

const verdictCounts = (family: Family): string =>
  (Object.entries(family.verdicts) as [ConsoleLabVerdict, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${fa(n)} ${VERDICT_WORDS[v]}`)
    .join('، ');

export function forestRows(entries: readonly ConsoleLabEntry[]): Row[] {
  const rows: Row[] = [];
  for (const family of families(entries)) {
    if (family.big) {
      rows.push({
        key: `family-${family.title}`,
        title: `${family.title} (${fa(family.entries.length)} مورد)`,
        verdict: family.verdict,
        words: verdictCounts(family),
        groups: [],
        instead: `${fa(family.entries.length)} مورد، هر یک با عدد خودش در کارت خانواده`,
        href: `#${anchor(family.entries[0]?.key ?? '')}`,
      });
      continue;
    }
    for (const entry of family.entries) {
      const measured = entry.groups.filter((g) => g.difference !== null);
      const counted = entry.groups.find((g) => g.matches !== null && g.difference === null);
      rows.push({
        key: entry.key,
        title: entry.title,
        verdict: entry.verdict,
        words: VERDICT_WORDS[entry.verdict],
        groups: measured,
        instead:
          measured.length > 0
            ? null
            : entry.verdict === 'insufficient' &&
                counted !== undefined &&
                counted.matches !== null &&
                counted.matches_total !== null
              ? { count: counted.matches, needed: counted.matches_total }
              : 'اختلافی ثبت نشده',
        href: `#${anchor(entry.key)}`,
      });
    }
  }
  return rows.sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict));
}

// --- The forest -----------------------------------------------------------------

function Lane({ row, width }: { row: Row; width: number }) {
  if (row.groups.length > 0) {
    return (
      <div className="flex flex-col gap-0.5">
        {row.groups.map((group, i) => (
          <DifferenceStrip
            key={i}
            estimate={{ mean: group.difference as number, low: group.low, high: group.high }}
            half={FOREST_HALF}
            width={width}
            mark={GROUP_MARK[group.group]}
            hollow={group.low === null || group.high === null}
            ticks={false}
            label={`${GROUP_WORDS[group.group]}: ${differenceWords(group)}`}
          />
        ))}
      </div>
    );
  }
  if (typeof row.instead === 'object' && row.instead !== null) {
    const share = row.instead.needed > 0 ? Math.min(1, row.instead.count / row.instead.needed) : 0;
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={row.instead.needed}
          aria-valuenow={row.instead.count}
          aria-label={`${fa(row.instead.count)} از ${fa(row.instead.needed)} مسابقه`}
          className="h-1.5 flex-1 overflow-hidden rounded-pill bg-model/20"
        >
          <div className="h-full rounded-pill bg-model" style={{ inlineSize: `${share * 100}%` }} />
        </div>
        <span className="whitespace-nowrap">
          {fa(row.instead.count)} از {fa(row.instead.needed)} مسابقه
        </span>
      </div>
    );
  }
  return <p className="text-xs text-caption">{row.instead}</p>;
}

/** A row's caption: where it was worse, from its measured groups. */
const caption = (row: Row): string =>
  row.groups
    .map((g) => worseWords(g))
    .filter((w): w is string => w !== null)
    .join('؛ ');

export function Forest({ entries }: { entries: readonly ConsoleLabEntry[] }) {
  const rows = forestRows(entries);
  const grouped = VERDICT_ORDER.map((verdict) => ({
    verdict,
    rows: rows.filter((r) => r.verdict === verdict),
  })).filter((g) => g.rows.length > 0);
  const axis = (width: number) => (
    <DifferenceStrip
      estimate={{ mean: 0, low: null, high: null }}
      mark="none"
      half={FOREST_HALF}
      width={width}
      betterWords="بهتر از مدل پایه"
      worseWords="بدتر"
      label="محور: اختلاف log loss هر مسابقه، با ورودی منهای بدون آن"
    />
  );
  return (
    <div data-testid="forest">
      <p className="text-sm leading-7 text-muted">
        هر ردیف یک آزمایش: اختلاف log loss هر مسابقه با آن چیز منهای بدون آن، با بازه‌ی ۹۵٪؛ چپ یعنی
        بهتر. ○ لیگ‌های football-data، ◇ سوابق خود ما، □ مسابقه‌های میان‌لیگی؛ نشانه‌ی توخالی یعنی
        بازه ثبت نشده. مقیاس همه‌ی ردیف‌ها یکی است (±۰٫۰۲)؛ بازه‌ای که از آن بیرون می‌زند با پیکان
        کوتاه می‌شود.
      </p>
      {/* Wide: a grid whose lane column shares one axis. */}
      <div className="mt-3 hidden lg:block">
        <div className="grid grid-cols-[1.25rem_15rem_8rem_26rem_minmax(0,1fr)] items-end gap-x-3 border-b border-default pb-1 text-xs text-caption">
          <span />
          <span>آزمایش</span>
          <span>حکم</span>
          <div className="w-[410px]">{axis(410)}</div>
          <span>کجا بدتر بود</span>
        </div>
        {grouped.map((group) => (
          <div key={group.verdict} data-verdict={group.verdict}>
            <div className="mt-2 rounded-tile bg-surface-raised px-2 py-1 text-xs font-bold text-muted">
              <span aria-hidden="true" className="me-1">
                {VERDICT_GLYPHS[group.verdict]}
              </span>
              {VERDICT_WORDS[group.verdict]} · {fa(group.rows.length)}
            </div>
            {group.rows.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-[1.25rem_15rem_8rem_26rem_minmax(0,1fr)] items-center gap-x-3 border-b border-default py-1 text-sm"
                data-testid="forest-row"
              >
                <span aria-hidden="true" className="text-muted">
                  {VERDICT_GLYPHS[row.verdict]}
                </span>
                <a href={row.href} className="text-fg underline-offset-2 hover:underline">
                  {row.title}
                </a>
                <span className="text-xs text-muted">{row.words}</span>
                <div className="w-[410px]">
                  <Lane row={row} width={410} />
                </div>
                <span className="text-xs text-caption">{caption(row)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Narrow: the rows stacked, each verdict's group a disclosure, the first open. */}
      <div className="mt-3 lg:hidden">
        <div className="mx-auto max-w-[30rem]">{axis(290)}</div>
        {grouped.map((group, i) => (
          <details key={group.verdict} open={i === 0} className="mt-2" data-verdict={group.verdict}>
            <summary className="min-h-touch cursor-pointer rounded-tile bg-surface-raised px-2 py-2 text-sm font-bold text-muted">
              <span aria-hidden="true" className="me-1">
                {VERDICT_GLYPHS[group.verdict]}
              </span>
              {VERDICT_WORDS[group.verdict]} · {fa(group.rows.length)}
            </summary>
            {group.rows.map((row) => (
              <div
                key={row.key}
                className="border-b border-default py-2 text-sm"
                data-testid="forest-row"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <a href={row.href} className="text-fg underline-offset-2 hover:underline">
                    <span aria-hidden="true" className="me-1 text-muted">
                      {VERDICT_GLYPHS[row.verdict]}
                    </span>
                    {row.title}
                  </a>
                  <span className="whitespace-nowrap text-xs text-muted">{row.words}</span>
                </div>
                <div className="mx-auto mt-1 max-w-[30rem]">
                  <Lane row={row} width={290} />
                </div>
                {caption(row) !== '' && <p className="text-xs text-caption">{caption(row)}</p>}
              </div>
            ))}
          </details>
        ))}
      </div>
    </div>
  );
}

// --- The cards ------------------------------------------------------------------

function GroupTable({ entries }: { entries: readonly ConsoleLabEntry[] }) {
  const many = entries.length > 1;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[44rem] whitespace-nowrap text-sm">
        <caption className="sr-only">عددهای کامل هر اجرا</caption>
        <thead className="text-xs text-caption">
          <tr>
            {many && <th className="p-2 text-start font-normal">مورد</th>}
            <th className="p-2 text-start font-normal">گروه</th>
            <th className="p-2 text-start font-normal">مسابقه</th>
            <th className="p-2 text-start font-normal">log loss پایه ← با آن</th>
            <th className="p-2 text-start font-normal">اختلاف و بازه‌ی ۹۵٪</th>
            <th className="p-2 text-start font-normal">بدتر در</th>
            <th className="p-2 text-start font-normal">calibration پایه ← با آن</th>
            <th className="p-2 text-start font-normal">نتیجه</th>
          </tr>
        </thead>
        <tbody>
          {entries.flatMap((entry) =>
            (entry.groups.length === 0 ? [null] : entry.groups).map((group, i) => (
              <tr key={`${entry.key}-${i}`} className="border-t border-default align-top">
                {many && (
                  <td className="p-2">
                    <span className="text-fg">{entry.title}</span>{' '}
                    <VerdictBadge verdict={entry.verdict} />
                  </td>
                )}
                {group === null ? (
                  <td className="p-2 text-caption" colSpan={7}>
                    شماره‌ای ثبت نشده
                  </td>
                ) : (
                  <>
                    <td className="p-2">
                      {GROUP_WORDS[group.group]}
                      {group.label !== null && (
                        <span className="text-xs text-caption"> · {group.label}</span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums">
                      {group.matches === null ? '—' : fa(group.matches)}
                      {group.matches_total !== null && (
                        <span className="text-xs text-caption"> از {fa(group.matches_total)}</span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums" dir="ltr">
                      {group.reference_log_loss === null ? '—' : score(group.reference_log_loss, 4)}
                      {' → '}
                      {group.tested_log_loss === null ? '—' : score(group.tested_log_loss, 4)}
                    </td>
                    <td className="p-2 tabular-nums">{differenceWords(group)}</td>
                    <td className="p-2">
                      {worseWords(group) ?? '—'}
                      {group.worse_in.length > 0 && (
                        <span className="ms-1 text-xs text-caption" dir="ltr">
                          {group.worse_in.join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums" dir="ltr">
                      {group.calibration_before === null ? '—' : score(group.calibration_before, 4)}
                      {' → '}
                      {group.calibration_after === null ? '—' : score(group.calibration_after, 4)}
                    </td>
                    <td className="p-2">
                      {RESULT_WORDS[group.result]}
                      {group.note !== null && (
                        <span className="block text-xs text-caption whitespace-normal">
                          {group.note}
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Footer({ entry }: { entry: ConsoleLabEntry }) {
  return (
    <p className="mt-2 text-xs text-caption">
      {entry.decisions.length > 0 && (
        <>
          <span className="whitespace-nowrap">{entry.decisions.join('، ')}</span>
          {' · '}
        </>
      )}
      {entry.task !== null && (
        <>
          <span className="whitespace-nowrap">{entry.task}</span>
          {' · '}
        </>
      )}
      {entry.decided_on !== null && <>حکم: {when(entry.decided_on, false)} · </>}
      {entry.due_on !== null && <>داوری: {when(entry.due_on, false)} · </>}
      {entry.phase !== null && <>فاز {fa(entry.phase)}</>}
      {entry.against !== null && (
        <>
          {' '}
          · در برابر <Ltr>{entry.against}</Ltr>
        </>
      )}
    </p>
  );
}

function EntryCard({ entry }: { entry: ConsoleLabEntry }) {
  return (
    <article
      id={anchor(entry.key)}
      className="min-w-0 scroll-mt-20 rounded-tile border border-default p-4"
      data-testid="ledger-entry"
      data-verdict={entry.verdict}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="min-w-0 text-sm font-bold text-fg">
          {entry.title}{' '}
          <span className="text-xs font-normal break-all text-caption">
            <Ltr>{entry.technical}</Ltr>
          </span>
        </h4>
        <VerdictBadge verdict={entry.verdict} />
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm leading-7 md:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-muted">چرا آزموده شد</dt>
        <dd className="text-fg">{entry.why}</dd>
        <dt className="text-muted">روی چه داده‌ای</dt>
        <dd className="min-w-0 break-words text-fg">{entry.data === '' ? '—' : entry.data}</dd>
        <dt className="text-muted">اندازه‌گیری</dt>
        <dd className="text-fg">
          {entry.groups.length === 0 ? (
            'شماره‌ای ثبت نشده'
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {entry.groups.map((group, i) => (
                <li
                  key={i}
                  className="min-w-0 rounded-pill border border-default px-2 py-0.5 text-xs text-muted"
                >
                  {GROUP_WORDS[group.group]}: {differenceWords(group)}
                  {group.matches !== null && ` · ${fa(group.matches)} مسابقه`}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt className="text-muted">
          {entry.verdict === 'adopted' ? 'چرا پذیرفته شد' : 'حکم و دلیل'}
        </dt>
        <dd className="text-fg">{entry.reason}</dd>
      </dl>
      {entry.groups.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted">عددهای کامل هر اجرا</summary>
          <GroupTable entries={[entry]} />
        </details>
      )}
      {entry.missing.length > 0 && (
        <p className="mt-2 text-xs text-caption">ثبت نشده: {entry.missing.join('؛ ')}</p>
      )}
      <Footer entry={entry} />
    </article>
  );
}

function FamilyCard({ family }: { family: Family }) {
  const first = family.entries[0] as ConsoleLabEntry;
  return (
    <article
      id={anchor(first.key)}
      className="min-w-0 scroll-mt-20 rounded-tile border border-default p-4 lg:col-span-2"
      data-testid="ledger-family"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-fg">
          {family.title}{' '}
          <span className="text-xs font-normal text-caption">{fa(family.entries.length)} مورد</span>
        </h4>
        <span className="text-xs text-muted">{verdictCounts(family)}</span>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm leading-7 md:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-muted">چرا آزموده شد</dt>
        <dd className="text-fg">{first.why}</dd>
        <dt className="text-muted">روی چه داده‌ای</dt>
        <dd className="text-fg">{first.data === '' ? '—' : first.data}</dd>
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-muted">هر مورد با عدد و حکمش</summary>
        <GroupTable entries={family.entries} />
        <ul className="mt-2 flex flex-col gap-1 text-xs text-caption">
          {family.entries.map((entry) => (
            <li key={entry.key} id={anchor(entry.key)}>
              <span className="text-fg">{entry.title}</span>: {entry.reason}{' '}
              <span className="whitespace-nowrap">{entry.decisions.join('، ')}</span>
            </li>
          ))}
        </ul>
      </details>
      <Footer entry={first} />
    </article>
  );
}

export function LedgerCards({ entries }: { entries: readonly ConsoleLabEntry[] }) {
  const all = families(entries);
  const order = (f: Family) => VERDICT_ORDER.indexOf(f.verdict);
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2" data-testid="ledger-cards">
      {[...all]
        .sort((a, b) => order(a) - order(b))
        .flatMap((family) =>
          family.big
            ? [<FamilyCard key={family.title} family={family} />]
            : family.entries.map((entry) => <EntryCard key={entry.key} entry={entry} />),
        )}
    </div>
  );
}

// --- The recorded judgements ------------------------------------------------------

/** The weekly watch's recorded looks at a version's promotion conditions, newest first. */
export function Judgements({
  judgements,
  modelVersion,
}: {
  judgements: readonly ConsoleLabJudgement[];
  modelVersion: string;
}) {
  const own = judgements
    .filter((j) => j.model_version === modelVersion)
    .sort((a, b) => b.judged_on.localeCompare(a.judged_on));
  if (own.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="judgements">
      {own.map((j, i) => (
        <li key={i} className="leading-7">
          <Badge tone={j.result === 'met' ? 'border-model text-model' : 'border-strong text-fg'}>
            {j.result === 'met' ? 'برقرار' : 'برقرار نیست'}
          </Badge>{' '}
          <span className="text-fg">{j.text}</span>{' '}
          <span className="text-xs text-caption">
            {when(j.judged_on, false)}
            {j.matches !== null && ` · ${fa(j.matches)} مسابقه`} ·{' '}
            <span className="whitespace-nowrap">{j.rule}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The ledger's own state line: when it was last changed, and what was left out. */
export function LedgerState({ lab }: { lab: ConsoleModelLab }) {
  return (
    <p className="text-xs text-caption" data-testid="ledger-state">
      دفتر از رایانه، آخرین تغییر {when(lab.updated_at)} · {fa(lab.entries.length)} مورد
      {lab.skipped > 0 && (
        <span className="text-warning">
          {' '}
          · {fa(lab.skipped)} مورد فایل خوانا نبود و نشان داده نمی‌شود
        </span>
      )}
    </p>
  );
}
