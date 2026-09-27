import { Translated } from '@/components/translated';
import type { MessageKey } from '@/i18n/messages';
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';
import { setThemeAction } from '@/lib/theme-actions';

const LABELS: Record<ThemePreference, MessageKey> = {
  light: 'theme.light',
  dark: 'theme.dark',
  system: 'theme.system',
};

/**
 * Light, dark or the device's own (T-602, D-089). Three submit buttons in one
 * form, the pressed one marked with `aria-pressed`: it works before any script
 * has loaded, a screen reader hears which is on, and the choice is one press.
 * `compact` sits in the site header on every page; `full` is the one in
 * Settings, with room for its explanation around it.
 */
export function ThemeSwitch({
  locale,
  current,
  variant,
}: {
  locale: string;
  current: ThemePreference;
  variant: 'compact' | 'full';
}) {
  const labelId = `theme-switch-${variant}-label`;
  const compact = variant === 'compact';

  return (
    <form action={setThemeAction} data-testid={`theme-switch-${variant}`}>
      <div
        role="group"
        aria-labelledby={labelId}
        className={`flex items-center ${compact ? 'gap-1 text-xs' : 'gap-2 text-sm'}`}
      >
        <span id={labelId} className={compact ? 'sr-only' : 'me-2 font-medium'}>
          <Translated locale={locale} message="theme.label" />
        </span>
        {THEME_PREFERENCES.map((theme) => (
          <button
            key={theme}
            type="submit"
            name="theme"
            value={theme}
            aria-pressed={theme === current}
            data-testid={`theme-${theme}`}
            className={`rounded border border-strong ${compact ? 'px-1.5 py-0.5' : 'px-3 py-1.5'} ${
              theme === current ? 'bg-accent font-semibold text-on-accent' : 'bg-canvas text-fg'
            }`}
          >
            <Translated locale={locale} message={LABELS[theme]} />
          </button>
        ))}
      </div>
    </form>
  );
}
