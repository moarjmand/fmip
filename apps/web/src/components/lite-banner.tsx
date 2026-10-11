'use client';

import { useFormStatus } from 'react-dom';
import { useLite } from '@/components/lite-mode';
import { MessageText } from '@/components/message-text';
import { Icon } from '@/components/ui/icons';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import type { Message } from '@/i18n/messages';
import type { LITE_BANNER_KEYS } from '@/lib/lite';
import { setLiteAction } from '@/lib/theme-actions';

/**
 * Lite mode's indicator (T-1387, D-205; the Hybrid board's "Lite-mode
 * indicator"): a thin banner under the header whenever lite mode is on,
 * never a modal. It says why -- "slow connection detected" when `auto` found
 * one, plainly "Lite mode on" when the reader chose it -- and carries a
 * switch that turns lite mode off and remembers that (`fmip_lite=off`).
 *
 * The switch is a submit button in a form posting the server action, so it
 * works before the page's script has loaded, which on a slow connection may
 * be a while. While the post is on its way the switch already shows off.
 */

export type LiteBannerWords = Record<(typeof LITE_BANNER_KEYS)[number], Message>;

export function LiteBanner({ words }: { words: LiteBannerWords }) {
  const { on, reason } = useLite();
  if (!on) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 border-b border-accent/30 bg-accent/10 px-3 text-xs font-semibold md:text-sm"
      data-testid="lite-banner"
      data-reason={reason ?? undefined}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 py-1">
        <Icon name="bolt" className="text-accent" />
        <MessageText
          message={reason === 'slow' ? words['lite.banner.slow'] : words['lite.banner.chosen']}
        />
      </span>
      <form action={setLiteAction} className="flex shrink-0">
        <LiteOffSwitch label={words['lite.switch']} />
      </form>
    </div>
  );
}

/** The switch itself: on while lite mode is; pressing it posts `lite=off`. */
export function LiteOffSwitch({ label }: { label: Message }) {
  const { pending } = useFormStatus();
  const on = !pending;
  return (
    <button
      type="submit"
      name="lite"
      value="off"
      role="switch"
      aria-checked={on}
      aria-label={label.text}
      lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
      className="grid h-11 w-13 shrink-0 cursor-pointer place-items-center rounded-control"
      data-testid="lite-switch"
    >
      <span
        aria-hidden="true"
        className={`relative block h-6.5 w-11 rounded-pill transition-colors ${on ? 'bg-accent' : 'bg-muted'}`}
      >
        <span
          className={`absolute top-0.75 size-5 rounded-full bg-on-accent ${on ? 'end-0.75' : 'start-0.75'}`}
        />
      </span>
    </button>
  );
}

/** The line at the foot of a lite page: what it leaves out. */
export function LiteFootnote({ words }: { words: LiteBannerWords }) {
  const { on } = useLite();
  if (!on) return null;
  return (
    <p className="page-frame py-3 text-xs text-caption" data-testid="lite-footnote">
      <MessageText message={words['lite.footnote']} />
    </p>
  );
}
