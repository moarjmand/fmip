import { useId, type ReactNode } from 'react';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';

/**
 * The three prediction voices (the Design System's `Voice`, T-1509, D-263;
 * CLAUDE.md rule 6): the statistical model, the founder and the community,
 * each on its own card and never merged -- never averaged, never one
 * combined number, never relabelled. Each is told apart by how its name is
 * set, not by a shared frame in three colours: the model's name is a tag in
 * the mono face and the model's colour, the founder's is in the serif
 * italic, the community's in neutral capitals.
 *
 * **Three components, written out three times, on purpose.** A single
 * `Voice` taking a `kind` is how the Design System's reference is written,
 * and it is the "one panel that takes whichever product it is given"
 * `three-products.spec.ts` exists to refuse: the day a page passes the wrong
 * one, the reader is told the model said what the founder said. Here a voice
 * cannot be handed another product's name or look, because it has no prop
 * that chooses one. The panel inside each voice is still that product's own
 * component, and says its own source line.
 *
 * `empty` is the honest reason there is nothing to show, in place of the
 * content (rule 3). The section is named by its own name line for screen
 * readers. On Day the model's turquoise passes 4.5:1 on the bare card with
 * little to spare, so its tag is an outline, never a tint. Server-component
 * safe (`useId` is the only hook). `ThreeProductsNote` is the footnote where
 * the three meet on one page.
 */

const FRAME = 'flex flex-col gap-3 rounded-xl border border-default bg-surface p-4';

/** The honest reason a voice has nothing to show: a struck ring and a sentence. */
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-sm text-muted" data-voice-empty="">
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="2.5" y1="9.5" x2="9.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/** The statistical model's voice: its name as a tag in the mono face, in the model's colour. */
export function ModelVoice({
  locale,
  children,
  empty,
  className,
}: {
  locale: string;
  children?: ReactNode;
  /** Why there is no model forecast to show, in place of the content. */
  empty?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(FRAME, className)} data-voice="model">
      <p
        id={id}
        className={cx(
          'self-start rounded-sm border border-model px-2 py-0.5 font-mono text-xs font-semibold tracking-wide text-model uppercase',
          '[:root:is(:lang(fa),:lang(ar))_&]:font-sans [:root:is(:lang(fa),:lang(ar))_&]:normal-case',
        )}
      >
        <Translated locale={locale} message="lanes.model.title" />
      </p>
      {empty !== undefined ? <Empty>{empty}</Empty> : children}
    </section>
  );
}

/** The founder's voice: its name in the serif italic, which no other voice uses. */
export function FounderVoice({
  locale,
  children,
  empty,
  className,
}: {
  locale: string;
  children?: ReactNode;
  /** Why there is no analysis to show, in place of the content. */
  empty?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(FRAME, className)} data-voice="founder">
      <p
        id={id}
        className={cx(
          'font-serif text-lg leading-snug text-founder italic',
          '[:root:is(:lang(fa),:lang(ar))_&]:font-naskh [:root:is(:lang(fa),:lang(ar))_&]:not-italic',
        )}
      >
        <Translated locale={locale} message="lanes.founder.title" />
      </p>
      {empty !== undefined ? <Empty>{empty}</Empty> : children}
    </section>
  );
}

/** The community's voice: its name in neutral capitals and, when a split is shown, how many picked. */
export function CommunityVoice({
  locale,
  count,
  children,
  empty,
  className,
}: {
  locale: string;
  /** How many members' picks stand behind the split shown, said beside the name. */
  count?: number;
  children?: ReactNode;
  /** Why there is no split to show, in place of the content. */
  empty?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(FRAME, className)} data-voice="community">
      <p
        id={id}
        className={cx(
          'text-xs font-extrabold tracking-wider text-community uppercase',
          '[:root:is(:lang(fa),:lang(ar))_&]:normal-case',
        )}
      >
        <Translated locale={locale} message="lanes.community.title" />
        {count !== undefined && (
          <>
            {' · '}
            <Translated locale={locale} message="lanes.community.picked" count={count} />
          </>
        )}
      </p>
      {empty !== undefined ? <Empty>{empty}</Empty> : children}
    </section>
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
