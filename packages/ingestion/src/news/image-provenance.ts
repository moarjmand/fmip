/**
 * Whether a news photo is the agency's own (T-1322, D-177).
 *
 * The licences that let us show Mehr's, Tasnim's and Tehran Times' photos
 * (CC BY 4.0) cover what those agencies own. They also republish other
 * agencies' photos -- AFP, Getty, Reuters, ISNA, IRNA and the rest -- and
 * those are not theirs to license. So a photo is accepted only on evidence:
 *
 * 1. it is served from one of the agency's own hosts (`ownDomains`);
 * 2. the article page could be read, and the photo is on it; and
 * 3. nothing the page says about that photo -- its title and alt text, its
 *    figure and caption, and any credit line on the page ("Photo:", "عکس:",
 *    "©") -- names another agency, in Latin or Persian script.
 *
 * Anything short of that is refused, with the reason in words. A caption that
 * names another agency is refused even when it names the agency itself as
 * well ("Mehr / AFP"); a page that cannot be read is refused, not presumed
 * innocent. Pure: the caller fetches the page and records the verdict.
 */

export type ProvenanceVerdict =
  | { accepted: true; reason: string; photographer: string | null }
  | { accepted: false; reason: string };

export interface ProvenanceInput {
  /** The photo's URL as the feed carried it. */
  imageUrl: string;
  /** Registrable domains the agency's own photos are served from (`news_source.image_hosts`). */
  ownDomains: readonly string[];
  /** The article page's HTML; `null` when it could not be read. */
  page: string | null;
}

/** An agency whose name in a caption means the photo is theirs, not the publisher's. */
interface Agency {
  key: string;
  pattern: RegExp;
}

/** Letters on neither side, in any script: `\b` knows only ASCII. */
const word = (body: string, flags = 'iu'): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, flags);

const ZWNJ = '[\\s\\u200c]?';

/**
 * Photo agencies and news agencies whose photos Iranian agencies republish.
 * Short acronyms that are also ordinary words are matched case-sensitively.
 */
export const OTHER_AGENCIES: readonly Agency[] = [
  { key: 'afp', pattern: word(`AFP|Agence France[- ]Presse|فرانس${ZWNJ}پرس|خبرگزاری فرانسه`) },
  { key: 'getty', pattern: word(`Getty(?: Images)?|گتی${ZWNJ}ایمیجز|گتی`) },
  { key: 'reuters', pattern: word('Reuters|رویترز') },
  { key: 'ap', pattern: word('AP', 'u') },
  { key: 'ap', pattern: word(`Associated Press|آسوشیتد${ZWNJ}پرس`) },
  { key: 'epa', pattern: word('EPA(?:-EFE)?', 'u') },
  { key: 'efe', pattern: word('EFE', 'u') },
  { key: 'anadolu', pattern: word('Anadolu(?: Agency)?|آناتولی') },
  { key: 'xinhua', pattern: word(`Xinhua|شین${ZWNJ}هوا`) },
  { key: 'dpa', pattern: word('dpa', 'u') },
  { key: 'tass', pattern: word('TASS', 'u') },
  { key: 'ria', pattern: word('RIA Novosti|ریانووستی') },
  { key: 'sputnik', pattern: word('Sputnik|اسپوتنیک') },
  { key: 'imago', pattern: word('IMAGO', 'u') },
  { key: 'shutterstock', pattern: word('Shutterstock') },
  { key: 'alamy', pattern: word('Alamy') },
  { key: 'pa', pattern: word('PA (?:Images|Wire|Media)') },
  { key: 'ansa', pattern: word('ANSA', 'u') },
  { key: 'isna', pattern: word('ISNA|ایسنا') },
  { key: 'irna', pattern: word('IRNA|ایرنا') },
  { key: 'fars', pattern: word(`Fars(?: News)?|خبرگزاری فارس|فارس${ZWNJ}نیوز`) },
  { key: 'tasnim', pattern: word('Tasnim|تسنیم') },
  { key: 'mehr', pattern: word('Mehr News|MNA|خبرگزاری مهر') },
  { key: 'tehran-times', pattern: word('Tehran Times|تهران تایمز') },
  { key: 'ilna', pattern: word('ILNA|ایلنا') },
  { key: 'ibna', pattern: word('IBNA|ایبنا') },
  { key: 'yjc', pattern: word('YJC|باشگاه خبرنگاران(?: جوان)?') },
  { key: 'khabar-varzeshi', pattern: word(`Khabar ?Varzeshi|خبر${ZWNJ}ورزشی`) },
  { key: 'varzesh3', pattern: word(`Varzesh ?3|ورزش${ZWNJ}سه`) },
  { key: 'press-tv', pattern: word('Press ?TV|پرس ?تی ?وی') },
  { key: 'wana', pattern: word('WANA', 'u') },
];

/**
 * Which of `OTHER_AGENCIES` is the publisher itself, by the domain its photos
 * are served from. Tehran Times belongs to Mehr's group and carries Mehr's
 * licence statement, so each is the other's own.
 */
export const OWN_AGENCIES_BY_DOMAIN: Readonly<Record<string, readonly string[]>> = {
  'mehrnews.com': ['mehr', 'tehran-times'],
  'tehrantimes.com': ['mehr', 'tehran-times'],
  'tasnimnews.com': ['tasnim'],
};

/** "News agency X" in either script, where X is not the publisher itself. */
const GENERIC_AGENCY = [
  { pattern: /خبرگزاری[\s‌]+([\p{L}‌]+)/gu, own: ['مهر', 'تسنیم'] },
  { pattern: /(\p{Lu}[\p{L}]+)\s+News\s+Agency/gu, own: ['Mehr', 'Tasnim'] },
];

/** Whether `host` is `domain` or under it. */
export function hostIsUnder(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** The file's own name without extension or query: `…/4/6158165.jpg?ts=1` → `6158165`. */
export function imageKey(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const last = path.split('/').pop() ?? '';
  const stem = last.replace(/\.[a-z0-9]+$/i, '');
  return stem.length >= 3 ? stem : null;
}

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m === null ? null : decode(m[1] ?? m[2] ?? '');
}

function plain(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the page says about the photo: every mention of its file, with its figure. */
function textsAboutImage(page: string, key: string): string[] | null {
  const texts: string[] = [];
  let seen = false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inFile = new RegExp(`/${escaped}\\.[a-z0-9]+`, 'i');

  for (const tag of page.match(/<img\s[^>]*>/gi) ?? []) {
    const src = `${attr(tag, 'src') ?? ''} ${attr(tag, 'srcset') ?? ''} ${attr(tag, 'data-src') ?? ''}`;
    if (!inFile.test(src)) continue;
    seen = true;
    for (const a of ['title', 'alt']) {
      const value = attr(tag, a);
      if (value !== null && value.trim() !== '') texts.push(value);
    }
  }
  for (const figure of page.match(/<figure[\s>][\s\S]*?<\/figure>/gi) ?? []) {
    if (!inFile.test(figure)) continue;
    seen = true;
    const text = plain(figure);
    if (text !== '') texts.push(text);
  }
  return seen ? texts : null;
}

/** Credit lines anywhere on the page: "Photo: …", "عکس: …", "عکاس: …", "© …". */
function creditLines(page: string): string[] {
  const text = plain(page);
  const lines: string[] = [];
  const marker =
    /(?:Photo(?:graph|grapher)?s?\s*(?:by|:|credit\s*:?)|Image\s*(?:by|:|credit\s*:?)|Credit\s*:|©|عکس\s*[:：]|عکاس\s*[:：]|تصویر\s*[:：]|منبع\s+عکس\s*[:：]?)\s*[^.،|]{1,80}/giu;
  for (const m of text.matchAll(marker)) lines.push(m[0]);
  return lines;
}

/** The photographer, when a caption names one in so many words. */
function photographerIn(texts: string[]): string | null {
  for (const text of texts) {
    const m =
      /(?:عکاس|Photographer)\s*[:：]\s*([^()\n|،,;:]{2,60})|Photo\s+by\s+([^()\n|،,;:/]{2,60})/iu.exec(
        text,
      );
    const name = (m?.[1] ?? m?.[2] ?? '').trim();
    if (name !== '') return name;
  }
  return null;
}

/** The first other agency any of `texts` names, or `null`. */
export function namedAgency(texts: readonly string[], own: readonly string[]): string | null {
  for (const text of texts) {
    for (const agency of OTHER_AGENCIES) {
      if (own.includes(agency.key)) continue;
      if (agency.pattern.test(text)) return agency.key;
    }
    for (const generic of GENERIC_AGENCY) {
      for (const m of text.matchAll(generic.pattern)) {
        const name = m[1] ?? '';
        if (!generic.own.includes(name)) return `news agency "${name}"`;
      }
    }
  }
  return null;
}

/** The verdict on one photo; see the file comment for the rule. */
export function judgeProvenance(input: ProvenanceInput): ProvenanceVerdict {
  let host: string;
  try {
    host = new URL(input.imageUrl).hostname;
  } catch {
    return { accepted: false, reason: 'the image URL is not a URL' };
  }
  const domain = input.ownDomains.find((d) => hostIsUnder(host, d));
  if (domain === undefined) {
    return { accepted: false, reason: `served from ${host}, not one of the agency's own hosts` };
  }
  const own = OWN_AGENCIES_BY_DOMAIN[domain.toLowerCase()] ?? [];
  if (input.page === null) {
    return {
      accepted: false,
      reason: 'the article page could not be read, so provenance is unknown',
    };
  }
  const key = imageKey(input.imageUrl);
  if (key === null) {
    return { accepted: false, reason: 'the image URL names no file to look for on the page' };
  }
  const about = textsAboutImage(input.page, key);
  if (about === null) {
    return {
      accepted: false,
      reason: 'the photo is not on the article page, so provenance is unknown',
    };
  }
  const credits = creditLines(input.page);
  const other = namedAgency([...about, ...credits], own);
  if (other !== null) {
    return { accepted: false, reason: `the page credits ${other}, not the agency` };
  }
  const photographer = photographerIn(about);
  return {
    accepted: true,
    reason:
      `served from ${host}; on the article page with no other agency named` +
      (photographer === null ? '' : `; photographer ${photographer}`),
    photographer,
  };
}
