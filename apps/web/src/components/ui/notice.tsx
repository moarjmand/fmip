import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/**
 * Notices and form results (T-603).
 *
 * A **Notice** is a sentence the page wants seen: a refusal, a stale figure, a
 * thing that went through. Its tone picks both the colour and the live-region
 * role: a danger or a warning interrupts (`alert`), information and success
 * wait their turn (`status`). A caller may still say otherwise with `role`.
 *
 * A **FormStatus** is what a server action answered, shown under the control
 * that sent it (`state.message` in every form built on `useActionState`). It
 * is quieter than a notice -- one line, no box -- unless `boxed`, the account
 * forms' style. The caller keeps the sentence (`{state.message}`) and the
 * decision of whether to show it; this only says how it looks and sounds.
 */

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<NoticeTone, string> = {
  info: 'border-default bg-surface',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
};

export interface NoticeProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  tone?: NoticeTone;
  /** `div` when the notice holds more than a sentence (a list, a link row). */
  as?: 'p' | 'div';
  className?: string;
  children: ReactNode;
}

export function noticeRole(tone: NoticeTone): 'alert' | 'status' {
  return tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
}

export function Notice({
  tone = 'info',
  as = 'p',
  className,
  role,
  children,
  ...rest
}: NoticeProps) {
  const Tag = as;
  return (
    <Tag
      role={role ?? noticeRole(tone)}
      className={cx('rounded border px-3 py-2 text-sm', TONES[tone], className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface FormStatusProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  /** The action's `state.ok`: a success is a status, a refusal an alert. */
  ok: boolean;
  size?: 'xs' | 'sm';
  /** `span` when the result sits on the same line as the button. */
  as?: 'p' | 'span';
  /** The bordered style of the account forms. */
  boxed?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormStatus({
  ok,
  size = 'sm',
  as = 'p',
  boxed = false,
  className,
  children,
  ...rest
}: FormStatusProps) {
  if (boxed) {
    return (
      <Notice
        tone={ok ? 'success' : 'danger'}
        as={as === 'span' ? 'p' : as}
        className={className}
        {...rest}
      >
        {children}
      </Notice>
    );
  }
  const Tag = as;
  return (
    <Tag
      role={ok ? 'status' : 'alert'}
      className={cx(
        size === 'xs' ? 'text-xs' : 'text-sm',
        ok ? 'text-muted' : 'text-danger',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
