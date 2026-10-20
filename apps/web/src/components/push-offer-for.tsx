import { PushOfferLazy } from '@/components/push-offer-lazy';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { interpolate, message, resolveMessages } from '@/i18n/messages';
import { PUSH_OFFER_KEYS } from '@/lib/notification-messages';
import type { OfferedType } from '@/lib/push-offer';

/**
 * The push offer's words, resolved on the server for the reader's locale
 * (T-1040), around the client offer (T-1429). With a follow and its name the
 * question names it ("…alerts for Arsenal…"); without one -- a page whose
 * pickers follow many things -- it speaks of what the member follows.
 */
export function PushOfferFor({
  locale,
  entity,
  name,
}: {
  locale: string;
  entity: { type: OfferedType; id: string } | null;
  name: string | null;
}) {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const asked = message(
    resolved,
    name === null ? 'pushOffer.questionFollowed' : 'pushOffer.question',
  );
  const question = name === null ? asked : { ...asked, text: interpolate(asked.text, { name }) };
  return (
    <div aria-live="polite" className="max-w-sm empty:hidden" data-testid="push-offer-slot">
      <PushOfferLazy
        locale={locale}
        entity={entity}
        question={question}
        messages={resolveMessages(resolved, PUSH_OFFER_KEYS)}
      />
    </div>
  );
}
