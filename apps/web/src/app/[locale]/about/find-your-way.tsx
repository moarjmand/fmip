import { Translated } from '@/components/translated';
import { Icon } from '@/components/ui/icons';
import Link from '@/components/ui/link';
import type { Locale } from '@/i18n/locales';
import { AboutIcon } from './about-icons';
import { TILE_GROUPS, type Tone, tileHref } from './about-content';

/**
 * "Find your way" (T-1615, D-286): the site's main sections as tiles, in
 * two groups -- the football, and the forecasts and predictions -- each tile
 * a link with one line on what is there. A forecast's tile wears its
 * product's colour, as its lane does in the diagram above it (rule 6).
 * Whole-tile links, so each one is a touch target well past 44px.
 */

const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent',
  model: 'text-model',
  founder: 'text-founder',
  community: 'text-community',
};

/** The forecast tiles' edge, as the diagram's lanes draw it. */
const TONE_EDGE: Record<Tone, string> = {
  accent: '',
  model: 'how-edge how-tone--model',
  founder: 'how-edge how-tone--founder',
  community: 'how-edge how-tone--community',
};

export function FindYourWay({ locale }: { locale: Locale }) {
  return (
    <section aria-labelledby="about-map" className="flex flex-col gap-4">
      <div className="flex max-w-3xl flex-col gap-2">
        <h2
          id="about-map"
          className="text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded"
        >
          <Translated locale={locale} message="about.map.title" />
        </h2>
        <p className="text-muted">
          <Translated locale={locale} message="about.map.intro" />
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {TILE_GROUPS.map((group) => (
          <div key={group.id} className="flex min-w-0 flex-col gap-3">
            <h3 className="text-sm font-extrabold tracking-wide text-caption uppercase">
              <Translated locale={locale} message={group.title} />
            </h3>
            <ul
              className={`grid gap-3 sm:grid-cols-2 ${group.tiles.length > 4 ? 'md:grid-cols-3' : 'lg:grid-cols-4 xl:grid-cols-2'}`}
              data-testid={`about-map-${group.id}`}
            >
              {group.tiles.map((tile) => (
                <li key={tile.id} className="min-w-0">
                  <Link
                    href={tileHref(locale, tile.path)}
                    className={`group flex h-full min-h-touch gap-3 rounded-tile border border-default bg-surface p-4 transition-colors hover:border-strong ${TONE_EDGE[tile.tone]}`}
                    data-testid={`about-tile-${tile.id}`}
                  >
                    <span
                      className={`grid size-10 shrink-0 place-items-center rounded-control bg-surface-raised ${TONE_TEXT[tile.tone]}`}
                    >
                      <AboutIcon name={tile.icon} size={22} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center justify-between gap-2 font-extrabold">
                        <Translated locale={locale} message={tile.name} />
                        <Icon name="forward" className="text-caption group-hover:text-fg" />
                      </span>
                      <span className="text-sm text-muted">
                        <Translated locale={locale} message={tile.body} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
