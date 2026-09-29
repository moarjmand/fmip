import { RememberCookie } from '@/components/remember-cookie';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { isLocale } from '@/i18n/locales';
import { message } from '@/i18n/messages';
import { HELD_NOTICE_COOKIE } from '@/lib/language-hold';

/**
 * Told once (T-1163, D-155): the reader's stored language is held back, so
 * FMIP is shown in the default language; their choice is kept. `value` is
 * what `heldNotice` returned; once shown, `RememberCookie` records it and the
 * header leaves this out until that language is held again.
 */
export function HeldLanguageNotice({
  locale,
  held,
  value,
}: {
  locale: string;
  held: string;
  value: string;
}) {
  const autonym = isLocale(held)
    ? message(held, `language.name.${held}` as Parameters<typeof message>[1]).text
    : held;
  return (
    <Notice
      tone="info"
      className="mx-auto mt-2 max-w-3xl text-sm"
      data-testid="held-language-notice"
    >
      <span lang={held}>{autonym}</span>:{' '}
      <Translated locale={locale} message="languageHold.notice" />
      <RememberCookie name={HELD_NOTICE_COOKIE} value={value} />
    </Notice>
  );
}
