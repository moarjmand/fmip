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

/** The desktop bar's icons (D-267): half a disc for Auto, the sun, the moon. */
const ICONS: Record<ThemePreference, React.ReactNode> = {
  system: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
};

/**
 * Auto (the device's own), Day or Night (T-602, D-089; named for the Hybrid
 * design, D-198). The header and every page follow it (D-263, D-267; the
 * last editorial page left paper in T-1621, D-291). Three submit buttons in one
 * form, the pressed one marked with `aria-pressed`: it works before any script
 * has loaded, a screen reader hears which is on, and the choice is one press.
 * `compact` sits in the site header on every page -- in the phone's Menu its
 * buttons are a thumb's 44px with their words (T-1479); in the desktop bar it
 * is the Design System's one 40px button, the icon of the theme a press
 * moves to (Auto, then Day, then Night, then Auto), its word kept for a
 * screen reader, and the other two are not drawn there (D-267); `full` is
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
  // The theme a press of the desktop bar's one button moves to.
  const next = SHOWN[(SHOWN.indexOf(current) + 1) % SHOWN.length];

  return (
    <form action={setThemeAction} data-testid={`theme-switch-${variant}`}>
      <div role="group" aria-labelledby={labelId} className="flex items-center gap-2 text-sm">
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
            className={`rounded border border-strong ${compact ? `min-h-touch px-3 lg:size-10 lg:min-h-0 lg:items-center lg:justify-center lg:border-default lg:px-0 ${theme === next ? 'lg:flex' : 'lg:hidden'}` : 'inline-flex min-h-touch items-center px-3'} ${
              theme === current ? 'bg-accent font-semibold text-on-accent' : 'bg-canvas text-fg'
            }`}
          >
            {compact && (
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="hidden lg:block"
              >
                {ICONS[theme]}
              </svg>
            )}
            <span className={compact ? 'lg:sr-only' : undefined}>
              <Translated locale={locale} message={LABELS[theme]} />
            </span>
          </button>
        ))}
      </div>
    </form>
  );
}
