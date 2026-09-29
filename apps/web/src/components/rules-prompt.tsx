import Link from 'next/link';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

/**
 * The ask (T-931, D-113): a newer version of the platform rules is published
 * and the member has not accepted it. Shown under the header on every page
 * until they do, one question however many versions were published meanwhile
 * (only the newest is asked). It blocks nothing: the version they accepted
 * still applies, and the rules page is where they read the new one before
 * accepting.
 */
export function RulesPrompt({ locale }: { locale: string }) {
  return (
    <Notice tone="info" className="mx-auto mt-2 max-w-3xl text-sm" data-testid="rules-prompt">
      <Translated locale={locale} message="rules.prompt" />{' '}
      <Link href={`/${locale}/rules`} className="underline" data-testid="rules-prompt-link">
        <Translated locale={locale} message="rules.promptLink" />
      </Link>
    </Notice>
  );
}
