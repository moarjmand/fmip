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
 * Shown as Auto, Day, Night (D-198): the default first. Only the order on
 * screen; the values and what each does are unchanged.
 */
const POSITION: Record<ThemePreference, number> = { system: 0, light: 1, dark: 2 };
const SHOWN = [...THEME_PREFERENCES].sort((a, b) => POSITION[a] - POSITION[b]);

/**
 * Auto (the device's own), Day or Night (T-602, D-089; named for the Hybrid
 * design, D-198). Data pages follow it; editorial pages and the header stay on
 * paper whatever it says. Three submit buttons in one
 * form, the pressed one marked with `aria-pressed`: it works before any script
 * has loaded, a screen reader hears which is on, and the choice is one press.
 * `compact` sits in the site header on every page -- in the phone's Menu its
 * buttons are a thumb's 44px (T-1479), in the desktop row small; `full` is
 * the one in Settings, with room for its explanation around it.
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
        className={`flex items-center ${compact ? 'gap-2 text-sm lg:gap-1 lg:text-xs' : 'gap-2 text-sm'}`}
      >
        <span id={labelId} className={compact ? 'sr-only' : 'me-2 font-medium'}>
          <Translated locale={locale} message="theme.label" />
        </span>
        {SHOWN.map((theme) => (
          <button
            key={theme}
            type="submit"
            name="theme"
            value={theme}
            aria-pressed={theme === current}
            data-testid={`theme-${theme}`}
            className={`rounded border border-strong ${compact ? 'min-h-touch px-3 lg:min-h-0 lg:px-1.5 lg:py-0.5' : 'px-3 py-1.5'} ${
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
