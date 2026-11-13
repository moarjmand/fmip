import type { ReactNode } from 'react';
import type { Territory, ViewingTerritory } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import Link from '@/components/ui/link';
import { TerritoryChooser } from '@/components/viewing-panel';
import { territoryName } from '@/lib/territory';

const NONE = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

/**
 * Who a page's viewing answers are for, asked once (D-394; shared since
 * T-1806, D-405, so Highlights draws the Watch page's line rather than a
 * copy): "Watching from · Iran · Change territory" in one 48px line. A
 * member's territory lives in settings (T-312), so the line links there; a
 * guest's line is the summary of a native disclosure whose panel is the
 * existing chooser (`TerritoryChooser`, a GET form), so the pick goes into
 * the address. Under it, one sentence the page gives: what it needs, or
 * where its answers come from. No client JavaScript.
 */
export function TerritoryBar({
  locale,
  chosen,
  signedIn,
  territories,
  href,
  hidden,
  need,
  testId,
  label,
}: {
  locale: string;
  chosen: ViewingTerritory;
  signedIn: boolean;
  /** The chooser's territories, for a guest; `null` for a member or when they could not be read. */
  territories: Territory[] | null;
  /** Where the guest's chooser sends its pick. */
  href: string;
  /** What the chooser's form must carry besides the territory. */
  hidden: Record<string, string>;
  /** The page's sentence under the line. */
  need: ReactNode;
  /** `{testId}`, `{testId}-name`, `{testId}-choose`, `{testId}-need`. */
  testId: string;
  /** The block's name for a screen reader, when the page has no heading for it. */
  label?: string;
}) {
  const isChosen = chosen.state === 'chosen';
  const action = isChosen ? 'viewing.change' : 'viewing.choose';
  const line = (
    <>
      <span className="text-muted">
        <Translated locale={locale} message="watch.from" />
      </span>
      <span aria-hidden="true" className="text-caption">
        ·
      </span>
      <span className="font-semibold" data-testid={`${testId}-name`}>
        {isChosen ? (
          <bdi>{territoryName(locale, chosen.territory)}</bdi>
        ) : (
          <Translated locale={locale} message="viewing.notChosen" />
        )}
      </span>
    </>
  );
  const row = 'flex min-h-12 flex-wrap items-center gap-x-2 text-sm';
  const act = 'ms-auto inline-flex min-h-11 items-center font-semibold underline';
  return (
    <section
      aria-label={label}
      className="flex flex-col rounded-lg border border-default bg-surface px-4 pb-2"
      data-testid={testId}
      data-state={chosen.state}
    >
      {signedIn ? (
        <div className={row}>
          {line}
          <Link href={`/${locale}/settings#territory`} className={act}>
            <Translated locale={locale} message={action} />
          </Link>
        </div>
      ) : territories === null ? (
        <div className={row}>{line}</div>
      ) : (
        <details data-testid={`${testId}-choose`}>
          <summary className={`${row} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            {line}
            <span className={act}>
              <Translated locale={locale} message={action} />
            </span>
          </summary>
          <div className="pb-2">
            <TerritoryChooser
              locale={locale}
              viewing={{ fixture_id: '', territory: chosen, options: NONE, highlights: NONE }}
              signedIn={false}
              href={href}
              territories={territories}
              hidden={hidden}
            />
          </div>
        </details>
      )}
      <p className="text-xs text-muted" data-testid={`${testId}-need`}>
        {need}
      </p>
    </section>
  );
}
