import type { ConsoleChecklist, ConsoleChecklistItem } from '@fmip/contracts';

/**
 * The pre-launch checklist's answer (T-1840, D-428) as the API sends it, cut
 * to two sections per list from the seed, with one item in every status,
 * every kind of assignee, a note and a history of each kind of change; for
 * `checklist.spec.tsx` and the Persian scan.
 */

const MOSTAFA = '11111111-1111-4111-8111-111111111111';
const MOHAMMAD = '22222222-2222-4222-8222-222222222222';
export const SECTION = {
  brand: 'aaaaaaaa-0000-4000-8000-000000000001',
  football: 'aaaaaaaa-0000-4000-8000-000000000002',
  feedback: 'bbbbbbbb-0000-4000-8000-000000000001',
  launch: 'bbbbbbbb-0000-4000-8000-000000000002',
};

let n = 0;
const item = (
  section_id: string,
  title: string,
  overrides: Partial<ConsoleChecklistItem> = {},
): ConsoleChecklistItem => {
  n += 1;
  return {
    id: `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`,
    section_id,
    position: n,
    title,
    status: 'not_started',
    assignee: null,
    updated_at: '2026-11-16T08:00:00.000Z',
    updated_by: null,
    notes: [],
    history: [],
    ...overrides,
  };
};

export const CHECKLIST: ConsoleChecklist = {
  people: [
    { id: MOSTAFA, username: 'mostafa', display_name: 'مصطفی', owner: true, enabled: true },
    { id: MOHAMMAD, username: 'mohammad', display_name: 'محمد', owner: false, enabled: true },
  ],
  sections: [
    {
      id: SECTION.brand,
      list: 'friends',
      position: 1,
      title: 'برند و راه‌اندازی وب‌سایت',
      items: [
        item(SECTION.brand, 'نهایی‌سازی و اضافه‌کردن لوگوی رسمی', {
          status: 'in_progress',
          assignee: MOSTAFA,
          updated_by: 'مصطفی',
          notes: [
            {
              id: 'dddddddd-0000-4000-8000-000000000001',
              author: 'محمد',
              body: 'طرح اولیه آماده است.\nمنتظر نظر نگهدارنده.',
              created_at: '2026-11-16T09:00:00.000Z',
            },
          ],
          history: [
            {
              kind: 'status',
              actor: 'مصطفی',
              previous: 'not_started',
              next: 'in_progress',
              created_at: '2026-11-16T08:00:00.000Z',
            },
            {
              kind: 'assigned',
              actor: 'مصطفی',
              previous: null,
              next: MOSTAFA,
              created_at: '2026-11-16T08:01:00.000Z',
            },
            {
              kind: 'retitled',
              actor: 'محمد',
              previous: 'لوگو',
              next: 'نهایی‌سازی و اضافه‌کردن لوگوی رسمی',
              created_at: '2026-11-16T08:02:00.000Z',
            },
            {
              kind: 'sectioned',
              actor: 'محمد',
              previous: SECTION.launch,
              next: SECTION.brand,
              created_at: '2026-11-16T08:03:00.000Z',
            },
            {
              kind: 'moved',
              actor: 'محمد',
              previous: '3',
              next: '1',
              created_at: '2026-11-16T08:04:00.000Z',
            },
          ],
        }),
        item(SECTION.brand, 'نهایی‌سازی و اضافه‌کردن شعار برند', {
          status: 'blocked',
          assignee: 'agents',
        }),
        item(SECTION.brand, 'اتصال دامنه رسمی برند به وب‌سایت و آزمایش کامل آن', {
          status: 'done',
          assignee: MOHAMMAD,
        }),
      ],
    },
    {
      id: SECTION.football,
      list: 'friends',
      position: 2,
      title: 'اطلاعات فوتبال و امکانات مسابقات',
      items: [
        item(SECTION.football, 'نمایش دقیق اطلاعات بازیکنان مصدوم و محروم', {
          status: 'not_needed',
        }),
        item(
          SECTION.football,
          'نمایش آمار کامل زنده مسابقات، شامل تعداد شوت‌ها، شوت‌های داخل چارچوب، مالکیت توپ، کرنرها و گل مورد انتظار (xG)، در صورت موجود بودن',
        ),
      ],
    },
    {
      id: SECTION.feedback,
      list: 'public',
      position: 1,
      title: 'بازخورد و آزمایش نهایی',
      items: [item(SECTION.feedback, 'آزمایش مجدد تمام قابلیت‌هایی که اصلاح شده‌اند')],
    },
    {
      id: SECTION.launch,
      list: 'public',
      position: 8,
      title: 'تأیید نهایی راه‌اندازی',
      items: [],
    },
  ],
};
