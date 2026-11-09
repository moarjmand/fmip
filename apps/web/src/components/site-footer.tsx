import Link from '@/components/ui/link';
import { BrandMark } from '@/components/brand-mark';
import { LanguagePicker } from '@/components/language-picker';
import { MessageText } from '@/components/message-text';
import { Translated } from '@/components/translated';
import { localDigits } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, attribute, message } from '@/i18n/messages';
import { currentHolds, offeredGiven } from '@/lib/language-hold';
import { offeredLanguages } from '@/lib/language-picker';
import { FOOTER_LEGAL, FOOTER_NAV, type FooterGroup, type FooterLink } from '@/lib/shell-nav';

/** Each column's heading. "Stadiomind" is the name, the same in every language. */
const GROUP_HEADINGS: Record<FooterGroup['id'], MessageKey | null> = {
  football: 'shell.footer.football',
  predictions: 'nav.predictions',
  site: null,
};

/** Each link's words: the same as the header's, the founder's analysis and the league by name. */
export const FOOTER_LABELS: Record<FooterLink['id'], MessageKey> = {
  matches: 'shell.nav.matches',
  competitions: 'shell.nav.competitions',
  highlights: 'nav.highlights',
  watch: 'nav.watch',
  news: 'shell.nav.news',
  league: 'nav.leaderboard',
  model: 'shell.nav.model',
  analysis: 'analysis.founder.title',
  about: 'about.meta.title',
  rules: 'rules.title',
  settings: 'nav.settings',
  data: 'shell.footer.dataSources',
};

/**
 * The site footer (T-1610, D-281), at the end of every page, above the
 * phone's tab bar (the layout renders it before the bar's spacer, so its
 * last line is never under the bar). The mark and the name leading home and
 * a line on what the site is; then the links in three columns
 * (`FOOTER_NAV`): Football, Predictions -- the prediction league, the
 * model's record and the founder's analysis, each by its own name (rule 6)
 * -- and Stadiomind, with what it is, Settings and the languages, as links
 * to this page in each. Then the copyright line, the year in the page's
 * digits, and beside it the legal strip (`FOOTER_LEGAL`, T-1790, D-392):
 * the rules (linked from nowhere else since D-281 took them out of More)
 * and "Data sources", About's `#data` section.
 *
 * A server component: the words are resolved here and the catalogues stay
 * on the server (T-1040); only the language links, which need the
 * pathname, are the client's. It follows the theme like the header: the
 * raised surface with a hairline above it, in Day and in Night.
 *
 * No provider's name or attribution line: what a licence requires to be
 * said is the maintainer's to word (D-014). No Privacy or Contact link until
 * those pages exist (T-1793): never a link to nothing (rule 3).
 */
export async function SiteFooter({ locale }: { locale: string }) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const holds = await currentHolds();
  const href = (path: string) => `/${locale}${path}`;
  const nav = attribute(lang, 'shell.footer.nav');
  const year = localDigits(lang, String(new Date().getUTCFullYear()));

  return (
    <footer className="mt-16 border-t border-default bg-surface" data-testid="site-footer">
      <div className="page-frame grid gap-x-8 gap-y-10 py-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-3">
          <Link
            href={href('')}
            className="flex min-h-touch items-center gap-2.5 self-start font-latin text-fg"
            data-testid="footer-home"
          >
            <BrandMark size={26} ground="day" className="brand-mark-day shrink-0" />
            <BrandMark size={26} ground="night" className="brand-mark-night shrink-0" />
            <span className="text-base leading-none font-[850] tracking-wide uppercase font-stretch-expanded">
              Stadiomind
            </span>
          </Link>
          <p className="max-w-sm text-sm text-muted" data-testid="footer-tagline">
            <Translated locale={lang} message="shell.footer.tagline" />
          </p>
        </div>
        <nav
          aria-label={nav.text}
          lang={nav.lang}
          className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3"
        >
          {FOOTER_NAV.map((group) => {
            const heading = GROUP_HEADINGS[group.id];
            return (
              <div
                key={group.id}
                className="flex flex-col gap-2"
                data-testid={`footer-${group.id}`}
              >
                <h2 className="text-xs font-bold tracking-wide text-caption uppercase">
                  {heading === null ? (
                    <span className="font-latin">Stadiomind</span>
                  ) : (
                    <MessageText message={message(lang, heading)} />
                  )}
                </h2>
                <ul className="flex flex-col">
                  {group.links.map((link) => (
                    <li key={link.id}>
                      <Link
                        href={href(link.path)}
                        className="footer-link"
                        data-testid={`footer-${link.id}`}
                      >
                        <MessageText message={message(lang, FOOTER_LABELS[link.id])} />
                      </Link>
                    </li>
                  ))}
                </ul>
                {group.id === 'site' && (
                  <div className="mt-2">
                    <LanguagePicker
                      languages={offeredLanguages(offeredGiven(holds))}
                      label={attribute(lang, 'shell.language')}
                      variant="list"
                      testIdPrefix="footer-"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
      {/* The copyright and the legal strip share one line (T-1790, D-392):
          the strip's 44px targets take the place of the bar's padding, so
          the footer is no taller than before on a phone or a desktop. */}
      <div className="border-t border-default">
        <div className="page-frame flex flex-wrap items-center justify-between gap-x-6 py-1 md:py-2">
          <p
            className="flex min-h-touch items-center text-xs text-caption md:min-h-8"
            data-testid="footer-copyright"
          >
            © {year} <span className="ms-1 font-latin">Stadiomind</span>
          </p>
          <ul className="flex flex-wrap gap-x-5" data-testid="footer-legal">
            {FOOTER_LEGAL.map((link) => (
              <li key={link.id}>
                <Link
                  href={href(link.path)}
                  className="footer-link underline"
                  data-testid={`footer-${link.id}`}
                >
                  <MessageText message={message(lang, FOOTER_LABELS[link.id])} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
