import { Translated } from '@/components/translated';
import type { MessageKey } from '@/i18n/messages';
import { APPEARANCE, type Appearance, type AppearanceKey } from '@/lib/appearance';
import { setAppearanceAction } from '@/lib/theme-actions';

const LABELS: { [K in AppearanceKey]: { group: MessageKey } & Record<Appearance[K], MessageKey> } =
  {
    text_size: {
      group: 'appearance.textSize.label',
      default: 'appearance.textSize.default',
      large: 'appearance.textSize.large',
      larger: 'appearance.textSize.larger',
    },
    contrast: {
      group: 'appearance.contrast.label',
      system: 'appearance.device',
      standard: 'appearance.contrast.standard',
      more: 'appearance.contrast.more',
    },
    motion: {
      group: 'appearance.motion.label',
      system: 'appearance.device',
      reduce: 'appearance.motion.reduce',
    },
  };

/**
 * Text size, contrast or motion (blueprint 2.2, T-621), built as the theme
 * switch is: one form of submit buttons named after the preference, the
 * current one marked with `aria-pressed`, so it works before any script has
 * loaded, a screen reader hears which is on, and a choice is one press.
 */
export function AppearanceSwitch<K extends AppearanceKey>({
  locale,
  preference,
  current,
}: {
  locale: string;
  preference: K;
  current: Appearance[K];
}) {
  const labelId = `appearance-${preference}-label`;
  const labels = LABELS[preference] as { group: MessageKey } & Record<string, MessageKey>;
  const values: readonly string[] = APPEARANCE[preference].values;

  return (
    <form action={setAppearanceAction} data-testid={`appearance-${preference}`}>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span id={labelId} className="me-2 font-medium">
          <Translated locale={locale} message={labels.group} />
        </span>
        {values.map((value) => (
          <button
            key={value}
            type="submit"
            name={preference}
            value={value}
            aria-pressed={value === current}
            data-testid={`appearance-${preference}-${value}`}
            className={`rounded border border-strong px-3 py-1.5 ${
              value === current ? 'bg-accent font-semibold text-on-accent' : 'bg-canvas text-fg'
            }`}
          >
            <Translated locale={locale} message={labels[value] ?? labels.group} />
          </button>
        ))}
      </div>
    </form>
  );
}
