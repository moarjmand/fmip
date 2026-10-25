import type { ReactNode } from 'react';
import { Translated } from '@/components/translated';
import { Icon } from '@/components/ui';
import { cx } from '@/components/ui/cx';

/**
 * The three prediction products' lanes (T-1388, D-206; CLAUDE.md rule 6).
 * Each product gets its own frame: its own colour (the model, founder and
 * community tokens, which belong to these three and to nothing else), its
 * own icon and its own name above its panel. Never averaged, never one
 * combined number, never relabelled.
 *
 * **Three components, written out three times, on purpose.** A single
 * `Lane` taking a product name would be the "one panel that takes whichever
 * product it is given" `three-products.spec.ts` exists to refuse: the day a
 * page passes the wrong one, the reader is told the model said what the
 * founder said. Here a lane cannot be handed another product's colour or
 * name, because it has no prop that chooses one. The panel inside each lane
 * is still that product's own component, and says its own source line.
 *
 * `ThreeProductsNote` is the footnote where the three meet on one page.
 */

// On a surface card, not a tint of the product's colour (T-1491): the model's
// turquoise reaches 4.5:1 on the Day ground with little to spare (4.62:1), and
// an 8% tint of itself took the lane's own name to 4.18:1. The colour stays on
// the top edge, the name and the icon.
const FRAME = 'flex flex-col gap-3 rounded-tile border-t-3 bg-surface p-4';
const KICKER = 'flex items-center gap-2 text-sm font-extrabold tracking-wide';

/** The statistical model's lane: the model colour and the bars icon. */
export function ModelLane({
  locale,
  children,
  className,
}: {
  locale: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(FRAME, 'border-model', className)} data-lane="model">
      <p className={cx(KICKER, 'text-model')}>
        <Icon name="model" />
        <Translated locale={locale} message="lanes.model.title" />
      </p>
      {children}
    </div>
  );
}

/** The founder's analysis lane: the founder colour and the person icon. */
export function FounderLane({
  locale,
  children,
  className,
}: {
  locale: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(FRAME, 'border-founder', className)} data-lane="founder">
      <p className={cx(KICKER, 'text-founder')}>
        <Icon name="founder" />
        <Translated locale={locale} message="lanes.founder.title" />
      </p>
      {children}
    </div>
  );
}

/** The community picks lane: the community colour and the people icon. */
export function CommunityLane({
  locale,
  children,
  className,
}: {
  locale: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(FRAME, 'border-community', className)} data-lane="community">
      <p className={cx(KICKER, 'text-community')}>
        <Icon name="community" />
        <Translated locale={locale} message="lanes.community.title" />
      </p>
      {children}
    </div>
  );
}

/** "Three separate products…": said once where the three appear together. */
export function ThreeProductsNote({ locale, className }: { locale: string; className?: string }) {
  return (
    <p className={cx('text-sm text-caption', className)} data-testid="three-products-note">
      <Translated locale={locale} message="lanes.note" />
    </p>
  );
}
