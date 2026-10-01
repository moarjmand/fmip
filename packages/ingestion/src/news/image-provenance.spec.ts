import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageKey, judgeProvenance, namedAgency } from './image-provenance';

/**
 * Whether a photo is the agency's own (T-1322, D-177), against two recorded
 * article pages -- Mehr's lead photo with no other credit, and Tehran Times
 * republishing an AFP/Getty photo -- and samples for the rest.
 */
const recorded = (name: string): string => readFileSync(join(__dirname, '_recorded', name), 'utf8');

const MEHR = ['mehrnews.com'];
const TEHRAN_TIMES = ['tehrantimes.com', 'mehrnews.com'];

const page = (img: string, caption = ''): string =>
  `<html><body><figure class="item-img"><img src="${img}" title="headline" alt="" />` +
  `${caption === '' ? '' : `<figcaption>${caption}</figcaption>`}</figure><p>Body.</p></body></html>`;

describe('judgeProvenance', () => {
  it("accepts Mehr's own photo, on its host and its page, crediting nobody else", () => {
    const verdict = judgeProvenance({
      imageUrl: 'https://media.mehrnews.com/d/2026/09/01/4/6158165.jpg',
      ownDomains: MEHR,
      page: recorded('mehrnews-article-6963958.html'),
    });
    expect(verdict).toEqual({
      accepted: true,
      reason: 'served from media.mehrnews.com; on the article page with no other agency named',
      photographer: null,
    });
  });

  it('refuses an AFP/Getty photo Tehran Times republished on its own host', () => {
    const verdict = judgeProvenance({
      imageUrl: 'https://media.tehrantimes.com/d/t/2026/09/30/4/6198264.jpg',
      ownDomains: TEHRAN_TIMES,
      page: recorded('tehrantimes-article-530610.html'),
    });
    expect(verdict).toEqual({ accepted: false, reason: 'the page credits afp, not the agency' });
  });

  it('refuses a photo off the agency host, an unreadable page, and a photo not on the page', () => {
    const img = 'https://media.mehrnews.com/d/2026/09/30/4/6198255.jpg';
    expect(
      judgeProvenance({
        imageUrl: 'https://cdn.example.test/x/6198255.jpg',
        ownDomains: MEHR,
        page: page(img),
      }),
    ).toMatchObject({ accepted: false, reason: expect.stringContaining('not one of the agency') });
    // A look-alike host is not a subdomain.
    expect(
      judgeProvenance({
        imageUrl: 'https://media.notmehrnews.com/a/6198255.jpg',
        ownDomains: MEHR,
        page: page(img),
      }).accepted,
    ).toBe(false);
    expect(judgeProvenance({ imageUrl: img, ownDomains: MEHR, page: null })).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('could not be read'),
    });
    expect(
      judgeProvenance({
        imageUrl: img,
        ownDomains: MEHR,
        page: page('https://media.mehrnews.com/d/1/2/999999.jpg'),
      }),
    ).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('not on the article page'),
    });
  });

  it('matches the file across size buckets and cache-busting queries', () => {
    expect(imageKey('https://media.mehrnews.com/d/2026/09/30/4/6198255.jpg?ts=1')).toBe('6198255');
    const verdict = judgeProvenance({
      imageUrl: 'https://media.mehrnews.com/d/2026/09/30/4/6198255.jpg',
      ownDomains: MEHR,
      page: page('https://media.mehrnews.com/d/2026/09/30/3/6198255.jpg?ts=1790780875072'),
    });
    expect(verdict.accepted).toBe(true);
  });

  it.each([
    ['Latin AFP', '(Photo by AFP)'],
    ['Getty', 'Getty Images'],
    ['Reuters', 'REUTERS/Someone'],
    ['AP', 'AP Photo/Someone'],
    ['EPA', 'EPA-EFE/Someone'],
    ['Anadolu', 'Anadolu Agency'],
    ['Persian ISNA', 'عکس: ایسنا'],
    ['Persian IRNA', 'عکس از ایرنا'],
    ['Persian Fars', 'منبع عکس: خبرگزاری فارس'],
    ['Persian Reuters', 'عکس: رویترز'],
    ['Persian AFP', 'خبرگزاری فرانسه'],
    ['Persian Getty', 'گتی ایمیجز'],
    ['Persian Tasnim on Mehr', 'عکس: تسنیم'],
    ['Persian YJC', 'باشگاه خبرنگاران جوان'],
    ['any other news agency', 'خبرگزاری ایلنا'],
  ])('refuses a caption naming %s', (_, caption) => {
    const img = 'https://media.mehrnews.com/d/2026/09/30/4/6198255.jpg';
    expect(
      judgeProvenance({ imageUrl: img, ownDomains: MEHR, page: page(img, caption) }).accepted,
    ).toBe(false);
  });

  it('refuses a credit line elsewhere on the page that names another agency', () => {
    const img = 'https://media.mehrnews.com/d/2026/09/30/4/6198255.jpg';
    const html = page(img).replace('<p>Body.</p>', '<p>عکس: خبرگزاری آناتولی</p>');
    expect(judgeProvenance({ imageUrl: img, ownDomains: MEHR, page: html }).accepted).toBe(false);
  });

  it("does not refuse the agency's own name, and takes a named photographer", () => {
    const img = 'https://media.mehrnews.com/d/2026/09/30/4/6198255.jpg';
    const verdict = judgeProvenance({
      imageUrl: img,
      ownDomains: MEHR,
      page: page(img, 'عکاس: مریم احمدی - خبرگزاری مهر'),
    });
    expect(verdict).toMatchObject({ accepted: true, photographer: 'مریم احمدی - خبرگزاری مهر' });
    expect(
      judgeProvenance({
        imageUrl: img,
        ownDomains: MEHR,
        page: page(img, 'Photo by Ali Rezaei, Mehr News Agency'),
      }),
    ).toMatchObject({ accepted: true, photographer: 'Ali Rezaei' });
  });

  it('does not take ordinary words for agencies', () => {
    expect(namedAgency(['Rapid pace in Lap two', 'the dpad', 'Persian Gulf'], [])).toBeNull();
    expect(namedAgency(['Mehr month began'], [])).toBeNull();
  });
});
