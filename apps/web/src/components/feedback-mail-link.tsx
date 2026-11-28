'use client';

import { usePathname } from 'next/navigation';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';
import { feedbackHref, feedbackSubject } from '@/lib/feedback';

/**
 * The client half of `FeedbackLink` (T-1965): only the page's path needs
 * the browser's router, so the footer, which the layout draws for every
 * page, names the page the reader is on. Words arrive resolved.
 */
export function FeedbackMailLink({
  address,
  subject,
  label,
  className,
  testId,
}: {
  address: string;
  subject: string;
  label: Message;
  className?: string;
  testId: string;
}) {
  const pathname = usePathname() ?? '/';
  return (
    <a
      href={feedbackHref(address, feedbackSubject(subject, pathname))}
      className={className}
      data-testid={testId}
    >
      <MessageText message={label} />
    </a>
  );
}
