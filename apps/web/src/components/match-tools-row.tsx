import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { message } from '@/i18n/messages';
import { zoneWords } from '@/lib/reader-time-zone';
import { FilledMessage } from '@/components/filled-message';
import { ShareLink } from '@/components/share-link';
import { Translated } from '@/components/translated';
import Link from '@/components/ui/link';

/**
 * The match page's tools, one row (T-1743, D-364; board P2-4): back to the
 * scores, the zone the page's times are in, Share, and at the row's end
 * Follow (`children`: `MatchFollow`, whose pieces are this row's items).
 * On a phone that is one 44px row where there were two; each control keeps a
 * 44px target. From 768px the row reads as it did -- "Times: UK time" in
 * full, and the follow control on a line of its own under it.
 *
 * The zone is said once for a screen reader ("Times: UK time") and drawn
 * short on a phone ("UK time"), where the row has no room for the label.
 * A server component; Share is the only client code in it, as before.
 */
export function MatchToolsRow({
  locale,
  timeZone,
  share,
  children,
}: {
  locale: string;
  timeZone: string;
  /** The page's address and title to share; none when the match could not be read. */
  share: { url: string; title: string } | null;
  /** The follow control. */
  children?: ReactNode;
}) {
  const l = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const zone = zoneWords(locale, timeZone);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 text-sm md:gap-x-3 md:gap-y-1"
      data-testid="match-tools"
    >
      <Link
        href={`/${locale}/scores`}
        className="inline-flex min-h-touch items-center font-semibold underline md:font-normal"
      >
        <Translated locale={locale} message="matchCentre.back" />
      </Link>
      <span className="inline-flex min-h-touch items-center text-muted" data-testid="timezone">
        <span className="max-md:sr-only">
          <FilledMessage
            message={message(l, 'scores.timesIn')}
            params={{ zone: timeZone, zoneName: zone }}
          />
        </span>
        <span aria-hidden="true" className="md:hidden">
          {zone}
        </span>
      </span>
      {share !== null && (
        <span>
          <ShareLink
            url={share.url}
            title={share.title}
            label={<Translated locale={locale} message="share.label" />}
            messages={{
              copied: message(l, 'share.copied'),
              manual: message(l, 'share.manual'),
            }}
          />
        </span>
      )}
      {children}
    </div>
  );
}
