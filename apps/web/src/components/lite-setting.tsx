import { Translated } from '@/components/translated';
import type { MessageKey } from '@/i18n/messages';
import { LITE_PREFERENCES, type LitePreference } from '@/lib/lite';
import { setLiteAction } from '@/lib/theme-actions';

const LABELS: Record<LitePreference, MessageKey> = {
  auto: 'lite.auto',
  on: 'lite.on',
  off: 'lite.off',
};

/**
 * Settings -> Appearance, the Lite mode row (T-1387, D-205): Auto, On, Off,
 * built as the appearance rows are (`AppearanceSwitch`) -- one form of submit
 * buttons, the current one `aria-pressed`, working before any script loads.
 * Under it, a line saying what lite mode does and that Auto follows what the
 * browser reports about the connection.
 */
export function LiteSetting({ locale, current }: { locale: string; current: LitePreference }) {
  const labelId = 'appearance-lite-label';
  return (
    <form action={setLiteAction} className="flex flex-col gap-1" data-testid="appearance-lite">
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span id={labelId} className="me-2 font-medium">
          <Translated locale={locale} message="lite.label" />
        </span>
        {LITE_PREFERENCES.map((value) => (
          <button
            key={value}
            type="submit"
            name="lite"
            value={value}
            aria-pressed={value === current}
            data-testid={`appearance-lite-${value}`}
            className={`rounded border border-strong px-3 py-1.5 ${
              value === current ? 'bg-accent font-semibold text-on-accent' : 'bg-canvas text-fg'
            }`}
          >
            <Translated locale={locale} message={LABELS[value]} />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        <Translated locale={locale} message="lite.hint" />
      </p>
    </form>
  );
}
