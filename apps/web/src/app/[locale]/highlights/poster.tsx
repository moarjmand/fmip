import type { HighlightListItem, HighlightListTeam } from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import { MessageText } from '@/components/message-text';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { Icon, LinkOut } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import Link from '@/components/ui/link';
import { hostOf } from '@/components/viewing-panel';
import { formatDate } from '@/i18n/format';
import { message } from '@/i18n/messages';
import { pageLocale, say } from '@/lib/competition';
import { highlightsHref, type HighlightsQuery } from '@/lib/highlights';
import { withTerritory } from '@/lib/viewing';

/**
 * One clip as a match poster (T-1614, D-285): the competition's logo, both
 * crests large, the score, the date and a play badge on a pitch drawn in the
 * page's own lines, then the way out to the clip on its publisher's site
 * (`LinkOut`, naming the destination's host) and the way to the match page.
 *
 * The poster is drawn from our own crests and logos (D-176), never from a
 * frame of the video: the feed's clips are link-only (D-184), so no thumbnail
 * is shown and nothing here could pass for one. A missing crest is the
 * neutral lettered mark (rule 3). The whole poster opens the clip (the link
 * out's area is stretched over it); the competition and the match page are
 * their own links above it.
 */

type Look = 'featured' | 'card';

export function HighlightPoster({
  locale,
  item,
  timeZone,
  q,
  territory,
  look,
}: {
  locale: string;
  item: HighlightListItem;
  timeZone: string;
  /** The page's address, for the competition's filter link. */
  q: HighlightsQuery;
  /** A guest's territory, carried on the match link. */
  territory: string | undefined;
  look: Look;
}) {
  const { fixture } = item;
  const featured = look === 'featured';
  const host = hostOf(item.url);
  const name = (team: HighlightListTeam) => (featured ? team.name : (team.short_name ?? team.name));
  const matchup = say(locale, 'highlights.matchup', {
    home: fixture.home.name,
    away: fixture.away.name,
  });
  const Heading = featured ? 'h2' : 'h3';

  const stage = (
    <div
      className={cx(
        'relative flex flex-col bg-stage',
        featured ? 'gap-5 px-4 pt-4 pb-6 sm:px-8 sm:pt-6 sm:pb-8' : 'gap-3 px-3 pt-3 pb-4',
      )}
    >
      <Floodlight />
      <PitchLines />
      <div className="relative flex items-center justify-between gap-2 text-xs">
        <Link
          href={highlightsHref(locale, q, { competition: fixture.competition.id })}
          className="relative z-10 inline-flex min-h-touch min-w-0 items-center gap-2 font-semibold hover:underline md:min-h-6"
          data-testid="highlight-competition"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-default bg-canvas">
            <EntityImage
              media={fixture.competition.logo}
              kind="logo"
              name={fixture.competition.name}
              size={20}
              aboveFold={featured}
            />
          </span>
          <bdi className="truncate">{fixture.competition.name}</bdi>
        </Link>
        <time dateTime={fixture.kickoff_at} className="shrink-0 font-semibold text-muted">
          {formatDate(
            locale,
            fixture.kickoff_at,
            timeZone,
            featured
              ? { weekday: 'long', day: 'numeric', month: 'long' }
              : { weekday: 'short', day: 'numeric', month: 'short' },
          )}
        </time>
      </div>
      <Heading
        className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-4"
        data-testid="highlight-teams"
      >
        <Side team={fixture.home} name={name(fixture.home)} featured={featured} />
        <span
          className={cx('flex flex-col items-center gap-2', featured ? 'pt-4 sm:pt-7' : 'pt-2')}
        >
          {fixture.score === null ? (
            <span className="text-display-1 leading-none font-black text-muted">–</span>
          ) : (
            <Score
              locale={locale}
              home={fixture.score.home}
              away={fixture.score.away}
              separator="–"
              className={cx(
                'font-sans leading-none font-black font-stretch-condensed tabular-nums',
                featured ? 'text-display-2 sm:text-display-4' : 'text-display-1',
              )}
              testId="highlight-score"
            />
          )}
          {fixture.penalties !== null && (
            <span className="text-xs font-semibold text-muted" data-testid="highlight-penalties">
              {say(locale, 'highlights.penalties')}{' '}
              <Score locale={locale} home={fixture.penalties.home} away={fixture.penalties.away} />
            </span>
          )}
          <PlayBadge featured={featured} />
        </span>
        <Side team={fixture.away} name={name(fixture.away)} featured={featured} />
      </Heading>
      {item.restricted && (
        <p
          className="relative inline-flex items-center gap-1.5 self-center rounded-pill border border-default bg-surface px-3 py-1 text-xs font-semibold"
          data-testid="highlight-restricted"
        >
          <Icon name="limited" size={14} className="text-warning" />
          <Translated locale={locale} message="highlights.restricted" />
        </p>
      )}
    </div>
  );

  const ways = (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      <LinkOut
        href={item.url}
        host={host}
        look="button"
        icon="play"
        // The poster is the clip's link: its area covers the whole article.
        className="after:absolute after:inset-0"
        testId="highlight-link"
      >
        <Translated locale={locale} message="highlights.watch" />
        <span className="sr-only">: {matchup}</span>
      </LinkOut>
      <Link
        href={withTerritory(`/${locale}/match/${fixture.id}`, territory)}
        className="relative z-10 inline-flex min-h-touch items-center gap-1 px-3 text-sm font-semibold text-muted hover:text-fg hover:underline"
        data-testid="highlight-match"
      >
        <Translated locale={locale} message="viewing.matchCentre" />
        <span className="sr-only">: {matchup}</span>
        <Icon name="forward" size={14} />
      </Link>
    </div>
  );

  const publisher =
    item.publisher === null ? null : <Publisher locale={locale} publisher={item.publisher} />;

  if (featured) {
    return (
      <article
        className="group relative grid overflow-hidden rounded-card border border-default bg-surface hover:border-strong lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
        data-testid="highlight-item"
        data-look="featured"
        data-fixture={fixture.id}
      >
        {stage}
        <div className="flex flex-col justify-center gap-3 border-t border-default p-4 sm:p-6 lg:border-t-0 lg:border-s">
          <p className="inline-flex items-center gap-2 text-xs font-extrabold tracking-wide text-accent uppercase">
            <Icon name="play" size={14} />
            <Translated locale={locale} message="highlights.featured" />
          </p>
          {publisher}
          {ways}
        </div>
      </article>
    );
  }

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-tile border border-default bg-surface hover:border-strong"
      data-testid="highlight-item"
      data-look="card"
      data-fixture={fixture.id}
    >
      {stage}
      <div className="mt-auto flex flex-col gap-1 border-t border-default px-3 pt-2 pb-3">
        {publisher}
        {ways}
      </div>
    </article>
  );
}

/**
 * "By LaLiga": who published the clip, the name placed where the locale's
 * word order puts it and isolated from the sentence's direction. Both halves
 * keep the message's status, so an untranslated sentence is marked as such.
 */
function Publisher({ locale, publisher }: { locale: string; publisher: string }) {
  const sentence = message(pageLocale(locale), 'highlights.by');
  const at = sentence.text.indexOf(PUBLISHER);
  const before = at === -1 ? sentence.text : sentence.text.slice(0, at);
  const after = at === -1 ? '' : sentence.text.slice(at + PUBLISHER.length);
  return (
    <p className="min-w-0 text-xs text-muted" data-testid="highlight-publisher">
      {before !== '' && <MessageText message={{ ...sentence, text: before }} />}
      <bdi className="font-semibold text-fg">{publisher}</bdi>
      {after !== '' && <MessageText message={{ ...sentence, text: after }} />}
    </p>
  );
}

const PUBLISHER = '{publisher}';

/** A side of the poster: the crest on its plate, the name beneath. */
function Side({
  team,
  name,
  featured,
}: {
  team: HighlightListTeam;
  name: string;
  featured: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-2 text-center">
      <span
        className={cx(
          'grid shrink-0 place-items-center rounded-full border border-default bg-canvas shadow-sm',
          featured ? 'size-20 sm:size-32' : 'size-16',
        )}
      >
        <EntityImage
          media={team.crest}
          kind="crest"
          name={team.name}
          size={featured ? 96 : 48}
          aboveFold={featured}
          className={featured ? 'max-sm:size-12 max-sm:text-base' : undefined}
        />
      </span>
      <bdi
        className={cx(
          'line-clamp-2 leading-tight font-bold break-words',
          featured ? 'text-sm sm:text-lg' : 'text-sm',
        )}
      >
        {name}
      </bdi>
    </span>
  );
}

/**
 * The play badge: the brand's saffron disc with a play mark, drawn here, not
 * a video frame. Decorative: the link out beside it says what it opens. The
 * triangle points the way a player's does in either direction of text.
 */
function PlayBadge({ featured }: { featured: boolean }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={cx(
        'shrink-0 drop-shadow-sm motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-110',
        featured ? 'size-14 sm:size-16' : 'size-11',
      )}
      data-testid="highlight-play"
    >
      <circle cx="24" cy="24" r="24" className="fill-brand" />
      <path d="M19 14.5v19L34 24z" className="fill-on-brand" />
    </svg>
  );
}

/** The saffron light over the poster's top edge, in the theme's own colours. */
function Floodlight() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-radial-[at_50%_0%] from-brand/14 to-transparent to-70%"
    />
  );
}

/** The pitch's halfway line, centre circle and boxes, in hairlines, behind the poster. */
function PitchLines() {
  return (
    <svg
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 size-full fill-none stroke-muted/20"
      strokeWidth="1.5"
    >
      <rect x="8" y="8" width="384" height="204" rx="2" vectorEffect="non-scaling-stroke" />
      <path d="M200 8v204" vectorEffect="non-scaling-stroke" />
      <circle cx="200" cy="110" r="38" vectorEffect="non-scaling-stroke" />
      <path d="M8 58h56v104H8M392 58h-56v104h56" vectorEffect="non-scaling-stroke" />
      <path d="M8 86h20v48H8M392 86h-20v48h20" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
