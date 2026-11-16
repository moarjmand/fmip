import type {
  ConsoleCanvasBlock,
  ConsoleCanvasCard,
  ConsoleCanvasEvent,
  ConsoleCanvasField,
  ConsoleCanvasTag,
} from '@fmip/contracts';
import { CONSOLE_CANVAS_BLOCKS } from '@fmip/contracts/console';

/**
 * The business model canvas's words (T-1855, D-440), shared by the
 * server-drawn page and its one client part: the nine blocks with their fill
 * order and guiding question, the tags and their tones, the page's own words
 * in Persian and in English (`?lang=en`, D-440's exception to D-352), what a
 * history row says, a card's text in the shown language with its fallback,
 * and the JSON a download holds. No React, no server.
 */

export type CanvasLang = 'fa' | 'en';

export interface BlockWords {
  /** Its number in the fill order, 1 to 9. */
  n: number;
  /** Its cell in the classic layout (`canvas.css`). */
  area: string;
  fa: string;
  en: string;
  qfa: string;
  qen: string;
}

/** The nine blocks; `CONSOLE_CANVAS_BLOCKS` is already the fill order. */
export const BLOCK_WORDS: Record<ConsoleCanvasBlock, BlockWords> = {
  customer_segments: {
    n: 1,
    area: 'cs',
    fa: 'بخش‌های مشتری',
    en: 'Customer segments',
    qfa: 'برای چه کسانی می‌سازیم؟',
    qen: 'Who are we building for?',
  },
  value_propositions: {
    n: 2,
    area: 'vp',
    fa: 'ارزش پیشنهادی',
    en: 'Value propositions',
    qfa: 'چرا کسی Stadiomind را انتخاب کند؟',
    qen: 'Why would anyone pick Stadiomind?',
  },
  channels: {
    n: 3,
    area: 'ch',
    fa: 'کانال‌ها',
    en: 'Channels',
    qfa: 'از کجا به ما می‌رسند؟',
    qen: 'How do they reach us?',
  },
  customer_relationships: {
    n: 4,
    area: 'cr',
    fa: 'ارتباط با مشتری',
    en: 'Customer relationships',
    qfa: 'هر گروه چه رابطه‌ای از ما انتظار دارد؟',
    qen: 'What relationship does each segment expect?',
  },
  revenue_streams: {
    n: 5,
    area: 'rev',
    fa: 'جریان‌های درآمد',
    en: 'Revenue streams',
    qfa: 'چه کسی، برای چه، پول می‌دهد؟',
    qen: 'Who pays, and for what?',
  },
  key_resources: {
    n: 6,
    area: 'kr',
    fa: 'منابع کلیدی',
    en: 'Key resources',
    qfa: 'چه دارایی‌هایی پیشنهاد را ممکن می‌کند؟',
    qen: 'Which assets make the offer possible?',
  },
  key_activities: {
    n: 7,
    area: 'ka',
    fa: 'فعالیت‌های کلیدی',
    en: 'Key activities',
    qfa: 'چه کارهایی را باید هر روز خوب انجام دهیم؟',
    qen: 'What must we do well, every day?',
  },
  key_partners: {
    n: 8,
    area: 'kp',
    fa: 'شرکای کلیدی',
    en: 'Key partners',
    qfa: 'بدون چه کسانی کار پیش نمی‌رود؟',
    qen: 'Who do we rely on?',
  },
  cost_structure: {
    n: 9,
    area: 'cost',
    fa: 'ساختار هزینه',
    en: 'Cost structure',
    qfa: 'پول کجا خرج می‌شود؟',
    qen: 'Where does the money go?',
  },
};

export const blockName = (block: ConsoleCanvasBlock, lang: CanvasLang): string =>
  lang === 'fa' ? BLOCK_WORDS[block].fa : BLOCK_WORDS[block].en;

export const TAG_WORDS: Record<ConsoleCanvasTag, Record<CanvasLang, string>> = {
  validated: { fa: 'تأییدشده', en: 'Validated' },
  assumption: { fa: 'فرض', en: 'Assumption' },
  risk: { fa: 'ریسک', en: 'Risk' },
  question: { fa: 'پرسش باز', en: 'Open question' },
};

/**
 * A tag's tone: the card's tint and edge, and the dot beside the tag's name.
 * Validated is the teal of a good rating, an assumption the theme's amber, a
 * risk the danger red; an open question is an outline, dashed, with no fill.
 */
export const TAG_TONE: Record<ConsoleCanvasTag, { card: string; dot: string }> = {
  validated: { card: 'border-rating-good bg-rating-good/10', dot: 'bg-rating-good' },
  assumption: { card: 'border-warning/40 bg-warning/10', dot: 'bg-warning' },
  risk: { card: 'border-danger/40 bg-danger/10', dot: 'bg-danger' },
  question: {
    card: 'border-dashed border-strong bg-surface',
    dot: 'border-2 border-dashed border-strong',
  },
};

const FIELD_WORDS: Record<ConsoleCanvasField, Record<CanvasLang, string>> = {
  text_fa: { fa: 'متن فارسی', en: 'the Persian text' },
  text_en: { fa: 'متن انگلیسی', en: 'the English text' },
  note_fa: { fa: 'یادداشت فارسی', en: 'the Persian note' },
  note_en: { fa: 'یادداشت انگلیسی', en: 'the English note' },
  source: { fa: 'منبع', en: 'the source' },
};

/** The page's own words, in the shown language. */
export const CANVAS_WORDS = {
  fa: {
    title: 'بوم مدل کسب‌وکار',
    lede: 'پیش‌نویس زنده از وضعیت واقعی پروژه. هر کارت منبعش را دارد؛ آنچه سنجیده نشده «فرض» است و هر رقم ناشناخته «پرسش باز». هر تغییر با نام و زمان در تاریخچه و کارنامه‌ی کنسول می‌ماند.',
    sheetHead: 'Stadiomind · بوم مدل کسب‌وکار',
    sheetOrder: 'شماره‌ی هر خانه ترتیب پرکردن بوم است',
    all: 'همه',
    tags: 'برچسب‌ها',
    filtered: (shown: string, total: string) => `${shown} کارت از ${total} با این برچسب.`,
    clear: 'برداشتن فیلتر',
    other: 'English',
    otherTitle: 'نمای انگلیسی بوم',
    print: 'چاپ / ذخیره به PDF',
    json: 'دریافت JSON',
    jsonTitle: 'همه‌ی کارت‌های روی بوم، با منبع و برچسب',
    emptyBlock: 'هنوز کارتی نیست.',
    emptyFiltered: 'کارتی با این برچسب نیست.',
    add: 'افزودن کارت',
    firstFill: 'پرکردن اولیه',
    bin: 'سطل کارت‌های حذف‌شده',
    binEmpty: 'چیزی حذف نشده.',
    binNote: 'کارت حذف‌شده با همه‌ی تاریخچه‌اش می‌ماند و به جای خودش در بخش برمی‌گردد.',
    removedBy: 'حذف به دست',
    history: 'تاریخچه‌ی بوم',
    historyNote: 'صد تغییر تازه‌تر، تازه‌ترین بالا.',
    historyEmpty: 'هنوز تغییری ثبت نشده؛ همه‌ی کارت‌ها از پرکردن اولیه‌اند.',
    readError: 'بوم خوانده نشد. کمی بعد دوباره امتحان کنید.',
    foot: 'این بوم مشاوره‌ی مالی یا حقوقی نیست. رقم‌ها فقط همان‌هایی‌اند که در منابع آمده؛ برای درآمد هیچ رقمی پیش‌بینی نشده و جای خالی‌اش «پرسش باز» است.',
    // The card and its editor.
    edit: 'ویرایش',
    up: 'بالاتر',
    down: 'پایین‌تر',
    remove: 'حذف',
    restore: 'بازگرداندن',
    undo: 'برگرداندن',
    removed: 'کارت به سطل رفت.',
    restored: 'کارت برگشت.',
    close: 'بستن',
    save: 'ذخیره',
    cancel: 'انصراف',
    fTextFa: 'متن فارسی',
    fTextEn: 'متن انگلیسی',
    fNoteFa: 'یادداشت فارسی',
    fNoteEn: 'یادداشت انگلیسی',
    fSource: 'منبع',
    fTag: 'برچسب',
    fBlock: 'بخش',
    keys: 'Ctrl+Enter ذخیره · Esc انصراف',
    needText: 'متن کارت را دست‌کم به یکی از دو زبان بنویسید.',
    cardActions: 'کارهای کارت',
    onlyOther: 'فقط به انگلیسی نوشته شده',
    lastChange: 'آخرین تغییر',
  },
  en: {
    title: 'Business model canvas',
    lede: 'A live draft from the project’s real state. Every card names its source; anything untested is an assumption, and every unknown number is an open question. Every change is kept with its name and time in the history and the console’s audit trail.',
    sheetHead: 'Stadiomind · Business model canvas',
    sheetOrder: 'Each cell’s number is the order the canvas is filled in',
    all: 'All',
    tags: 'Tags',
    filtered: (shown: string, total: string) => `${shown} of ${total} cards with this tag.`,
    clear: 'Clear the filter',
    other: 'فارسی',
    otherTitle: 'The canvas in Persian',
    print: 'Print / save as PDF',
    json: 'Download JSON',
    jsonTitle: 'Every card on the canvas, with its source and tag',
    emptyBlock: 'No cards yet.',
    emptyFiltered: 'No cards with this tag.',
    add: 'Add card',
    firstFill: 'First fill',
    bin: 'Removed cards',
    binEmpty: 'Nothing removed.',
    binNote: 'A removed card keeps its whole history and goes back to its place in its block.',
    removedBy: 'Removed by',
    history: 'History of the canvas',
    historyNote: 'The newest 100 changes, newest first.',
    historyEmpty: 'No changes yet; every card is from the first fill.',
    readError: 'The canvas could not be read. Try again in a moment.',
    foot: 'Not financial or legal advice. Figures are only those stated in the sources; no revenue figure has been forecast, and each gap is an open question.',
    edit: 'Edit',
    up: 'Move up',
    down: 'Move down',
    remove: 'Remove',
    restore: 'Restore',
    undo: 'Undo',
    removed: 'Card moved to the bin.',
    restored: 'Card restored.',
    close: 'Close',
    save: 'Save',
    cancel: 'Cancel',
    fTextFa: 'Persian text',
    fTextEn: 'English text',
    fNoteFa: 'Persian note',
    fNoteEn: 'English note',
    fSource: 'Source',
    fTag: 'Tag',
    fBlock: 'Block',
    keys: 'Ctrl+Enter to save · Esc to cancel',
    needText: 'Write the card’s text in at least one language.',
    cardActions: 'Card actions',
    onlyOther: 'Written in Persian only',
    lastChange: 'Last change',
  },
} as const;

export type CanvasWords = (typeof CANVAS_WORDS)[CanvasLang];

/** A number in the shown language's digits. */
export const num = (n: number, lang: CanvasLang): string =>
  new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-GB').format(n);

/** A time in the shown language, in Tehran time as the rest of the console. */
export function at(iso: string, lang: CanvasLang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', {
    timeZone: 'Asia/Tehran',
    day: 'numeric',
    month: lang === 'fa' ? 'long' : 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * What a card says in the shown language: its text and note, and whether the
 * text had to come from the other language (a card written in one language
 * only), so the page can mark it.
 */
export function cardText(
  card: Pick<ConsoleCanvasCard, 'text_fa' | 'text_en' | 'note_fa' | 'note_en'>,
  lang: CanvasLang,
): { text: string; textLang: CanvasLang; note: string; noteLang: CanvasLang } {
  const other: CanvasLang = lang === 'fa' ? 'en' : 'fa';
  const own = lang === 'fa' ? card.text_fa : card.text_en;
  const ownNote = lang === 'fa' ? card.note_fa : card.note_en;
  const otherText = lang === 'fa' ? card.text_en : card.text_fa;
  const otherNote = lang === 'fa' ? card.note_en : card.note_fa;
  return {
    text: own !== '' ? own : otherText,
    textLang: own !== '' ? lang : other,
    note: ownNote !== '' ? ownNote : otherNote,
    noteLang: ownNote !== '' ? lang : other,
  };
}

/** A card's text cut for a history line, in the shown language or the other, with its language. */
export function cardLabel(
  event: Pick<ConsoleCanvasEvent, 'card_text_fa' | 'card_text_en'>,
  lang: CanvasLang,
): { text: string; lang: CanvasLang } {
  const shown = cardText(
    { text_fa: event.card_text_fa, text_en: event.card_text_en, note_fa: '', note_en: '' },
    lang,
  );
  return { text: cut(shown.text, 70), lang: shown.textLang };
}

/** The language a field is written in: the source is a path or an id, read left to right. */
export const fieldLang = (field: ConsoleCanvasField | null): CanvasLang =>
  field === 'text_fa' || field === 'note_fa' ? 'fa' : 'en';

export const cut = (text: string, size: number): string =>
  text.length <= size ? text : `${text.slice(0, size - 1).trimEnd()}…`;

const isBlock = (value: string | null): value is ConsoleCanvasBlock =>
  value !== null && (CONSOLE_CANVAS_BLOCKS as readonly string[]).includes(value);
const isTag = (value: string | null): value is ConsoleCanvasTag =>
  value !== null && value in TAG_WORDS;

/** What a change did, after its actor's name: «برچسب را از «فرض» به «ریسک» تغییر داد». */
export function historyWords(event: ConsoleCanvasEvent, lang: CanvasLang): string {
  const fa = lang === 'fa';
  const tag = (t: string | null) => (isTag(t) ? TAG_WORDS[t][lang] : (t ?? ''));
  switch (event.kind) {
    case 'created':
      return fa ? 'کارت را افزود' : 'added the card';
    case 'edited': {
      const field = event.field === null ? null : FIELD_WORDS[event.field][lang];
      return fa ? `${field ?? 'کارت'} را ویرایش کرد` : `edited ${field ?? 'the card'}`;
    }
    case 'tagged':
      return fa
        ? `برچسب را از «${tag(event.previous)}» به «${tag(event.next)}» تغییر داد`
        : `changed the tag from ${tag(event.previous)} to ${tag(event.next)}`;
    case 'moved':
      if (isBlock(event.previous) && isBlock(event.next))
        return fa
          ? `کارت را از «${blockName(event.previous, lang)}» به «${blockName(event.next, lang)}» برد`
          : `moved the card from ${blockName(event.previous, lang)} to ${blockName(event.next, lang)}`;
      return fa
        ? `جای کارت را از ${num(Number(event.previous), lang)} به ${num(Number(event.next), lang)} برد`
        : `moved the card from place ${event.previous ?? ''} to ${event.next ?? ''}`;
    case 'removed':
      return fa ? 'کارت را به سطل برد' : 'moved the card to the bin';
    case 'restored':
      return fa ? 'کارت را از سطل برگرداند' : 'restored the card from the bin';
  }
}

/** Counts of live cards by tag, for the filter chips. */
export function tagCounts(
  cards: readonly Pick<ConsoleCanvasCard, 'tag'>[],
): Record<ConsoleCanvasTag, number> {
  const counts: Record<ConsoleCanvasTag, number> = {
    validated: 0,
    assumption: 0,
    risk: 0,
    question: 0,
  };
  for (const card of cards) counts[card.tag] += 1;
  return counts;
}

/** The JSON a download holds: every live card in block order, with its source and tag. */
export function canvasJson(cards: readonly ConsoleCanvasCard[], exportedAt: string): string {
  return `${JSON.stringify(
    {
      canvas: 'Stadiomind business model canvas',
      exported_at: exportedAt,
      cards: cards.map((c) => ({
        block: c.block,
        position: c.position,
        tag: c.tag,
        text_fa: c.text_fa,
        text_en: c.text_en,
        note_fa: c.note_fa,
        note_en: c.note_en,
        source: c.source,
        last_change: c.last_change,
      })),
    },
    null,
    2,
  )}\n`;
}
