import Link from '@/components/ui/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

/**
 * The buttons (T-603). One place for what a button looks like, so a form in
 * the admin desk and one in a group page press the same way. Server-component
 * safe: no state of its own; the caller's `useActionState` says when it is
 * pending.
 *
 *   primary    the one thing the view is for, on the bright saffron
 *   secondary  every other action, an outlined control (the common case;
 *              the Design System's "quiet")
 *   danger     an action that removes or refuses, outlined in the danger token
 *   ghost      an action that reads like a link: no edge, underlined
 *
 * Sizes follow what the product already used: `xs` inside a row of chips,
 * `sm` beside a line of text (most admin and social actions), `md` for a
 * form's own submit and every action a reader presses on a phone, which is a
 * 44px touch target (the Hybrid design, T-1388, D-206).
 *
 * The Stadiomind look (T-1493, D-263; the Design System's `Button`): the
 * control radius (`rounded-control`, 8px); the primary filled in the bright
 * saffron (`bg-brand`) with ink on it, in both themes, at most once per
 * view; the secondary an outline in the control edge (`border-strong`, not
 * the decorative hairline the Design System draws, which is never the only
 * sign of a control). A chosen toggle (`selected`, the pick buttons) takes the
 * saffron edge and a saffron tint, and says so in `aria-pressed`; its edge is
 * the accent, which keeps 3:1 on the Day ground where the bright fill does
 * not. A link that leaves the site is not a button variant: it is `LinkOut`
 * (`link-out.tsx`), which must name who hosts the destination.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border border-brand bg-brand font-extrabold text-on-brand hover:brightness-95',
  secondary: 'border border-strong font-bold',
  danger: 'font-medium border border-danger text-danger',
  ghost: 'underline',
};

/** The chosen one of a set of choices (a toggle that is on): the saffron edge and tint. */
const SELECTED = 'border-2 border-accent bg-brand/14 font-extrabold';

const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 py-0.5 text-xs',
  sm: 'px-3 py-1 text-sm',
  md: 'inline-flex min-h-touch items-center justify-center gap-2 px-4 py-2 text-sm',
};

/** A ghost button keeps the text's own size and no padding: it sits in a sentence. */
const GHOST_SIZES: Record<ButtonSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: '',
};

export interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * A choice that is on: the saffron edge and tint. On a `Button` it is also
   * `aria-pressed` (a caller's own `aria-pressed` wins).
   */
  selected?: boolean;
  className?: string;
}

/** The class list for a button-looking element; exported for the rare element that is not a <button> or a link. */
export function buttonClasses({
  variant = 'secondary',
  size = 'sm',
  selected = false,
  className,
}: ButtonStyle = {}): string {
  const look = variant === 'secondary' && selected ? SELECTED : VARIANTS[variant];
  const box = variant === 'ghost' ? GHOST_SIZES[size] : `rounded-control ${SIZES[size]}`;
  return cx(box, look, 'disabled:opacity-50', className);
}

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>, ButtonStyle {
  /**
   * Set while the form's action runs: the button is disabled and, when
   * `pendingLabel` is given, says what is happening instead of its label.
   */
  pending?: boolean;
  pendingLabel?: ReactNode;
}

export function Button({
  variant,
  size,
  selected,
  className,
  pending = false,
  pendingLabel,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // A button inside a form submits unless it says otherwise; the default
      // here is the safer `button`, and a submit says `type="submit"`.
      type={type}
      disabled={disabled === true || pending}
      aria-busy={pending ? true : undefined}
      aria-pressed={selected}
      className={buttonClasses({ variant, size, selected, className })}
      {...rest}
    >
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  );
}

export type ButtonLinkProps = Omit<ComponentProps<typeof Link>, 'className'> & ButtonStyle;

/** A link that looks like a button: navigation, not an action, so it stays an <a>. */
export function ButtonLink({ variant, size, selected, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, selected, className })} {...rest} />;
}
