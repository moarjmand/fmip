import Link from 'next/link';
import { Translated } from '@/components/translated';
import { dismissFirstRunAction } from '@/lib/first-run-actions';

/**
 * The homepage's offer of the first run (blueprint 2.3, T-620): guests "are
 * encouraged to select a language, territory and favourite teams". One
 * sentence, a way in, and "Not now" -- a plain form, so dismissing needs no
 * script. The caller decides whether to show it (`FirstRunOffer` is only
 * rendered while the flow is pending for a member, or neither finished nor
 * dismissed in a guest's browser).
 */
export function FirstRunOffer({ locale }: { locale: string }) {
  const dismiss = dismissFirstRunAction.bind(null, locale);
  return (
    <aside
      aria-labelledby="first-run-offer"
      className="flex flex-col gap-2 rounded border border-default p-4"
      data-testid="first-run-offer"
    >
      <p id="first-run-offer">
        <Translated locale={locale} message="firstRun.offer.text" />
      </p>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link
          href={`/${locale}/welcome`}
          className="font-semibold underline"
          data-testid="first-run-start"
        >
          <Translated locale={locale} message="firstRun.offer.start" />
        </Link>
        <form action={dismiss} className="contents">
          <button type="submit" className="underline" data-testid="first-run-dismiss">
            <Translated locale={locale} message="firstRun.later" />
          </button>
        </form>
      </div>
    </aside>
  );
}
