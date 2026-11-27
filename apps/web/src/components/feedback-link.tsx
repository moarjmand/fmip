import { connection } from 'next/server';
import { FeedbackMailLink } from '@/components/feedback-mail-link';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { message, t } from '@/i18n/messages';
import { siteContactEmail } from '@/lib/feedback';

/**
 * The contact mailbox for this request, or null (T-1965, D-465).
 *
 * `connection()` comes first for the reason `DemonstrationBanner` gives:
 * `SITE_CONTACT_EMAIL` is a runtime variable, and a prerender would read
 * nothing and bake "no link" into the page. The page or the footer awaits
 * this and hands the answer to `FeedbackLink`.
 */
export async function feedbackAddress(): Promise<string | null> {
  await connection();
  return siteContactEmail();
}

/**
 * "Send feedback" / «ارسال بازخورد» (T-1965, D-465): an e-mail to the site's
 * contact mailbox, the subject in the reader's language naming the page they
 * are on. On `/welcome`, in the footer and on the member's own profile.
 * Without an address nothing is drawn, the line's question included (rule 3:
 * no link to nobody).
 *
 * `line` is the question and the link as one sentence, for the two pages;
 * `item` is the link alone in a list item, for the footer's legal strip, so
 * an unset address leaves no empty item behind.
 */
export function FeedbackLink({
  locale,
  address,
  variant,
  className,
  testId = 'feedback-link',
}: {
  locale: string;
  address: string | null;
  variant: 'line' | 'item';
  className?: string;
  testId?: string;
}) {
  if (address === null) return null;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const link = (
    <FeedbackMailLink
      address={address}
      subject={t(lang, 'feedback.subject')}
      label={message(lang, 'feedback.link')}
      className={variant === 'line' ? 'underline' : className}
      testId={testId}
    />
  );
  if (variant === 'item') return <li>{link}</li>;
  return (
    <p className={className ?? 'text-sm text-muted'} data-testid={`${testId}-line`}>
      <Translated locale={lang} message="feedback.prompt" /> {link}
    </p>
  );
}
