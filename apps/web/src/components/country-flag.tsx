import { mediaSized, type EntityMedia } from '@fmip/contracts';
import { drawable } from '@/components/entity-image';
import { Pictured } from '@/components/lite-mode';
import { cx } from '@/components/ui/cx';

/**
 * A country's flag, and the two region marks beside it (T-1612, D-283).
 *
 * The flag is the provider's, copied once to our own origin (T-1611, D-282)
 * and drawn from there like a crest (`drawable`: only `/api/media/...`). It
 * keeps a flag's 4:3 shape, with a hairline so a white field reads on the Day
 * theme. Without one -- not fetched yet, or none -- it is a neutral box with
 * the country's code in a dashed outline: plainly no flag, never a stand-in
 * that could pass for one (rule 3). In lite mode the same box, marked as an
 * image left out.
 *
 * International and continental groups have no country and no flag: a globe
 * and a folded map, drawn here, stand for them.
 *
 * Decorative: the country's or region's name is always beside it.
 */

export type MarkSize = 'sm' | 'md';

const BOX: Record<MarkSize, { width: number; height: number; className: string }> = {
  sm: { width: 24, height: 18, className: 'h-[18px] w-6' },
  md: { width: 32, height: 24, className: 'h-6 w-8' },
};

export function CountryFlag({
  flag,
  code,
  size = 'md',
  aboveFold = false,
}: {
  flag: EntityMedia | undefined;
  /** The country's FIFA trigram, the neutral box's letters. */
  code: string | null;
  size?: MarkSize;
  aboveFold?: boolean;
}) {
  const box = BOX[size];
  const empty = (omitted: boolean) => (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[3px] border border-dashed border-strong bg-surface-raised text-[8px] leading-none font-bold tracking-wide text-muted select-none before:content-[attr(data-letters)]',
        box.className,
      )}
      data-testid="country-flag"
      data-coverage={omitted ? 'available' : 'not_supplied'}
      data-omitted={omitted ? 'lite' : undefined}
      data-letters={(code ?? '').slice(0, 3).toUpperCase()}
    />
  );
  if (!drawable(flag)) return empty(false);
  return (
    <Pictured fallback={empty(true)}>
      {/* A plain image on purpose, as EntityImage draws one: no optimiser route, no client JS. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaSized(flag.url, box.width)}
        width={box.width}
        height={box.height}
        alt=""
        loading={aboveFold ? 'eager' : 'lazy'}
        decoding={aboveFold ? 'auto' : 'async'}
        className={cx(
          'shrink-0 rounded-[3px] border border-default object-cover shadow-sm',
          box.className,
        )}
        data-testid="country-flag"
        data-coverage="available"
      />
    </Pictured>
  );
}

/** The mark of a region group: a globe for international, a folded map for continental. */
export function RegionMark({
  region,
  size = 'md',
}: {
  region: 'international' | 'continental' | 'all';
  size?: MarkSize;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[3px] bg-accent/15 text-accent',
        BOX[size].className,
      )}
      data-testid="region-mark"
      data-mark={region}
    >
      <svg
        viewBox="0 0 24 24"
        className={size === 'md' ? 'size-[18px]' : 'size-3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {region === 'international' ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3Z" />
          </>
        ) : region === 'continental' ? (
          <>
            <path d="M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20Z" />
            <path d="M8.5 4v13.5M15.5 6.5V20" />
          </>
        ) : (
          <>
            <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
          </>
        )}
      </svg>
    </span>
  );
}
