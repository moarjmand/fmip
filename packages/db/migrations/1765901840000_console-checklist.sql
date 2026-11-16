-- Up Migration

-- ---------------------------------------------------------------------------
-- The agents console's pre-launch checklist (T-1840, D-428): two lists, the
-- family-and-friends launch and the public launch, each in sections; every
-- item with its status, who must do it and the notes on it, kept by the two
-- console accounts.
--
-- `console_checklist_section`: a heading inside one of the two lists
-- (`friends`, `public`); the lists themselves are fixed and named by the web.
--
-- `console_checklist_item`: one thing to do. Assigned to a console account,
-- to the agents' team (`assigned_agents`), or to nobody -- never two. A
-- removed item keeps its row (`deleted_at`) so its history and the audit
-- trail's target still exist; nothing shows it again.
--
-- `console_checklist_note`: several notes per item, each with its author and
-- time. Immutable.
--
-- `console_checklist_event`: who changed what on an item and when, with the
-- value before and after. Immutable. Every change is also a `console_audit`
-- row (rule 10).
--
-- The seed below is the maintainer's two lists of 2026-11-16, verbatim;
-- every item starts `not_started` and unassigned. New tables only; nothing
-- to backfill.
-- ---------------------------------------------------------------------------

CREATE TABLE console_checklist_section (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list        text NOT NULL,
  position    integer NOT NULL,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_checklist_section_list CHECK (list IN ('friends', 'public')),
  CONSTRAINT console_checklist_section_title CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  CONSTRAINT console_checklist_section_place UNIQUE (list, position)
);

COMMENT ON TABLE console_checklist_section IS
  'A heading of the agents console''s pre-launch checklist (T-1840, D-428), in the friends or the public list.';

CREATE TABLE console_checklist_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id       uuid NOT NULL REFERENCES console_checklist_section (id) ON DELETE RESTRICT,
  position         integer NOT NULL,
  title            text NOT NULL,
  status           text NOT NULL DEFAULT 'not_started',
  assignee_id      uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  assigned_agents  boolean NOT NULL DEFAULT false,
  -- NULL is the seed; a person's item names who added it.
  created_by       uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  updated_by       uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT console_checklist_item_title CHECK (btrim(title) <> '' AND char_length(title) <= 500),
  CONSTRAINT console_checklist_item_status CHECK (
    status IN ('not_started', 'in_progress', 'blocked', 'done', 'not_needed')
  ),
  CONSTRAINT console_checklist_item_one_assignee CHECK (
    NOT (assigned_agents AND assignee_id IS NOT NULL)
  )
);

-- What the page reads: the live items of each section in order.
CREATE INDEX console_checklist_item_live ON console_checklist_item (section_id, position)
  WHERE deleted_at IS NULL;

CREATE TRIGGER console_checklist_item_updated_at
  BEFORE UPDATE ON console_checklist_item FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE console_checklist_item IS
  'An item of the agents console''s pre-launch checklist (T-1840, D-428): status, assignee (a console account, the agents'' team or nobody); every change audited in console_audit.';

CREATE TABLE console_checklist_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES console_checklist_item (id) ON DELETE RESTRICT,
  author_id   uuid NOT NULL REFERENCES console_user (id) ON DELETE RESTRICT,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_checklist_note_body CHECK (btrim(body) <> '' AND char_length(body) <= 2000)
);

CREATE INDEX console_checklist_note_item ON console_checklist_note (item_id, created_at, id);
-- A person's writes this hour, for the ceiling.
CREATE INDEX console_checklist_note_author ON console_checklist_note (author_id, created_at);

CREATE TRIGGER console_checklist_note_immutable
  BEFORE UPDATE OR DELETE ON console_checklist_note FOR EACH ROW EXECUTE FUNCTION refuse_change();

COMMENT ON TABLE console_checklist_note IS
  'Notes on a pre-launch checklist item (T-1840, D-428), each with its author and time. Immutable.';

CREATE TABLE console_checklist_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES console_checklist_item (id) ON DELETE RESTRICT,
  actor_id    uuid NOT NULL REFERENCES console_user (id) ON DELETE RESTRICT,
  kind        text NOT NULL,
  -- The value before and after: a status key, `agents` or a console user's
  -- id for the assignee, a title, a section id, a position; NULL is none.
  previous    text,
  next        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_checklist_event_kind CHECK (
    kind IN ('created', 'retitled', 'sectioned', 'status', 'assigned', 'moved', 'removed')
  ),
  CONSTRAINT console_checklist_event_values CHECK (
    (previous IS NULL OR char_length(previous) <= 500) AND (next IS NULL OR char_length(next) <= 500)
  )
);

-- An item's history, oldest first.
CREATE INDEX console_checklist_event_item ON console_checklist_event (item_id, created_at, id);
-- A person's changes this hour, for the ceiling.
CREATE INDEX console_checklist_event_actor ON console_checklist_event (actor_id, created_at);

CREATE TRIGGER console_checklist_event_immutable
  BEFORE UPDATE OR DELETE ON console_checklist_event FOR EACH ROW EXECUTE FUNCTION refuse_change();

COMMENT ON TABLE console_checklist_event IS
  'Who changed what on a pre-launch checklist item and when, before and after (T-1840, D-428). Immutable.';

-- The ceiling (D-103's inventory): 300 checklist writes an hour per console
-- account (changes and notes), counted by the API from the person's own
-- events and notes in the clock hour, before the write. Two people working
-- through a list click a status or an assignee often; a stuck page or a
-- script would pass 300.
INSERT INTO rate_limit (action, per_hour) VALUES ('console_checklist', 300)
ON CONFLICT (action) DO NOTHING;

-- The maintainer's two lists, verbatim (2026-11-16).
INSERT INTO console_checklist_section (list, position, title) VALUES
  ('friends', 1, 'برند و راه‌اندازی وب‌سایت'),
  ('friends', 2, 'اطلاعات فوتبال و امکانات مسابقات'),
  ('friends', 3, 'حساب‌های کاربری و پیش‌بینی‌ها'),
  ('friends', 4, 'دوستان، گروه‌ها و گفت‌وگوها'),
  ('friends', 5, 'مدیریت وب‌سایت'),
  ('friends', 6, 'ناوبری و آزمایش نهایی'),
  ('public', 1, 'بازخورد و آزمایش نهایی'),
  ('public', 2, 'داده‌ها و محتوای زمان راه‌اندازی'),
  ('public', 3, 'امتیازها، جامعه کاربران و جوایز'),
  ('public', 4, 'ارتباطات و تبلیغات'),
  ('public', 5, 'عملکرد و آمادگی فنی'),
  ('public', 6, 'موتورهای جست‌وجو و اشتراک‌گذاری'),
  ('public', 7, 'سیاست‌ها و پشتیبانی کاربران'),
  ('public', 8, 'تأیید نهایی راه‌اندازی');

INSERT INTO console_checklist_item (section_id, position, title)
SELECT s.id, v.position, v.title
  FROM (VALUES
    ('friends', 1, 1, 'نهایی‌سازی و اضافه‌کردن لوگوی رسمی'),
    ('friends', 1, 2, 'نهایی‌سازی و اضافه‌کردن شعار برند'),
    ('friends', 1, 3, 'اتصال دامنه رسمی برند به وب‌سایت و آزمایش کامل آن'),
    ('friends', 2, 1, 'نمایش صحیح ترکیب رسمی تیم‌ها به محض در دسترس قرار گرفتن'),
    ('friends', 2, 2, 'نمایش ترکیب پیش‌بینی‌شده پیش از انتشار ترکیب رسمی'),
    ('friends', 2, 3, 'نمایش دقیق اطلاعات بازیکنان مصدوم و محروم'),
    ('friends', 2, 4, 'نمایش آمار کامل زنده مسابقات، شامل تعداد شوت‌ها، شوت‌های داخل چارچوب، مالکیت توپ، کرنرها و گل مورد انتظار (xG)، در صورت موجود بودن'),
    ('friends', 2, 5, 'بررسی فهرست کامل رقابت‌ها و لیگ‌های تحت پوشش وب‌سایت'),
    ('friends', 2, 6, 'اطمینان از نمایش اطلاعات صحیح و کامل برای تمام رقابت‌های تحت پوشش'),
    ('friends', 2, 7, 'بررسی صحت جدول‌ها، بازی‌های آینده، نتایج و انتخاب هفته مسابقات در صفحات اصلی رقابت‌ها'),
    ('friends', 3, 1, 'آزمایش ثبت‌نام، ورود و خروج از حساب کاربری'),
    ('friends', 3, 2, 'آزمایش تأیید نشانی ایمیل'),
    ('friends', 3, 3, 'آزمایش بازیابی و تغییر رمز عبور'),
    ('friends', 3, 4, 'آزمایش سوابق و نتایج پیش‌بینی‌های کاربران'),
    ('friends', 3, 5, 'آزمایش امتیاز کاربران و جدول‌های رتبه‌بندی'),
    ('friends', 4, 1, 'آزمایش افزودن و حذف دوستان'),
    ('friends', 4, 2, 'آزمایش ایجاد گروه خصوصی، عضویت در آن و خروج از آن'),
    ('friends', 4, 3, 'آزمایش گفت‌وگوهای گروه‌های خصوصی'),
    ('friends', 4, 4, 'آزمایش گفت‌وگوی عمومی مربوط به مسابقات'),
    ('friends', 4, 5, 'اطمینان از امکان گزارش‌کردن، مسدودکردن و بی‌صداکردن سایر کاربران'),
    ('friends', 5, 1, 'آزمایش ابزارهای مدیریتی برای حذف پست‌ها، پیام‌ها و سایر محتواها'),
    ('friends', 5, 2, 'آزمایش ابزارهای مدیریتی برای اخطار، تعلیق و مسدودکردن حساب‌های کاربری'),
    ('friends', 6, 1, 'آزمایش منوی اصلی، جست‌وجو، فیلترها و دکمه‌های بازگشت'),
    ('friends', 6, 2, 'حذف تمام محتوای آزمایشی، یادداشت‌های داخلی، برچسب‌های API و بخش‌های ناتمام'),
    ('friends', 6, 3, 'اضافه‌کردن بخش مشخصی برای دریافت بازخورد آزمایش‌کنندگان'),
    ('friends', 6, 4, 'آزمایش وب‌سایت در تلفن‌های همراه، تبلت‌ها و رایانه‌های مختلف'),
    ('friends', 6, 5, 'آزمایش وب‌سایت در مرورگرهای گوگل کروم، سافاری، فایرفاکس و مایکروسافت اج'),
    ('friends', 6, 6, 'شناسایی و برطرف‌کردن تمام خطاهای واضح و بحرانی پیش از دعوت خانواده و دوستان'),
    ('public', 1, 1, 'بررسی تمام بازخوردهای دریافت‌شده از خانواده، دوستان و تحلیل‌گر فوتبال'),
    ('public', 1, 2, 'برطرف‌کردن تمام مشکلات بحرانی و مهم شناسایی‌شده در مرحله آزمایش'),
    ('public', 1, 3, 'آزمایش مجدد تمام قابلیت‌هایی که اصلاح شده‌اند'),
    ('public', 1, 4, 'انجام آزمایش کامل رگرسیون برای اطمینان از اینکه اصلاحات باعث ایجاد مشکلات جدید نشده‌اند'),
    ('public', 2, 1, 'تأیید فعال‌بودن تمام اشتراک‌های موردنیاز ارائه‌دهندگان داده و عملکرد صحیح آن‌ها'),
    ('public', 2, 2, 'اطمینان از مدیریت صحیح داده‌های ناموجود یا دریافت‌نشده از ارائه‌دهندگان'),
    ('public', 2, 3, 'تأیید به‌روز بودن برنامه مسابقات، نتایج، جدول‌ها، فهرست بازیکنان، مصدومیت‌ها، محرومیت‌ها و سایر اطلاعات فوتبال'),
    ('public', 2, 4, 'آماده‌کردن تحلیل‌های اختصاصی برای مسابقات مهمی که هم‌زمان با راه‌اندازی برگزار می‌شوند'),
    ('public', 2, 5, 'تأیید رسمی، دقیق و فعال‌بودن تمام لینک‌های خلاصه مسابقات'),
    ('public', 3, 1, 'اطمینان از اینکه امتیاز کاربران و جدول‌های رتبه‌بندی به‌آسانی قابل دستکاری نیستند'),
    ('public', 3, 2, 'انتشار قوانین روشن برای جامعه کاربران'),
    ('public', 3, 3, 'تدوین قوانین اعطا، بازبینی و لغو امتیازات و دسترسی‌های ویژه کاربران دارای رتبه بالا'),
    ('public', 3, 4, 'نهایی‌کردن قوانین، شرایط شرکت و روش انتخاب برندگان برای هرگونه جایزه یا رقابت'),
    ('public', 4, 1, 'ایجاد نشانی‌های ایمیل رسمی برای تماس و پشتیبانی'),
    ('public', 4, 2, 'آماده‌کردن طرح‌های گرافیکی شبکه‌های اجتماعی و اطلاعیه‌های راه‌اندازی'),
    ('public', 4, 3, 'زمان‌بندی محتوای راه‌اندازی و فعالیت‌های تبلیغاتی'),
    ('public', 5, 1, 'آزمایش وب‌سایت با تعداد واقع‌بینانه‌ای از کاربران هم‌زمان'),
    ('public', 5, 2, 'بهبود سرعت صفحات کند'),
    ('public', 5, 3, 'بهینه‌سازی تصاویر حجیم'),
    ('public', 5, 4, 'حذف درخواست‌های غیرضروری API'),
    ('public', 5, 5, 'تهیه برنامه بازیابی و بازگشت به نسخه قبلی در صورت بروز شکست یا مشکل جدی هنگام راه‌اندازی عمومی'),
    ('public', 6, 1, 'اضافه‌کردن تصاویر مناسب و فراداده‌های لازم برای اشتراک‌گذاری صفحات در شبکه‌های اجتماعی'),
    ('public', 6, 2, 'اضافه‌کردن داده‌های ساختاریافته مناسب برای خبرها و رویدادهای ورزشی'),
    ('public', 7, 1, 'انتشار سیاست حفظ حریم خصوصی'),
    ('public', 7, 2, 'انتشار سیاست استفاده از کوکی‌ها'),
    ('public', 7, 3, 'انتشار شرایط استفاده از وب‌سایت'),
    ('public', 7, 4, 'توضیح روشن درباره نحوه جمع‌آوری و استفاده از داده‌های کاربران، پیش‌بینی‌ها، امتیازها و پیام‌های گفت‌وگو'),
    ('public', 7, 5, 'ایجاد بخش‌های تماس، راهنما و پرسش‌های متداول'),
    ('public', 8, 1, 'انجام یک بررسی نهایی از تمام گزینه‌های منو و صفحات اصلی وب‌سایت'),
    ('public', 8, 2, 'اطمینان از اینکه هیچ قابلیت ناتمام، موقت یا آزمایشی برای عموم قابل مشاهده نیست'),
    ('public', 8, 3, 'تأیید راه‌اندازی عمومی فقط زمانی که هیچ مشکل بحرانی یا مهم حل‌نشده‌ای باقی نمانده باشد')
  ) AS v(list, section, position, title)
  JOIN console_checklist_section s ON s.list = v.list AND s.position = v.section;

-- Down Migration

DELETE FROM rate_limit WHERE action = 'console_checklist';
DROP TABLE console_checklist_event;
DROP TABLE console_checklist_note;
DROP TABLE console_checklist_item;
DROP TABLE console_checklist_section;
