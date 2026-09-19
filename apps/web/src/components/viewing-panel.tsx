import Link from 'next/link';
import type { MatchViewing, Territory, ViewingOption } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { territoryName, territoryOptions } from '@/lib/territory';
import {
  ACCESS_KEY,
  KIND_KEY,
  carriedTerritory,
  highlightsState,
  optionsState,
  serviceNames,
  withTerritory,
} from '@/lib/viewing';

/**
 * Where a match can be watched, and its highlight afterwards (blueprint 11,
 * T-314, T-315): one component, rendered in four places, one answer.
 *
 * Four sentences and never a fifth. No territory: the surface asks -- a
 * member is sent to settings, a guest gets a chooser whose pick travels in
 * the address, and nothing is read off an IP. A territory nobody declared:
 * "no viewing information yet for X", which is what is true. A territory a
 * source covers with nothing listed: "no official service listed", which is
 * then a fact. Listings: the service, its kind, the access, the kick-off in
 * the viewer's zone and the official destination, never a stream of ours.
 * After the match, the highlight: a player only from a source that grants
 * one, the official page from everybody, so there is never a dead player.
 *
 * `null` for `viewing` means the viewing service could not be reached, and
 * the surface says so rather than rendering an empty module (rule 3).
 */
interface Common {
  locale: string;
  timeZone: string;
  viewing: MatchViewing | null;
  kickoffAt: string;
  status: string;
  signedIn: boolean;
  /** The match page, for a guest's links and the chooser's action. */
  href: string;
}

type Props = Common &
  (
    | {
        variant: 'panel';
        /** For a guest's chooser; `null` when the list could not be loaded. */
        territories: Territory[] | null;
        /** Query values the chooser must keep, such as an explicit zone. */
        hidden?: Record<string, string>;
      }
    | { variant: 'line' }
  );

export function ViewingPanel(props: Props) {
  if (props.variant === 'line') return <ViewingLine {...props} />;
  const { locale, timeZone, viewing, kickoffAt, status, signedIn, href, territories } = props;
  if (viewing === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="viewing" data-state="unreachable">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="viewing.title" />
        </h2>
        <p role="alert">
          <Translated locale={locale} message="viewing.unreachable" />
        </p>
      </section>
    );
  }
  const state = optionsState(viewing);
  const name = nameOf(locale, viewing);
  const confirmed = viewing.options.last_updated_at ?? viewing.highlights.last_updated_at;
  const source = viewing.options.data?.[0]?.source ?? viewing.highlights.data?.[0]?.source ?? null;
  return (
    <section className="flex flex-col gap-3" data-testid="viewing" data-state={state}>
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="viewing.title" />
      </h2>
      <TerritoryChooser
        locale={locale}
        viewing={viewing}
        signedIn={signedIn}
        href={href}
        territories={territories}
        hidden={props.hidden ?? {}}
      />
      {state === 'ask' && (
        <p data-testid="viewing-ask">
          <Translated locale={locale} message="viewing.ask" />
        </p>
      )}
      {state === 'not_supplied' && (
        <p data-testid="viewing-not-supplied">
          <Translated locale={locale} message="viewing.noInfo" /> {name}.
        </p>
      )}
      {state === 'nothing_listed' && (
        <p data-testid="viewing-nothing-listed">
          <Translated locale={locale} message="viewing.nothingListed" /> {name}.
        </p>
      )}
      {state === 'listed' && viewing.options.data !== null && (
        <ul className="flex flex-col gap-2" data-testid="viewing-options">
          {viewing.options.data.map((option) => (
            <Option
              key={option.id}
              option={option}
              locale={locale}
              timeZone={timeZone}
              kickoffAt={kickoffAt}
            />
          ))}
        </ul>
      )}
      {status === 'finished' && state !== 'ask' && (
        <Highlights locale={locale} viewing={viewing} name={name} />
      )}
      {confirmed !== null && state !== 'ask' && (
        <p className="text-xs opacity-70" data-testid="viewing-confirmed">
          {source !== null && (
            <>
              <Translated locale={locale} message="viewing.source" /> {source.name} {'· '}
            </>
          )}
          <Translated locale={locale} message="viewing.confirmed" />{' '}
          <time dateTime={confirmed}>{formatDateTime(locale, confirmed, timeZone)}</time>
        </p>
      )}
    </section>
  );
}

/** A message as a plain string, for an attribute or an option label, in the locale or English. */
function text(locale: string, key: MessageKey): string {
  return message(isLocale(locale) ? locale : DEFAULT_LOCALE, key).text;
}

function nameOf(locale: string, viewing: MatchViewing): string | null {
  return viewing.territory.state === 'chosen'
    ? territoryName(locale, viewing.territory.territory)
    : null;
}

/**
 * Who the answer is for, and how to change it. A member's territory lives in
 * settings (T-312); a guest has nowhere to keep one, so the chooser is a
 * plain form whose pick goes into the address and follows them by link.
 */
export function TerritoryChooser({
  locale,
  viewing,
  signedIn,
  href,
  territories,
  hidden,
}: {
  locale: string;
  viewing: MatchViewing;
  signedIn: boolean;
  href: string;
  territories: Territory[] | null;
  hidden: Record<string, string>;
}) {
  const chosen = viewing.territory.state === 'chosen' ? viewing.territory.territory : null;
  const name = nameOf(locale, viewing);
  if (signedIn) {
    return (
      <p className="text-sm opacity-80" data-testid="viewing-territory">
        {chosen !== null && (
          <>
            <Translated locale={locale} message="viewing.in" /> {name} {'· '}
          </>
        )}
        <Link href={`/${locale}/settings#territory`} className="underline">
          <Translated
            locale={locale}
            message={chosen === null ? 'viewing.choose' : 'viewing.change'}
          />
        </Link>
      </p>
    );
  }
  if (territories === null) {
    return (
      <p className="text-sm opacity-80" data-testid="viewing-territory">
        {chosen !== null ? (
          <>
            <Translated locale={locale} message="viewing.in" /> {name}
          </>
        ) : (
          <Translated locale={locale} message="viewing.choose" />
        )}
      </p>
    );
  }
  return (
    <form
      method="get"
      action={href}
      className="flex flex-wrap items-end gap-2 text-sm"
      data-testid="viewing-territory-form"
    >
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <label className="flex flex-col gap-1">
        <span>
          <Translated locale={locale} message="viewing.askLabel" />
        </span>
        <select
          name="territory"
          defaultValue={chosen?.code ?? ''}
          className="rounded border px-2 py-1"
        >
          {territoryOptions(locale, territories, text(locale, 'viewing.notChosen')).map(
            (option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ),
          )}
        </select>
      </label>
      <button type="submit" className="rounded border px-3 py-1">
        <Translated locale={locale} message="viewing.askSubmit" />
      </button>
    </form>
  );
}

function Option({
  option,
  locale,
  timeZone,
  kickoffAt,
}: {
  option: ViewingOption;
  locale: string;
  timeZone: string;
  kickoffAt: string;
}) {
  const name =
    option.broadcaster.homepage_url === null ? (
      <span className="font-medium">{option.broadcaster.name}</span>
    ) : (
      <a
        href={option.broadcaster.homepage_url}
        rel="noopener noreferrer"
        className="font-medium underline"
      >
        {option.broadcaster.name}
      </a>
    );
  return (
    <li
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
      data-testid="viewing-option"
      data-access={option.access}
    >
      {name}
      <span className="text-xs uppercase tracking-wide opacity-70">
        <Translated locale={locale} message={KIND_KEY[option.broadcaster.kind]} />
      </span>
      <span className="text-sm">
        <Translated locale={locale} message={ACCESS_KEY[option.access]} />
      </span>
      <span className="text-sm opacity-70">
        <Translated locale={locale} message="viewing.kickoff" />{' '}
        <time dateTime={kickoffAt}>{formatDateTime(locale, kickoffAt, timeZone)}</time>
      </span>
      <a
        href={option.url}
        rel="noopener noreferrer"
        className="text-sm underline"
        data-testid="viewing-official"
      >
        <Translated locale={locale} message="viewing.officialPage" />
      </a>
    </li>
  );
}

function Highlights({
  locale,
  viewing,
  name,
}: {
  locale: string;
  viewing: MatchViewing;
  name: string | null;
}) {
  const state = highlightsState(viewing);
  const highlight = viewing.highlights.data?.[0];
  return (
    <div className="flex flex-col gap-2" data-testid="viewing-highlights" data-state={state}>
      <h3 className="font-semibold">
        <Translated locale={locale} message="viewing.highlights" />
      </h3>
      {state === 'not_supplied' && (
        <p>
          <Translated locale={locale} message="viewing.highlightsNoInfo" /> {name}.
        </p>
      )}
      {state === 'none' && (
        <p>
          <Translated locale={locale} message="viewing.highlightsNone" /> {name}.
        </p>
      )}
      {highlight !== undefined && (state === 'page' || state === 'embed') && (
        <>
          {state === 'embed' && highlight.embed_url !== null && (
            <iframe
              src={highlight.embed_url}
              title={text(locale, 'viewing.highlightsPlayer')}
              className="aspect-video w-full"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              data-testid="viewing-embed"
            />
          )}
          <a
            href={highlight.url}
            rel="noopener noreferrer"
            className="underline"
            data-testid="viewing-highlight-page"
          >
            <Translated locale={locale} message="viewing.highlightsPage" />
          </a>
        </>
      )}
    </div>
  );
}

/** The same answer in one line, for a fixture list and the feed. */
function ViewingLine({ locale, viewing, status, signedIn, href }: Common) {
  if (viewing === null) {
    return (
      <p className="text-xs opacity-70" data-testid="viewing-line" data-state="unreachable">
        <Translated locale={locale} message="viewing.unreachable" />
      </p>
    );
  }
  const state = optionsState(viewing);
  const name = nameOf(locale, viewing);
  const highlight = status === 'finished' ? viewing.highlights.data?.[0] : undefined;
  return (
    <p className="text-xs opacity-80" data-testid="viewing-line" data-state={state}>
      {state === 'ask' && (
        <Link href={signedIn ? `/${locale}/settings#territory` : href} className="underline">
          <Translated locale={locale} message="viewing.choose" />
        </Link>
      )}
      {state === 'not_supplied' && (
        <>
          <Translated locale={locale} message="viewing.noInfo" /> {name}
        </>
      )}
      {state === 'nothing_listed' && (
        <>
          <Translated locale={locale} message="viewing.nothingListed" /> {name}
        </>
      )}
      {state === 'listed' && viewing.options.data !== null && (
        <>
          <Translated locale={locale} message="viewing.on" /> {serviceNames(viewing.options.data)}
          {' · '}
          <Link
            href={withTerritory(href, carriedTerritory(viewing, signedIn))}
            className="underline"
          >
            <Translated locale={locale} message="viewing.matchCentre" />
          </Link>
        </>
      )}
      {highlight !== undefined && (
        <>
          {' · '}
          <a href={highlight.url} rel="noopener noreferrer" className="underline">
            <Translated locale={locale} message="viewing.highlightsPage" />
          </a>
        </>
      )}
    </p>
  );
}
