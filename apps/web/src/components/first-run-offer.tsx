import { Translated } from '@/components/translated';
import Link from '@/components/ui/link';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { attribute } from '@/i18n/messages';
import { dismissFirstRunAction } from '@/lib/first-run-actions';

/**
 * The homepage's offer of the first run (blueprint 2.3, T-620): guests "are
 * encouraged to select a language, territory and favourite teams". The
 * caller decides whether to show it (`FirstRunOffer` is only rendered while
 * the flow is pending for a member, or neither finished nor dismissed in a
 * guest's browser).
 *
 * T-1756 (D-373; board P4-2): a 48px strip after the main match, not a card
 * before it. The whole strip is the way in ("Make Stadiomind yours", the
 * brand's star in the accent, an arrow at its inline end); beside it a 44px
 * close named "Not now", a plain form, so dismissing needs no script. The
 * long sentence is gone from the strip: the welcome page itself says that
 * every question can be skipped (`firstRun.intro`) and offers "Skip this
 * step" on each.
 */
export function FirstRunOffer({ locale }: { locale: string }) {
  const dismiss = dismissFirstRunAction.bind(null, locale);
  const close = attribute(isLocale(locale) ? locale : DEFAULT_LOCALE, 'firstRun.strip.dismiss');
  return (
    <aside
      aria-labelledby="first-run-offer"
      className="flex min-h-12 items-stretch rounded-tile border border-default bg-surface"
      data-testid="first-run-offer"
    >
      <Link
        href={`/${locale}/welcome`}
        className="focus-inset flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-tile ps-4 pe-2 text-sm font-bold text-fg"
        data-testid="first-run-start"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0 text-accent"
        >
          <path d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.5 9.3l6.6-.8z" />
        </svg>
        <span id="first-run-offer" className="min-w-0 flex-1">
          <Translated locale={locale} message="firstRun.title" />
        </span>
        <span aria-hidden="true" className="inline-block text-caption rtl:-scale-x-100">
          →
        </span>
      </Link>
      <form action={dismiss} className="flex items-center pe-0.5">
        <button
          type="submit"
          aria-label={close.text}
          lang={close.lang}
          className="focus-inset flex size-11 items-center justify-center rounded-control text-muted hover:text-fg"
          data-testid="first-run-dismiss"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </form>
    </aside>
  );
}
