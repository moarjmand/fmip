import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

/**
 * The buttons (T-603). One place for what a button looks like, so a form in
 * the admin desk and one in a group page press the same way. Server-component
 * safe: no state of its own; the caller's `useActionState` says when it is
 * pending.
 *
 *   primary    the one thing the form is for, on the green
 *   secondary  every other action, an outlined control (the common case)
 *   danger     an action that removes or refuses, outlined in the danger token
 *   ghost      an action that reads like a link: no edge, underlined
 *
 * Sizes follow what the product already used: `xs` inside a row of chips,
 * `sm` beside a line of text (most admin and social actions), `md` for a
 * form's own submit.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-medium text-on-accent',
  secondary: 'border border-strong',
  danger: 'border border-danger text-danger',
  ghost: 'underline',
};

/** The secondary edge when the control is the chosen one (a toggle that is on). */
const SELECTED = 'border border-accent';

const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 py-0.5 text-xs',
  sm: 'px-3 py-1 text-sm',
  md: 'px-4 py-2',
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
  /** A toggle that is on: the secondary edge turns to the accent. */
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
  const box = variant === 'ghost' ? GHOST_SIZES[size] : `rounded ${SIZES[size]}`;
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
