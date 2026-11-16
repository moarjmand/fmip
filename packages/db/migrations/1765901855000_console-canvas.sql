-- Up Migration

-- ---------------------------------------------------------------------------
-- The agents console's business model canvas (T-1855, D-440): nine fixed
-- blocks, each with its cards in order; every card in Persian and English,
-- with a tag, a note in each language and the source it came from, kept by
-- the two console accounts.
--
-- `console_canvas_card`: one card. Its block is one of the nine fixed blocks
-- (named by the web); its `position` orders it inside the block. At least
-- one of its two texts is written. A removed card keeps its row
-- (`deleted_at`, `deleted_by`) so the bin can restore it and its history and
-- the audit trail's target still exist.
--
-- `console_canvas_event`: who changed what on a card and when, with the
-- value before and after (the field for an edit). Immutable. Every change is
-- also a `console_audit` row with the whole card before and after (rule 10).
--
-- The seed below is the claude.ai artifact's 55 cards as they stood on
-- 2026-11-16, verbatim (`E:/FMIP/ops/business/business-model-canvas/
-- seed-cards.json`), in the file's order inside each block; nobody wrote
-- them in the console, so `created_by` is NULL and they have no event row.
-- New tables only; nothing to backfill.
-- ---------------------------------------------------------------------------

CREATE TABLE console_canvas_card (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block       text NOT NULL,
  position    integer NOT NULL,
  tag         text NOT NULL,
  text_fa     text NOT NULL DEFAULT '',
  text_en     text NOT NULL DEFAULT '',
  note_fa     text NOT NULL DEFAULT '',
  note_en     text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT '',
  -- NULL is the seed; a person's card names who added it.
  created_by  uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  updated_by  uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  deleted_by  uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  CONSTRAINT console_canvas_card_block CHECK (
    block IN (
      'key_partners', 'key_activities', 'key_resources', 'value_propositions',
      'customer_relationships', 'channels', 'customer_segments', 'cost_structure',
      'revenue_streams'
    )
  ),
  CONSTRAINT console_canvas_card_tag CHECK (tag IN ('validated', 'assumption', 'risk', 'question')),
  CONSTRAINT console_canvas_card_text CHECK (btrim(text_fa) <> '' OR btrim(text_en) <> ''),
  CONSTRAINT console_canvas_card_lengths CHECK (
    char_length(text_fa) <= 500 AND char_length(text_en) <= 500
    AND char_length(note_fa) <= 1000 AND char_length(note_en) <= 1000
    AND char_length(source) <= 300
  ),
  CONSTRAINT console_canvas_card_removal CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

-- What the page reads: the live cards of each block in order.
CREATE INDEX console_canvas_card_live ON console_canvas_card (block, position)
  WHERE deleted_at IS NULL;
-- The bin, newest removal first.
CREATE INDEX console_canvas_card_removed ON console_canvas_card (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TRIGGER console_canvas_card_updated_at
  BEFORE UPDATE ON console_canvas_card FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE console_canvas_card IS
  'A card of the agents console''s business model canvas (T-1855, D-440): block, place, tag, Persian and English text and note, source; removal kept and restorable; every change audited in console_audit.';

CREATE TABLE console_canvas_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     uuid NOT NULL REFERENCES console_canvas_card (id) ON DELETE RESTRICT,
  actor_id    uuid NOT NULL REFERENCES console_user (id) ON DELETE RESTRICT,
  kind        text NOT NULL,
  -- The edited field, for `edited` only.
  field       text,
  -- The value before and after: a text, a tag, a block, a place in the
  -- block (`moved` inside a block is two numbers); NULL is none.
  previous    text,
  next        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_canvas_event_kind CHECK (
    kind IN ('created', 'edited', 'tagged', 'moved', 'removed', 'restored')
  ),
  CONSTRAINT console_canvas_event_field CHECK (
    (kind = 'edited') = (field IS NOT NULL)
    AND (field IS NULL OR field IN ('text_fa', 'text_en', 'note_fa', 'note_en', 'source'))
  ),
  CONSTRAINT console_canvas_event_values CHECK (
    (previous IS NULL OR char_length(previous) <= 1000) AND (next IS NULL OR char_length(next) <= 1000)
  )
);

-- A card's history, oldest first.
CREATE INDEX console_canvas_event_card ON console_canvas_event (card_id, created_at, id);
-- The canvas's history, newest first (the page reads the newest 100).
CREATE INDEX console_canvas_event_newest ON console_canvas_event (created_at DESC, id DESC);
-- A person's changes this hour, for the ceiling.
CREATE INDEX console_canvas_event_actor ON console_canvas_event (actor_id, created_at);

CREATE TRIGGER console_canvas_event_immutable
  BEFORE UPDATE OR DELETE ON console_canvas_event FOR EACH ROW EXECUTE FUNCTION refuse_change();

COMMENT ON TABLE console_canvas_event IS
  'Who changed what on a business model canvas card and when, before and after (T-1855, D-440). Immutable.';

-- The ceiling (D-103's inventory): 300 canvas changes an hour per console
-- account, counted by the API from the person's own events in the clock
-- hour, before the write. Two people working through the canvas edit, tag
-- and move often; a stuck page or a script would pass 300.
INSERT INTO rate_limit (action, per_hour) VALUES ('console_canvas', 300)
ON CONFLICT (action) DO NOTHING;

-- The artifact's 55 cards, verbatim (2026-11-16), generated from
-- seed-cards.json: block ids mapped to the table's names, `position` the
-- card's order inside its block in the file.
INSERT INTO console_canvas_card (block, position, tag, text_fa, text_en, note_fa, note_en, source) VALUES
  ('customer_segments', 1, 'assumption',
   'هواداران فارسی‌زبان فوتبال که کانال تلگرام را می‌خوانند (ایران و خارج از ایران)',
   'Persian-speaking football fans who read the Telegram channel (in Iran and abroad)',
   'کانال فعال است ولی شمار خواننده‌ها ذخیره نمی‌شود؛ فرضیه برای آزمون، نه ادعا.',
   'The channel is active but its reach is not recorded; a hypothesis to test, not a claim.',
   'ops/reports/marketing-manager/2026-11-09.md (Audience)'),
  ('customer_segments', 2, 'assumption',
   'خوانندهٔ انگلیسی‌زبان در بریتانیا و اروپا که یک بازی مشخص را جست‌وجو می‌کند',
   'English readers in the UK and Europe searching for a specific match',
   'سایت انگلیسی با ترتیب رقابت‌ها و ساعت بریتانیا ساخته شده؛ هنوز در جست‌وجو دیده نمی‌شود.',
   'The English site has its own competition order and UK time; it is not yet visible in search.',
   'D-207 · ops/reports/marketing-manager/2026-11-16.md'),
  ('customer_segments', 3, 'assumption',
   'هوادار پیش‌بینی‌کننده که امتیاز و رتبهٔ به‌دست‌آمده می‌خواهد',
   'Fans who predict matches and want an earned rating',
   'تا امروز ۹ پیش‌بینی، همه از یک عضو؛ آخرینش 2026-10-09.',
   'So far 9 predictions, all from one member; the last on 2026-10-09.',
   'ops/reports/marketing-manager/2026-11-16.md · blueprint §9'),
  ('customer_segments', 4, 'assumption',
   'هوادار داده‌محور که دقت مدل و تحلیل آماری برایش مهم است',
   'Data-minded fans who care about model accuracy and statistical analysis',
   'سلیقهٔ Sofascore و Opta در طراحی؛ اندازه و تمایل این گروه سنجیده نشده.',
   'Sofascore and Opta taste in the design; size and appetite of this group not measured.',
   'memory: design-brief-2026-10-24 · blueprint §1.4'),
  ('customer_segments', 5, 'question',
   'کدام گروه حاضر است پول بدهد، و برای چه؟',
   'Which segment would pay, and for what?',
   'هیچ گروه پرداخت‌کننده‌ای شناسایی یا آزموده نشده.',
   'No paying segment has been identified or tested.',
   'no source: open'),
  ('value_propositions', 1, 'assumption',
   '«مدل پیش‌بینی‌ای که کارنامه‌اش را علنی نشان می‌دهد»: دقت مدل، بازی به بازی، در صفحهٔ عمومی',
   '"A forecast model that shows its record in public": the model''s accuracy, match by match, on a public page',
   'جملهٔ برند پذیرفته شده (D-421)؛ اینکه برای مخاطب ارزش دارد هنوز سنجیده نشده.',
   'The brand line is accepted (D-421); whether readers value it is not yet measured.',
   'D-421 · /model-accuracy'),
  ('value_propositions', 2, 'assumption',
   'سه پیش‌بینی جدا و هرگز درهم‌نشده: مدل آماری، تحلیل بنیان‌گذار، نظر جمع',
   'Three separate predictions, never blended: the statistical model, the founder''s analysis, the community',
   'قول اصلی محصول و قاعدهٔ ۶؛ به‌عنوان مزیت رقابتی آزموده نشده.',
   'A core product promise and rule 6; untested as a competitive edge.',
   'blueprint: Core product promise · CLAUDE.md rule 6'),
  ('value_propositions', 3, 'validated',
   'دادهٔ صادق: تازگی و پوشش هر بخش نشان داده می‌شود و هیچ رقمی ساخته نمی‌شود',
   'Honest data: every module shows its freshness and coverage, and no figure is invented',
   'در محصول ساخته و اجرا شده؛ ارزشش برای کاربر سنجیده نشده.',
   'Built and enforced in the product; its value to readers is not measured.',
   'blueprint §1.2 · CLAUDE.md rules 3-4'),
  ('value_propositions', 4, 'validated',
   'یک صفحهٔ بازی برای پیش، حین و پس از بازی: ترکیب، رویدادها، آمار، پیش‌بینی',
   'One match page before, during and after the game: line-ups, events, stats, forecasts',
   'مرکز بازی Stadiomind روی سایت زنده است.',
   'The Stadiomind match centre is live on the site.',
   'blueprint §1.1 · D-272'),
  ('value_propositions', 5, 'assumption',
   'هوش فوتبالی فارسی‌محور برای هواداران ایرانی، در کنار نسخهٔ انگلیسی برای بریتانیا و اروپا',
   'Persian-first football intelligence for Iranian fans, beside an English edition for the UK and Europe',
   'دو زبان فعال؛ بلوپرینت هشت زبان می‌خواهد که بقیه در فاز ۴ است.',
   'Two languages live; the blueprint asks for eight, the rest are Phase 4.',
   'D-207 · blueprint §13 · roadmap Phase 4'),
  ('value_propositions', 6, 'assumption',
   'اعتبار به‌دست‌آمده: رتبهٔ عملکرد فقط از پیش‌بینی‌های تسویه‌شده، نه از دنبال‌کننده',
   'Earned reputation: a Performance Rating from settled predictions only, never from followers',
   'ساخته شده؛ با ۳ عضو هنوز نمونه‌ای برای سنجیدنش نیست.',
   'Built; with 3 members there is no sample to judge it yet.',
   'blueprint §1.5, §9.1 · CLAUDE.md rule 8'),
  ('channels', 1, 'validated',
   'وب‌سایت قابل نصب (PWA) به فارسی و انگلیسی؛ اپ بومی فعلاً نه',
   'Installable website (PWA) in Persian and English; no native app for now',
   'دامنه هنوز traveltohormuz.ir است تا stadiomind.com خریده شود.',
   'The domain stays traveltohormuz.ir until stadiomind.com is bought.',
   'D-084 · D-262'),
  ('channels', 2, 'validated',
   'کانال تلگرام: پیش‌بینی روز، نتایج دیروز، دقت هفتگی، خودکار',
   'Telegram channel: the day''s forecasts, yesterday''s results, weekly accuracy, automatic',
   'در ۲۸ روز: ۲۷ پیش‌بینی، ۲۵ نتیجه، ۲ دقت هفتگی. شمار دیده‌شدن ذخیره نمی‌شود.',
   'In 28 days: 27 forecast, 25 results, 2 weekly-accuracy posts. Reach is not recorded.',
   'ops/reports/marketing-manager/2026-11-16.md'),
  ('channels', 3, 'risk',
   'جست‌وجوی گوگل و پاسخ‌های هوش مصنوعی',
   'Google search and AI answers',
   '«Stadiomind» و صفحه‌های بازی در جست‌وجو پیدا نشدند؛ Search Console منتظر حساب گوگل است.',
   '"Stadiomind" and match pages were not found in search; Search Console waits on a Google account.',
   'ops/marketing/keywords.md · d-2026-11-16-02'),
  ('channels', 4, 'assumption',
   'X و Instagram به انگلیسی، ۳ تا ۵ پست در روز، با صف تأیید در کنسول و انتشار از راه Buffer',
   'X and Instagram in English, 3-5 posts a day, through an approval queue and published via Buffer',
   'طراحی پذیرفته شده (D-427)؛ حساب‌ها هنوز باز نشده‌اند.',
   'Design accepted (D-427); the accounts are not opened yet.',
   'D-427 · ops/reports/business-adviser/2026-11-14-social-publishing-options-fa.md'),
  ('channels', 5, 'validated',
   'کارت اشتراک برند روی هر صفحه برای پخش لینک‌ها',
   'A brand share card on every page so shared links carry the name',
   'og:image روی هر ۱۲ صفحهٔ بررسی‌شده.',
   'og:image on all 12 pages checked.',
   'D-419 · ops/reports/marketing-manager/2026-11-16.md'),
  ('channels', 6, 'validated',
   'تبلیغ پولی: فعلاً نه',
   'Paid advertising: not for now',
   'در برنامهٔ بازاریابی رد شده است.',
   'Rejected in the marketing plan.',
   'ops/reports/marketing-manager/2026-11-16.md (Channels)'),
  ('customer_relationships', 1, 'validated',
   'سلف‌سرویس رایگان: حساب، پیش‌بینی، دنبال‌کردن تیم، اعلان',
   'Free self-service: account, predictions, following teams, notifications',
   'همه ساخته شده‌اند.',
   'All built.',
   'blueprint §7, §12 · roadmap Phase 1'),
  ('customer_relationships', 2, 'risk',
   'تعامل نزدیک به صفر: ۳ عضو، push برای هر سه خاموش، بازگشت هفتهٔ دوم ۱ از ۳',
   'Engagement near zero: 3 members, push off for all three, week-two return 1 of 3',
   'اولین ثبت‌نام پس از ۵ هفته در هفتهٔ ۱۱-۰۹ آمد.',
   'The first sign-up in five weeks came in the week of 11-09.',
   'ops/reports/marketing-manager/2026-11-16.md'),
  ('customer_relationships', 3, 'validated',
   'اعتماد از راه شفافیت: صفحهٔ عمومی دقت مدل و نسخهٔ هر پیش‌بینی',
   'Trust through transparency: a public model-accuracy page and a version on every forecast',
   'پیش‌بینی‌ها تغییرناپذیرند؛ هر نسخه ورودی‌ها و زمانش را دارد.',
   'Forecasts are immutable; each version stores its inputs and time.',
   'D-421 · CLAUDE.md rule 5'),
  ('customer_relationships', 4, 'assumption',
   'جامعه: رتبه‌بندی، گروه‌ها، گفت‌وگو و نظارت، همه حول بازی',
   'Community: leaderboards, groups, chat and moderation, all around the match',
   'ساخته شده (فاز ۳)؛ بدون اعضای کافی هنوز زنده نیست.',
   'Built (Phase 3); not alive without enough members.',
   'blueprint §8-10 · roadmap Phase 3'),
  ('customer_relationships', 5, 'assumption',
   'صدای بنیان‌گذار: تحلیل بازی‌های مهم و گروه‌های ویژه',
   'The founder''s voice: analysis of important matches and exclusive groups',
   'آهنگ نوشتن تحلیل تعیین نشده.',
   'How often the founder writes is not set.',
   'blueprint §6.5, §10.1 · D-269'),
  ('revenue_streams', 1, 'validated',
   'امروز: بدون درآمد؛ سایت غیرتجاری و در مرحلهٔ آزمون است',
   'Today: no revenue; the site is non-commercial and in testing',
   'چند مجوز رایگان (مثل GNews) فقط تا وقتی سایت غیرتجاری است معتبرند.',
   'Some free licences (GNews) hold only while the site is non-commercial.',
   'D-185 · ops/licences.md'),
  ('revenue_streams', 2, 'question',
   'تبلیغات روی سایت؟ رقم و تصمیم ندارد',
   'Advertising on the site? No figure and no decision',
   'تجاری شدن، پلن پولی GNews (از €49.99 در ماه) یا خاموش کردنش را لازم می‌کند.',
   'Going commercial requires GNews'' paid plan (from EUR 49.99 a month) or switching it off.',
   'D-185'),
  ('revenue_streams', 3, 'question',
   'اشتراک یا دسترسی ویژه (مثلاً گروه‌های ویژهٔ بنیان‌گذار)؟ قیمت و تصمیم ندارد',
   'Subscription or premium access (e.g. the founder''s exclusive groups)? No price, no decision',
   'بلوپرینت «دسترسی ویژهٔ جامعه» را نام می‌برد ولی پولی بودنش را نه.',
   'The blueprint names "premium community access" but not whether it is paid.',
   'blueprint §17 (Premium community access)'),
  ('revenue_streams', 4, 'question',
   'حامی مالی یا همکاری با شرکا؟ شروع نشده',
   'Sponsorship or partnerships? Not started',
   '«شرکا» در برنامهٔ بازاریابی: not started، نیازمند نگهدار.',
   '"Partners" in the marketing plan: not started, needs the maintainer.',
   'ops/marketing/plan.md'),
  ('revenue_streams', 5, 'risk',
   'فروش داده (B2B) عملاً بسته است: API-Football فروش دوبارهٔ دادهٔ خام را منع می‌کند',
   'Selling data (B2B) is effectively closed: API-Football forbids reselling raw data',
   'فروش خروجی خود مدل بررسی نشده است.',
   'Licensing the model''s own output has not been explored.',
   'ops/licences.md §1 · business-adviser 2026-11-13 §4.1'),
  ('revenue_streams', 6, 'risk',
   'هر درآمدی به شرکت بریتانیایی نیاز دارد که هنوز ثبت نشده؛ بندهای تحریم ارائه‌دهندگان باید بررسی شود',
   'Any revenue needs the UK company, not yet registered; providers'' sanctions clauses need review',
   'توسعه در ایران، فعالیت از خارج؛ وکیل باید بندها را تأیید کند.',
   'Development in Iran, operation from abroad; a lawyer must confirm the clauses.',
   'memory: project-jurisdiction · business-adviser 2026-11-02 §6'),
  ('key_resources', 1, 'validated',
   'گراف فوتبال با شناسهٔ یکتا: حدود ۴۹ رقابت و دو فصل گذشته',
   'A canonical football graph: about 49 competitions and two past seasons',
   'هر تیم، بازیکن و بازی شناسهٔ داخلی دارد؛ شناسهٔ ارائه‌دهنده در جدول نگاشت.',
   'Every team, player and match has an internal id; provider ids live in a mapping table.',
   'D-197 · business-adviser 2026-11-13 · CLAUDE.md rule 1'),
  ('key_resources', 2, 'validated',
   'مدل پیش‌بینی نسخه‌دار، داده‌های تاریخی آموزش و سابقهٔ دقت ثبت‌شده',
   'The versioned forecast model, historical training data and its logged accuracy record',
   'ارتقای نسخه فقط با شاهد backtest.',
   'A version is promoted only on backtest evidence.',
   'D-139 · D-233 · D-083'),
  ('key_resources', 3, 'validated',
   'پلتفرم ساخته‌شده: وب Next.js، API در NestJS، سرویس مدل پایتون، Postgres و Redis',
   'The built platform: Next.js web, NestJS API, Python model service, Postgres and Redis',
   'روی یک VPS با Docker Compose، پشت Cloudflare.',
   'On one VPS with Docker Compose, behind Cloudflare.',
   'CLAUDE.md §2 · docs/00-decisions.md'),
  ('key_resources', 4, 'risk',
   'برند Stadiomind و سیستم بصری‌اش؛ دامنهٔ stadiomind.com هنوز خریده نشده',
   'The Stadiomind brand and its visual system; stadiomind.com is not bought yet',
   '«نام حالا، دامنه بعداً».',
   '"The name now, the domain later".',
   'D-262 · D-263'),
  ('key_resources', 5, 'validated',
   'تیم: نگهدار (بنیان‌گذار)، هم‌تیمی در بریتانیا، و ۱۶ عامل هوش مصنوعی در کنسول',
   'Team: the maintainer (founder), a UK-based teammate, and 16 AI agents in the console',
   'هم‌تیمی در تصمیم‌ها شریک است.',
   'The teammate co-decides.',
   'memory: agents-console · maintainer-answers-2026-10-31 · D-328'),
  ('key_resources', 6, 'validated',
   'محتوا و رابط دوزبانه با راست‌به‌چپ کامل',
   'Bilingual content and interface with full right-to-left support',
   '',
   '',
   'blueprint §13 · CLAUDE.md rule 7'),
  ('key_activities', 1, 'validated',
   'دریافت و راستی‌آزمایی دادهٔ دارای مجوز: نتایج زنده، ترکیب، جدول، با تازگی و پوشش',
   'Ingesting and verifying licensed data: live scores, line-ups, tables, with freshness and coverage',
   'مسیر بحرانی فقط از API دارای مجوز.',
   'The critical path uses licensed APIs only.',
   'D-014 · D-183'),
  ('key_activities', 2, 'validated',
   'اجرا و انتشار پیش‌بینی‌های مدل، و سنجش علنی دقتش',
   'Running and publishing the model''s forecasts, and measuring its accuracy in public',
   '',
   '',
   'blueprint §6 · D-139 · D-355'),
  ('key_activities', 3, 'validated',
   'ممیزی روزانهٔ داده و پایش سرور با تیم عامل‌ها',
   'Daily data audit and server monitoring by the agent team',
   '',
   '',
   'memory: agents-console · team-charter (D-328)'),
  ('key_activities', 4, 'assumption',
   'پخش محتوا: پست روزانهٔ تلگرام، و X و Instagram با صف تأیید',
   'Distribution: the daily Telegram post, and X and Instagram through an approval queue',
   'تلگرام خودکار است؛ X و Instagram منتظر حساب.',
   'Telegram is automatic; X and Instagram wait on accounts.',
   'D-427'),
  ('key_activities', 5, 'risk',
   'دیده‌شدن در جست‌وجو برای صفحه‌های بازی فارسی و انگلیسی',
   'Search visibility for Persian and English match pages',
   'ایندکس واقعی بدون Search Console دیده نمی‌شود.',
   'Real indexing cannot be seen without Search Console.',
   'ops/marketing/keywords.md · marketing-manager 2026-11-16'),
  ('key_activities', 6, 'assumption',
   'نظارت بر جامعه و نوشتن تحلیل بنیان‌گذار',
   'Moderating the community and writing the founder''s analysis',
   'صف نظارت ساخته شده؛ حجم کار با اعضای کنونی ناچیز است.',
   'The moderation queue is built; the workload is negligible with today''s members.',
   'blueprint §6.5, §10.4 · D-053'),
  ('key_partners', 1, 'validated',
   'API-Football، پلن Ultra: منبع دارای مجوز دادهٔ فوتبال در مسیر بحرانی',
   'API-Football, Ultra plan: the licensed football data source on the critical path',
   '۷۵٬۰۰۰ درخواست در روز. فروش دوبارهٔ داده ممنوع.',
   '75,000 requests a day. Data resale forbidden.',
   'D-014 · D-076 · D-197 · ops/licences.md §1'),
  ('key_partners', 2, 'validated',
   'Highlightly، پلن Pro: لینک خلاصهٔ بازی و xG بازیکن',
   'Highlightly, Pro plan: match highlight links and player xG',
   '',
   '',
   'D-184 · D-224 · ops/licences.md §1'),
  ('key_partners', 3, 'assumption',
   'Sportmonks: نامزد منبع دوم برای ترکیب رسمی زودتر؛ خریده نشده',
   'Sportmonks: candidate second source for earlier official line-ups; not bought',
   'پیشنهاد مشاور: آزمایش ۱۴ روزهٔ Starter روی ۵ لیگ.',
   'Adviser''s recommendation: a 14-day Starter trial on 5 leagues.',
   'business-adviser 2026-11-02 §2 · 2026-11-13'),
  ('key_partners', 4, 'risk',
   'ناشران خبر از RSS و GNews رایگان',
   'News publishers via RSS and the GNews free plan',
   'GNews رایگان فقط برای پروژهٔ غیرتجاری؛ بیشتر خوراک‌ها مجوز عکس ندارند.',
   'GNews free is for non-commercial use only; most feeds carry no photo licence.',
   'D-061 · D-185 · ops/licences.md §2'),
  ('key_partners', 5, 'validated',
   'زیرساخت: VPS در Hetzner آلمان، Cloudflare، پشتیبان در Backblaze B2، سرویس ایمیل',
   'Infrastructure: a Hetzner VPS in Germany, Cloudflare, Backblaze B2 backups, an email service',
   'شرایط هیچ‌کدام هنوز خوانده و ثبت نشده (دفتر مجوزها، بخش ۵).',
   'None of their terms has been read and recorded yet (licence register §5).',
   'memory: project-jurisdiction · D-259 · ops/licences.md §5'),
  ('key_partners', 6, 'assumption',
   'Buffer رایگان: ناشر پست‌های X و Instagram',
   'Buffer (free): the publisher for X and Instagram posts',
   'حساب هنوز باز نشده.',
   'The account is not opened yet.',
   'D-427'),
  ('key_partners', 7, 'question',
   'وکیل و حسابدار در بریتانیا: لازم‌اند، هنوز کسی نیست',
   'A UK lawyer and accountant: needed, none engaged yet',
   'برای بندهای تحریم، ثبت نزد ICO و VAT.',
   'For sanctions clauses, ICO registration and VAT.',
   'business-adviser 2026-11-02 §6'),
  ('cost_structure', 1, 'validated',
   'API-Football Ultra: حدود ۲۹ دلار در ماه',
   'API-Football Ultra: about USD 29 a month',
   'میانگین مصرف ۳۵٪ پلن، اوج ۵۷٪.',
   'Average use 35% of the plan, peak 57%.',
   'business-adviser 2026-11-13 §4.1 · 2026-11-02 §3'),
  ('cost_structure', 2, 'validated',
   'Highlightly Pro: ۹٫۴۹ دلار در ماه',
   'Highlightly Pro: USD 9.49 a month',
   '',
   '',
   'D-184 · ops/licences.md §1'),
  ('cost_structure', 3, 'question',
   'سرور VPS، Cloudflare و ایمیل: رقم از مخزن دیده نمی‌شود',
   'VPS, Cloudflare and email: the figure is not visible from the repository',
   '',
   '',
   'business-adviser 2026-11-02 §3'),
  ('cost_structure', 4, 'risk',
   'پشتیبان در Backblaze B2 رایگان (۱۰ GB)؛ با رشد داده به سقف می‌رسد',
   'Backups on Backblaze B2''s free 10 GB; data growth will reach the cap',
   'بودجهٔ ۷ GiB حدود ۷ نسخه را جا می‌دهد؛ بازیابی لحظه‌ای تا پرداخت متوقف است.',
   'The 7 GiB budget holds about 7 copies; point-in-time recovery paused until paid.',
   'D-259 · business-adviser 2026-11-02 §3'),
  ('cost_structure', 5, 'assumption',
   'هزینه‌هایی که با تجاری شدن یا رشد می‌آیند: GNews از €49.99، Sportmonks از €29 + VAT، X حدود ۰٫۰۱۵ دلار هر پست',
   'Costs that come with going commercial or growing: GNews from EUR 49.99, Sportmonks from EUR 29 + VAT, X about USD 0.015 a post',
   'پست X با لینک ۰٫۲۰ دلار. هیچ‌کدام هنوز خریده نشده.',
   'An X post with a link is USD 0.20. None is bought yet.',
   'D-185 · business-adviser 2026-11-02 §2 · 2026-11-14 §0'),
  ('cost_structure', 6, 'question',
   'دامنهٔ stadiomind.com: قیمت معلوم نیست',
   'The stadiomind.com domain: price unknown',
   '',
   '',
   'D-262'),
  ('cost_structure', 7, 'question',
   'ثبت شرکت در بریتانیا، ثبت ICO، وکیل و حسابدار: هزینه معلوم نیست',
   'UK company registration, ICO registration, lawyer and accountant: cost unknown',
   '',
   '',
   'memory: project-jurisdiction · business-adviser 2026-11-02 §6'),
  ('cost_structure', 8, 'question',
   'زمان بنیان‌گذار و اشتراک ابزارهای هوش مصنوعی: حساب نشده',
   'The founder''s time and the AI tooling subscription: not costed',
   '',
   '',
   'CLAUDE.md §3');

-- Down Migration

DELETE FROM rate_limit WHERE action = 'console_canvas';
DROP TABLE console_canvas_event;
DROP TABLE console_canvas_card;
