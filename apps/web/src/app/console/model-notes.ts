import type { ConsoleModelInputKey } from '@fmip/contracts';

/**
 * What each forecast-model version is made of, in Persian (T-1729, D-355;
 * every version, T-1752, D-371): the console's model page reads the figures
 * from the API and the make-up from here, written from the version files in
 * `apps/model/fmip_model/model/{published,candidates,retired}/`, the baseline
 * in `version.py` and the decisions named beside each line. A version that
 * is not listed here is shown with its name and figures and the sentence
 * that its make-up is not written yet, never with another version's (rule
 * 3); `model-notes.spec.ts` fails when a version file has no entry. What was
 * tested and left out is not here: that is the lab's ledger, from the
 * snapshot.
 */

/** Every version that ever existed, oldest first: the order of the matrix's columns. */
export const VERSION_ORDER = [
  '0.1.0',
  '0.2.0',
  '0.3.0',
  '0.4.0',
  '0.5.0',
  '0.6.0',
  '0.7.0',
  '0.8.0',
] as const;
export type VersionNumber = (typeof VERSION_ORDER)[number];

export const MODEL_NAME = 'dixon-coles-elo';
export const versionId = (number: VersionNumber): string => `${MODEL_NAME}@${number}`;
export const versionNumber = (id: string): string => id.slice(id.indexOf('@') + 1);

/**
 * What became of a version, by the decisions: on the site at some time, in
 * shadow with stored forecasts, in shadow for hours and replaced before it
 * stored one, or never shipped at all.
 */
export type VersionFate = 'published' | 'shadow' | 'shadow_unstored' | 'never_shipped';

export interface ModelVersionNote {
  number: VersionNumber;
  fate: VersionFate;
  /** The decision that published it, put it in shadow, or refused it. */
  decision: string;
  /** What it changed from the version before it, in one sentence. */
  delta: string;
  /** A version in shadow: the rule its promotion is judged by. */
  rule?: 'D-336' | 'D-139';
}

export const MODEL_VERSIONS: Record<VersionNumber, ModelVersionNote> = {
  '0.1.0': {
    number: '0.1.0',
    fate: 'published',
    decision: 'D-029',
    delta:
      'نخستین نسخه: یک وزن زمانی و یک مهار برای همه‌ی لیگ‌ها، پنجره‌ی ۴۰۰ روزه و پیشین Club Elo.',
  },
  '0.2.0': {
    number: '0.2.0',
    fate: 'shadow_unstored',
    decision: 'D-082',
    delta: 'وزن زمانی و مهار جدا برای هر لیگ (دور اول تنظیم) و پنجره‌ی ۱۱۰۰ روزه.',
  },
  '0.3.0': {
    number: '0.3.0',
    fate: 'shadow_unstored',
    decision: 'D-082',
    delta: 'دور دوم تنظیم: حافظه‌ی بلندتر و مهار سنگین‌تر برای بیشتر لیگ‌ها.',
  },
  '0.4.0': {
    number: '0.4.0',
    fate: 'shadow_unstored',
    decision: 'D-085',
    delta: 'برازش میان‌لیگی برای جام‌ها و مسابقه‌های قاره‌ای افزوده شد.',
  },
  '0.5.0': {
    number: '0.5.0',
    fate: 'shadow',
    decision: 'D-111',
    delta: 'پیشین Elo از Club Elo به Elo خود سکو عوض شد.',
  },
  '0.6.0': {
    number: '0.6.0',
    fate: 'published',
    decision: 'D-191',
    delta: 'فقط وزن زمانی و مهار ویژه‌ی لیگ برتر خلیج فارس؛ بقیه همان 0.5.0.',
  },
  '0.7.0': {
    number: '0.7.0',
    fate: 'shadow',
    decision: 'D-233',
    delta:
      'یازده لیگ تازه: یونان، سوئیس، دانمارک، آمریکا، برزیل، آرژانتین، چک، کرواسی، صربستان، عربستان و امارات. ثابت‌های 0.6.0 عوض نشد؛ ولی برازش میان‌لیگی هر نسخه مسابقه‌های همه‌ی لیگ‌های همان نسخه را می‌خواند، پس پیش‌بینی جام‌ها هم می‌تواند فرق کند.',
    rule: 'D-336',
  },
  '0.8.0': {
    number: '0.8.0',
    fate: 'never_shipped',
    decision: 'D-329',
    delta:
      'همان 0.7.0 با وزن زمانی و مهار تازه برای نُه لیگ؛ روی فصل کنارگذاشته از معیار رد نشد و هرگز به shadow نرفت.',
  },
};

export const FATE_WORDS: Record<VersionFate, string> = {
  published: 'روی سایت',
  shadow: 'shadow',
  shadow_unstored: 'shadow؛ پیش‌بینی‌ای ذخیره نکرد',
  never_shipped: 'هرگز اجرا نشد',
};

/** From which version an element is in the model, and from which it is not any more. */
interface Span {
  from: VersionNumber;
  /** The first version without it. */
  until?: VersionNumber;
  /** Versions that name it and got nothing from it. */
  silent?: VersionNumber[];
}

export type Use = 'used' | 'not' | 'silent';

const index = (number: string): number => VERSION_ORDER.indexOf(number as VersionNumber);

/** Whether a version has an element; a version this file does not know has none to show. */
export function useOf(span: Span, number: string): Use {
  const at = index(number);
  if (at < 0 || at < index(span.from)) return 'not';
  if (span.until !== undefined && at >= index(span.until)) return 'not';
  return span.silent?.includes(number as VersionNumber) === true ? 'silent' : 'used';
}

/**
 * Whether `number` is the first of `shown` (oldest first) to have the
 * element, when an older shown version did not: what the picture marks "+".
 */
export function isNewIn(span: Span, number: string, shown: readonly string[]): boolean {
  const having = shown.filter((v) => useOf(span, v) !== 'not');
  return having[0] === number && shown[0] !== number;
}

export interface PipelineInput extends Span {
  /** The store's count for it, when the API counts one. */
  input: ConsoleModelInputKey | null;
  title: string;
  source: string;
  /** Said in place of a count where there is none to give. */
  plain?: string;
}

export const PIPELINE_INPUTS: PipelineInput[] = [
  {
    input: 'results',
    from: '0.1.0',
    title: 'نتیجه‌ی مسابقه‌های لیگ‌ها',
    source: 'انبار آموزش: football-data و داده‌ی خود سکو',
  },
  {
    input: null,
    from: '0.7.0',
    title: 'نتیجه‌ی یازده لیگ تازه',
    source: 'همان انبار؛ فقط نسخه‌ای که این لیگ‌ها را نام برده می‌خواند',
    plain: 'در شمار بالا آمده است',
  },
  {
    input: 'own_elo',
    from: '0.5.0',
    title: 'رتبه‌ی Elo خود سکو',
    source: 'هر شب از همه‌ی نتیجه‌های انبار حساب می‌شود (D-111)',
  },
  {
    input: null,
    from: '0.1.0',
    until: '0.5.0',
    silent: ['0.1.0', '0.2.0', '0.3.0', '0.4.0'],
    title: 'رتبه‌ی Club Elo',
    source: 'منبع بیرونی؛ از ۳ مهر ساکت شد و کنار رفت (D-162)',
    plain: 'بازنشسته؛ بیشتر برازش‌های 0.1.0 بدون آن بود',
  },
  {
    input: 'cross_league',
    from: '0.4.0',
    title: 'مسابقه‌های جام و قاره‌ای',
    source: 'همان انبار، برای مسابقه‌ی دو تیم از دو لیگ',
  },
];

export interface PipelineStep extends Span {
  title: string;
  detail: string;
}

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    from: '0.1.0',
    title: 'برازش حمله و دفاع هر تیم',
    detail: 'از گل‌های زده و خورده در پنجره‌ی نتیجه‌ها؛ مسابقه‌ی تازه‌تر وزن بیشتری دارد',
  },
  {
    from: '0.2.0',
    title: 'وزن زمانی و مهار، جدا برای هر لیگ',
    detail: 'نیمه‌عمر از حدود ۱۷۰ تا ۱۴۰۰ روز؛ پنجره‌ی ۱۱۰۰ روزه',
  },
  {
    from: '0.6.0',
    title: 'ثابت‌های لیگ برتر خلیج فارس',
    detail: 'وزن زمانی و مهار ویژه‌ی این لیگ (D-190)',
  },
  {
    from: '0.1.0',
    title: 'پیشین Elo',
    detail: 'قدرت تیمِ کم‌مسابقه را به سمت جایگاهش می‌کشد؛ وزن ۰٫۵',
  },
  {
    from: '0.1.0',
    title: 'اصلاح نتیجه‌های کم‌گل',
    detail: 'احتمال ۰–۰، ۱–۰، ۰–۱ و ۱–۱ با یک عدد برازش‌شده اصلاح می‌شود',
  },
  {
    from: '0.4.0',
    title: 'برازش میان‌لیگی برای جام‌ها',
    detail: 'قدرت باشگاه = قدرت لیگش + قدرت خودش، روی یک مقیاس (D-085)',
  },
  {
    from: '0.1.0',
    title: 'جدول پواسون تا ۱۰ گل',
    detail: 'از میانگین گل هر طرف، احتمال هر نتیجه و جمع آن‌ها',
  },
];

export const PIPELINE_OUTPUTS: { title: string; detail: string }[] = [
  { title: 'سه احتمال', detail: 'برد میزبان، مساوی، برد میهمان؛ جمعشان دقیقاً یک' },
  { title: 'محتمل‌ترین نتیجه‌ها', detail: 'پنج نتیجه‌ی دقیق با احتمال هر کدام' },
  {
    title: 'وضعیت داده',
    detail: '«کامل» فقط وقتی Elo به‌کار رفته و هر دو تیم ۱۵ مسابقه دارند؛ وگرنه «محدود»',
  },
  {
    title: 'ذخیره، بدون تغییر',
    detail: 'هر پیش‌بینی با ورودی‌ها، نسخه و زمان محاسبه‌اش می‌ماند؛ نسخه‌ی تازه کنارش می‌نشیند',
  },
  {
    title: 'سنجش پس از بازی',
    detail: 'آخرین پیش‌بینی پیش از سوت آغاز با نتیجه سنجیده می‌شود؛ پس از شروع شمرده نمی‌شود',
  },
];

/** Data the store holds and no version reads: tested in the lab, left out. */
export const PIPELINE_OUTSIDE: { input: ConsoleModelInputKey; title: string; detail: string }[] = [
  {
    input: 'expected_goals',
    title: 'گل مورد انتظار (xG)',
    detail: 'آزموده شد و بیرون ماند؛ یک آزمون رو به جلو در راه است',
  },
  {
    input: 'lineups',
    title: 'ترکیب اصلی',
    detail: 'به مدل می‌رسد، ولی هیچ نسخه‌ای ضریبی برایش ندارد',
  },
  { input: 'absences', title: 'غایب‌ها', detail: 'آزموده شد و بیرون ماند' },
];

/** One row of the make-up matrix: a mark per version, or words where a mark cannot say it. */
export interface MatrixRow {
  title: string;
  technical: string;
  span: Span;
  /** Words in place of the mark, by the version they start at. */
  values?: Partial<Record<VersionNumber, string>>;
  /** Read by no version: drawn apart. */
  outside?: boolean;
}

export const MODEL_MATRIX: MatrixRow[] = [
  {
    title: 'نتیجه‌ی مسابقه‌ها',
    technical: 'match results',
    span: { from: '0.1.0' },
  },
  {
    title: 'پنجره‌ی نتیجه‌ها',
    technical: 'history_days',
    span: { from: '0.1.0' },
    values: { '0.1.0': '۴۰۰ روز', '0.2.0': '۱۱۰۰ روز' },
  },
  {
    title: 'وزن زمانی و مهار',
    technical: 'xi, ridge',
    span: { from: '0.1.0' },
    values: {
      '0.1.0': 'یکی برای همه',
      '0.2.0': 'هر لیگ، دور اول',
      '0.3.0': 'هر لیگ، دور دوم',
      '0.6.0': 'و لیگ ایران',
      '0.7.0': 'و دو لیگ تازه',
      '0.8.0': 'و نُه لیگ دیگر',
    },
  },
  {
    title: 'پیشین Elo',
    technical: 'elo_prior',
    span: { from: '0.1.0' },
    values: { '0.1.0': 'Club Elo، بیشتر ساکت', '0.5.0': 'Elo خود سکو' },
  },
  {
    title: 'برازش میان‌لیگی برای جام‌ها',
    technical: 'cross_league',
    span: { from: '0.4.0' },
  },
  {
    title: 'شمار لیگ‌ها و بخش‌ها',
    technical: 'divisions',
    span: { from: '0.1.0' },
    values: { '0.1.0': '۱۲', '0.4.0': '۱۳ با جام‌ها', '0.7.0': '۲۴' },
  },
  {
    title: 'اصلاح کم‌گل و جدول پواسون',
    technical: 'rho, Poisson',
    span: { from: '0.1.0' },
  },
  {
    title: 'ترکیب اصلی',
    technical: 'xi_strength',
    span: { from: '0.1.0', silent: [...VERSION_ORDER] },
    outside: true,
  },
  {
    title: 'گل مورد انتظار، غایب‌ها، استراحت و دیگر عامل‌ها',
    technical: 'tested inputs',
    span: { from: '0.8.0', until: '0.8.0' },
    outside: true,
  },
];

/** What a matrix cell says for one version: words, or a mark; and whether it changed there. */
export function matrixCell(
  row: MatrixRow,
  number: VersionNumber,
): { use: Use; words: string | null; changed: boolean } {
  const use = useOf(row.span, number);
  const at = index(number);
  let words: string | null = null;
  let changed = false;
  if (row.values !== undefined && use !== 'not') {
    for (const candidate of VERSION_ORDER) {
      if (index(candidate) > at) break;
      const value = row.values[candidate];
      if (value !== undefined) {
        words = value;
        changed = candidate === number && at > 0;
      }
    }
  } else if (at > 0) {
    changed = use !== useOf(row.span, VERSION_ORDER[at - 1] as VersionNumber);
  }
  return { use, words, changed };
}
