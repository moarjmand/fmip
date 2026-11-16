import type { ConsoleCanvas, ConsoleCanvasCard, ConsoleCanvasEvent } from '@fmip/contracts';

/**
 * The business model canvas's answer (T-1855, D-440) as the API sends it:
 * a few of the seed's cards (one of every tag, in four blocks, verbatim), a
 * card written in English only, one a person changed, a removed card in the
 * bin, and a history with every kind of change; for `canvas.spec.tsx` and
 * the Persian scan.
 */

let n = 0;
const card = (overrides: Partial<ConsoleCanvasCard>): ConsoleCanvasCard => {
  n += 1;
  return {
    id: `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`,
    block: 'customer_segments',
    position: 1,
    tag: 'assumption',
    text_fa: '',
    text_en: '',
    note_fa: '',
    note_en: '',
    source: '',
    created_at: '2026-11-16T08:00:00.000Z',
    last_change: null,
    removed_at: null,
    removed_by: null,
    ...overrides,
  };
};

export const SEGMENT = card({
  block: 'customer_segments',
  position: 1,
  tag: 'assumption',
  text_fa: 'هواداران فارسی‌زبان فوتبال که کانال تلگرام را می‌خوانند (ایران و خارج از ایران)',
  text_en: 'Persian-speaking football fans who read the Telegram channel (in Iran and abroad)',
  note_fa: 'کانال فعال است ولی شمار خواننده‌ها ذخیره نمی‌شود؛ فرضیه برای آزمون، نه ادعا.',
  note_en:
    'The channel is active but its reach is not recorded; a hypothesis to test, not a claim.',
  source: 'ops/reports/marketing-manager/2026-11-09.md (Audience)',
});

/** Written in English only: the Persian view shows the English with a marker. */
export const ENGLISH_ONLY = card({
  block: 'customer_segments',
  position: 2,
  tag: 'question',
  text_en: 'Club analysts who want shot maps',
  note_en: 'Asked by the teammate; not measured.',
  last_change: { actor: 'محمد', at: '2026-11-16T10:30:00.000Z' },
});

export const PARTNER = card({
  block: 'key_partners',
  position: 1,
  tag: 'validated',
  text_fa: 'API-Football، پلن Ultra: منبع دارای مجوز داده‌ی فوتبال در مسیر بحرانی',
  text_en: 'API-Football, Ultra plan: the licensed football data source on the critical path',
  note_fa: '۷۵٬۰۰۰ درخواست در روز. فروش دوباره‌ی داده ممنوع.',
  note_en: '75,000 requests a day. Data resale forbidden.',
  source: 'D-014 · D-076 · D-197 · ops/licences.md §1',
  last_change: { actor: 'مصطفی', at: '2026-11-16T11:00:00.000Z' },
});

export const RISK = card({
  block: 'key_partners',
  position: 2,
  tag: 'risk',
  text_fa: 'خبرخوان‌ها و منابع خبری',
  text_en: 'News feeds and sources',
  note_fa: 'مجوز تصویر هر منبع جدا بررسی می‌شود.',
  note_en: 'Each source’s image licence is checked separately.',
  source: 'ops/licences.md §4',
});

export const COST = card({
  block: 'cost_structure',
  position: 1,
  tag: 'question',
  text_fa: 'زمان بنیان‌گذار و اشتراک ابزارهای هوش مصنوعی: حساب نشده',
  text_en: "The founder's time and the AI tooling subscription: not costed",
  source: 'CLAUDE.md §3',
});

export const REMOVED = card({
  block: 'channels',
  position: 3,
  tag: 'assumption',
  text_fa: 'کارت حذف‌شده‌ی آزمایشی',
  text_en: 'A removed test card',
  last_change: { actor: 'مصطفی', at: '2026-11-16T12:00:00.000Z' },
  removed_at: '2026-11-16T12:00:00.000Z',
  removed_by: 'مصطفی',
});

const event = (
  kind: ConsoleCanvasEvent['kind'],
  of: ConsoleCanvasCard,
  minute: number,
  extra: Partial<ConsoleCanvasEvent> = {},
): ConsoleCanvasEvent => ({
  id: `eeeeeeee-0000-4000-8000-${String(minute).padStart(12, '0')}`,
  card_id: of.id,
  kind,
  field: null,
  actor: 'مصطفی',
  previous: null,
  next: null,
  created_at: `2026-11-16T${String(10 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00.000Z`,
  card_text_fa: of.text_fa,
  card_text_en: of.text_en,
  ...extra,
});

/** Newest first, as the API sends it. */
const HISTORY: ConsoleCanvasEvent[] = [
  event('restored', REMOVED, 59),
  event('removed', REMOVED, 58),
  event('moved', PARTNER, 50, { previous: '2', next: '1' }),
  event('moved', REMOVED, 45, { previous: 'customer_segments', next: 'channels' }),
  event('tagged', PARTNER, 40, { previous: 'assumption', next: 'validated' }),
  event('edited', PARTNER, 35, {
    field: 'note_fa',
    previous: '',
    next: '۷۵٬۰۰۰ درخواست در روز. فروش دوباره‌ی داده ممنوع.',
  }),
  event('edited', ENGLISH_ONLY, 30, {
    actor: 'محمد',
    field: 'text_en',
    previous: 'Analysts',
    next: 'Club analysts who want shot maps',
  }),
  event('created', ENGLISH_ONLY, 20, { actor: 'محمد', next: 'Analysts' }),
];

export const CANVAS: ConsoleCanvas = {
  cards: [SEGMENT, ENGLISH_ONLY, PARTNER, RISK, COST],
  removed: [REMOVED],
  history: HISTORY,
  people: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'mostafa',
      display_name: 'مصطفی',
      owner: true,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      username: 'mohammad',
      display_name: 'محمد',
      owner: false,
    },
  ],
};
