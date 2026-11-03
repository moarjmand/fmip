/**
 * What each forecast-model version is made of, in Persian (T-1729, D-355):
 * the console's model page reads the versions and the figures from the API,
 * and their make-up from here, written from the version files in
 * `apps/model/fmip_model/model/{published,candidates}/` and the decisions
 * named beside each line. A version not listed here is shown with its name
 * and figures and the sentence that its make-up is not written yet, never
 * with another version's inputs (rule 3). A new version gets its entry with
 * its promotion or shadow decision.
 */

export interface ModelInputNote {
  /** The input in plain Persian. */
  title: string;
  /** The technical name, shown left to right. */
  technical: string;
  /** What it does, in one plain sentence. */
  plain: string;
  /** The version's own constant or detail, when it adds something. */
  detail?: string;
}

export interface ModelVersionNote {
  /** Published: the decision that put it on the site. Shadow: the one that put it in shadow. */
  decision: string;
  /** Shadow only: what it adds to the published version, in one sentence. */
  adds?: string;
  /** Shadow only: the rule its promotion is judged by. */
  rule?: 'D-336' | 'D-139';
  /** Published only: its inputs, in the order the forecast is built. */
  inputs?: ModelInputNote[];
}

/** The make-up of `dixon-coles-elo@0.6.0` (T-1372, D-190, D-191), from its file. */
const INPUTS_0_6_0: ModelInputNote[] = [
  {
    title: 'نتیجه‌ی مسابقه‌های گذشته',
    technical: 'match results (goals for and against)',
    plain:
      'از گل‌های زده و خورده‌ی هر تیم در مسابقه‌های ثبت‌شده‌ی خود سکو، یک عدد برای قدرت حمله و یک عدد برای قدرت دفاع هر تیم تخمین زده می‌شود.',
    detail: 'سه سال اخیر (۱۱۰۰ روز)، هر لیگ جدا',
  },
  {
    title: 'وزن زمانی',
    technical: 'time decay (xi)',
    plain: 'مسابقه‌ی تازه‌تر وزن بیشتری دارد و اثر مسابقه‌ی قدیمی کم‌کم کم می‌شود.',
    detail:
      'برای هر لیگ جدا تنظیم شده؛ نیمه‌عمر از حدود ۱۷۰ روز تا حدود ۱۴۰۰ روز، و ۱۰۷ روز برای لیگی که عدد خودش را ندارد',
  },
  {
    title: 'برتری میزبان',
    technical: 'home advantage',
    plain:
      'تیم میزبان در هر لیگ به اندازه‌ای که داده‌ی همان لیگ نشان می‌دهد گل بیشتری انتظار دارد.',
  },
  {
    title: 'رتبه‌ی Elo خود سکو',
    technical: 'own Elo prior',
    plain:
      'رتبه‌ی Elo که سکو از همان نتیجه‌ها حساب می‌کند، قدرت کلی هر تیم را به سمت جایگاهش می‌کشد؛ برای تیمی که مسابقه‌ی کمی دارد مهم‌تر است.',
    detail: 'وزن ۰٫۵؛ ضریب تغییر ۲۰ و برتری میزبان ۶۰ امتیاز (D-111، D-162)',
  },
  {
    title: 'مهار عددهای افراطی',
    technical: 'ridge regularisation',
    plain:
      'قدرت تیمی که داده‌ی کمی دارد به سمت میانگین نگه داشته می‌شود تا از چند نتیجه‌ی اتفاقی بزرگ نشود.',
  },
  {
    title: 'اصلاح نتیجه‌های کم‌گل',
    technical: 'low-score correction (Dixon–Coles rho)',
    plain:
      'احتمال نتیجه‌های ۰–۰، ۱–۰، ۰–۱ و ۱–۱ با یک عدد که از داده تخمین زده می‌شود اصلاح می‌شود.',
  },
  {
    title: 'مسابقه‌های میان دو لیگ',
    technical: 'cross-league fit (XL)',
    plain:
      'برای جام‌ها و مسابقه‌های اروپایی، همه‌ی باشگاه‌ها روی یک مقیاس برازش می‌شوند: قدرت هر باشگاه برابر قدرت لیگش به‌علاوه‌ی قدرت خودش است.',
    detail: 'D-085',
  },
  {
    title: 'از میانگین گل به سه احتمال',
    technical: 'Poisson score matrix → home / draw / away',
    plain:
      'از میانگین گل هر طرف، احتمال هر نتیجه تا ۱۰ گل حساب می‌شود و جمع آن‌ها احتمال برد میزبان، مساوی و برد میهمان را می‌دهد.',
  },
];

export const MODEL_NOTES: Record<string, ModelVersionNote> = {
  'dixon-coles-elo@0.6.0': { decision: 'D-191', inputs: INPUTS_0_6_0 },
  'dixon-coles-elo@0.7.0': {
    decision: 'D-233',
    adds: 'همان 0.6.0 با همه‌ی عددهایش، به‌علاوه‌ی یازده لیگ تازه: یونان، سوئیس، دانمارک، آمریکا، برزیل، آرژانتین، چک، کرواسی، صربستان، عربستان و امارات.',
    rule: 'D-336',
  },
};

export interface RejectedFactor {
  title: string;
  technical: string;
  /** Why, in a few words. */
  why: string;
  decision: string;
}

/** Factors tested on held-out matches and not adopted (D-121, D-329, D-335). */
export const REJECTED_FACTORS: RejectedFactor[] = [
  {
    title: 'قدرت ترکیب اصلی',
    technical: 'lineup strength (xi_strength, lineup_beta)',
    why: 'پیش‌بینی را بهتر نکرد',
    decision: 'D-121',
  },
  { title: 'روزهای استراحت', technical: 'rest days', why: 'کمی بدتر کرد', decision: 'D-329' },
  {
    title: 'برتری میزبان ویژه‌ی هر تیم',
    technical: 'team home advantage',
    why: 'در ۶ لیگ از ۱۷ لیگ بدتر کرد',
    decision: 'D-329',
  },
  { title: 'سابقه‌ی رودررو', technical: 'head to head', why: 'بدتر کرد', decision: 'D-329' },
  { title: 'مربی تازه', technical: 'new coach', why: 'بدتر کرد', decision: 'D-329' },
  {
    title: 'انگیزه از جایگاه جدول',
    technical: 'league stakes (zones)',
    why: 'مسابقه‌ی کافی نبود',
    decision: 'D-329',
  },
  { title: 'بازی برگشت', technical: 'second leg', why: 'مسابقه‌ی کافی نبود', decision: 'D-329' },
  {
    title: 'فرم گل مورد انتظار',
    technical: 'expected-goals form (xG)',
    why: 'در لیگ‌های اصلی بهتر و در بسیاری از لیگ‌های دیگر بدتر بود؛ یک آزمون رو‌به‌جلو برای ۵ ژانویه‌ی ۲۰۲۷ ثبت شده (D-334)',
    decision: 'D-329',
  },
  {
    title: 'غیبت بازیکنان همیشگی',
    technical: 'regulars missing',
    why: 'بدتر کرد',
    decision: 'D-329',
  },
  {
    title: 'استراحت پیش از بازی بزرگ بعدی',
    technical: 'rest with what comes next',
    why: 'بدتر کرد',
    decision: 'D-329',
  },
  {
    title: 'بازکالیبره‌ی تساوی',
    technical: 'draw recalibration',
    why: 'اثری نداشت',
    decision: 'D-329',
  },
  {
    title: 'انگیزه‌ی پایان فصل',
    technical: 'late-season stakes',
    why: 'بدتر کرد',
    decision: 'D-329',
  },
  {
    title: 'گزینه‌های مسابقه‌های میان‌لیگی',
    technical: 'cross-league options',
    why: 'هیچ‌کدام بهتر نبود',
    decision: 'D-329',
  },
  {
    title: 'وزن زمانی تازه برای نُه لیگ',
    technical: 'per-division time decay (0.8.0)',
    why: 'روی فصل نگه‌داشته‌شده از معیار رد نشد',
    decision: 'D-329',
  },
  {
    title: 'کیفیت مربی',
    technical: 'coach quality',
    why: 'در هر دو گروه لیگ‌ها بدتر کرد',
    decision: 'D-335',
  },
];
