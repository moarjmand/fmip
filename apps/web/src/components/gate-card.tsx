import type { ReactNode } from 'react';
import { Translated } from '@/components/translated';
import { ButtonLink, Icon } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { GATES, type GateRoute, gateLinks } from '@/lib/gate';

/**
 * The gate of a member-only page (T-1736, D-358). A guest who asks for the
 * page sees its name, one sentence on what it gives a member, and the two
 * ways in: Create account, the view's one saffron button, then Sign in. Both
 * carry the page as the return address (`lib/return-to.ts`), so either brings
 * the reader back here. A server component: two links, no script.
 *
 * `heading` is the name's rank in the page's outline: `h1` where the gate is
 * the whole page, `h2` where the page keeps its own title above it, and there
 * `compact` keeps it short: less room inside, the buttons side by side.
 */
export function GateCard({
  locale,
  route,
  heading = 'h1',
  compact = false,
  eyebrow,
  children,
}: {
  locale: string;
  route: GateRoute;
  heading?: 'h1' | 'h2';
  compact?: boolean;
  /** A short line above the name (the You tab's "You"). */
  eyebrow?: ReactNode;
  /** A line under the buttons, inside the card. */
  children?: ReactNode;
}) {
  const gate = GATES[route];
  const links = gateLinks(locale, route);
  const Heading = heading;
  return (
    <section
      className={cx(
        'flex flex-col rounded-card border border-default bg-surface',
        compact ? 'gap-3 p-4' : 'gap-4 p-5 sm:p-8',
      )}
      data-testid="gate-card"
      data-gate={route}
    >
      {!compact && (
        <span className="grid size-12 place-items-center rounded-tile border border-default bg-surface-raised text-accent">
          <Icon name={gate.icon} size={24} />
        </span>
      )}
      <div className="flex flex-col gap-2">
        {eyebrow !== undefined && (
          <p className="text-xs font-extrabold text-muted uppercase ltr:tracking-widest">
            {eyebrow}
          </p>
        )}
        <Heading
          className={cx(
            'font-extrabold font-stretch-semi-expanded',
            compact ? 'text-lg' : 'text-2xl',
          )}
          data-testid="gate-title"
        >
          <Translated locale={locale} message={gate.title} />
        </Heading>
        <p className="text-muted" data-testid="gate-value">
          <Translated locale={locale} message={gate.value} />
        </p>
      </div>
      <div
        className={cx('flex gap-3', compact ? 'flex-wrap' : 'flex-col sm:flex-row sm:flex-wrap')}
      >
        <ButtonLink href={links.register} variant="primary" size="md" data-testid="gate-register">
          <Translated locale={locale} message="shell.register" />
        </ButtonLink>
        <ButtonLink href={links.login} variant="secondary" size="md" data-testid="gate-sign-in">
          <Translated locale={locale} message="nav.signIn" />
        </ButtonLink>
      </div>
      {children}
    </section>
  );
}

/** A member-only page as a guest sees it: the gate, alone, where the page would be. */
export function GatePage({ locale, route }: { locale: string; route: GateRoute }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 sm:px-8 sm:py-14">
      <GateCard locale={locale} route={route} />
    </main>
  );
}
