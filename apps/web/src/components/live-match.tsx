'use client';

import type { MatchCentre } from '@fmip/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { type MatchHero, MatchCentreView, type MatchSlots } from '@/components/match-centre-view';
import { LiveClockProvider } from '@/components/live-age';
import { matchAnnouncements } from '@/lib/announce';
import { withLocale } from '@/lib/locale-query';
import { FreshnessStamp } from '@/components/freshness-stamp';
import { useLite } from '@/components/lite-mode';
import {
  INITIAL_CLOCK,
  type LiveClock,
  liveLabel,
  liveState,
  showsLiveLine,
  staleAfterMs,
} from '@/lib/live';
import {
  LIVE_FORMAT,
  LIVE_PARTS,
  type LiveAnswer,
  type LiveSignature,
  type LiveSlot,
  MAX_FOLLOW_UPS,
  NO_REFRESH,
  type PerPart,
  type RefreshReason,
  both,
  changedParts,
  liveChange,
  liveParts,
  liveSignature,
  markDrawn,
  modulesBehind,
  planFollowUp,
  liveModulesPath,
  planRefresh,
  refreshDue,
  refreshSettled,
  refreshStarted,
} from '@/lib/live-modules';
import { fromWire } from '@/components/live-wire';
import { openLiveSource } from '@/lib/live-source';
import { signalLiveMoved } from '@/lib/live-signal';
import type { MatchWords } from '@/lib/words-server';

/**
 * The match centre that stays current (T-032, T-034): renders the server's
 * snapshot, then subscribes to the web app's `/api/fixtures/:id/stream` and
 * replaces the whole payload on every `snapshot`. While a match is in play
 * the freshness line is the same one the scores page uses; before kick-off
 * the stream is said only when it has broken (T-1743).
 *
 * The same stream says when the public discussion moved (T-254, D-068): a
 * `panel` event carries nothing to render, and the page asks the server to
 * render itself again -- the shape `LiveConversation` set, so there is one
 * way a post can look. Collapsed, because a reply and the reaction it draws
 * are two events and one change to what the reader sees. A change of the
 * match's status (kick-off, full time, a suspension) asks for the same one
 * render (D-409 point 3): the outcome card, the pick's lock and the summary
 * change with it.
 *
 * The moving modules the server draws (D-409) are drawn again from one
 * public address, `/api/fixtures/:id/live.js` (D-422), that Cloudflare keeps
 * for two seconds, and only when a snapshot changed what they read: never for
 * the clock, an event within three seconds, statistics within fifteen
 * (`lib/live-modules`). A request that fails keeps the modules on screen,
 * never the live view's place; an answer from another server process (a
 * deploy) asks for one render of the page, which takes the new build.
 */

/** Collapse a burst of panel events -- three in a second is one render, not three. */
const PANEL_REFRESH_MS = 400;
/** After a deploy, at most one render of the page a minute while answers come from elsewhere. */
const SKEW_REFRESH_MS = 60_000;
const SKEW_KEY = 'fmip-live-skew';

/** Whether a render of the page may be asked now for an answer from another process. */
function mayRefreshForSkew(now: number): boolean {
  try {
    const last = Number(sessionStorage.getItem(SKEW_KEY) ?? '0');
    if (now - last <= SKEW_REFRESH_MS) return false;
    sessionStorage.setItem(SKEW_KEY, String(now));
    return true;
  } catch {
    // No storage (a private window): once per page load instead.
    if (skewedThisLoad) return false;
    skewedThisLoad = true;
    return true;
  }
}
let skewedThisLoad = false;
export function LiveMatch({
  initial,
  timeZone,
  locale,
  slots,
  hero = {},
  words,
  instance,
}: {
  initial: MatchCentre;
  /**
   * The server process that drew the page (`serverInstance`, D-422): the live
   * modules' answers name theirs, and one from another process means a deploy.
   */
  instance: string;
  timeZone: string;
  locale: string;
  /**
   * Server-rendered panels -- prediction (T-050), forecast (T-065) and the
   * rest -- each placed by the view in its own section of the page (T-605).
   */
  slots: MatchSlots;
  /** Where to watch and the highlight, for the score band (T-1384). */
  hero?: Omit<MatchHero, 'live'>;
  /** The reader's words, resolved by the page on the server (T-1303). */
  words: MatchWords;
}) {
  const [centre, setCentre] = useState(initial);
  const [clock, setClock] = useState<LiveClock>(INITIAL_CLOCK);
  const [now, setNow] = useState(() => Date.now());
  // What the last snapshot changed, in words, for the polite live region (T-081).
  const [announcement, setAnnouncement] = useState('');
  // The server modules drawn again by the live modules' address (D-409), and the
  // page's slots they were asked against: a later render of the page brings
  // newer slots of its own, which then win.
  const [fresh, setFresh] = useState<{ from: MatchSlots; slots: MatchSlots } | null>(null);
  // Per part: when a change the server modules read was first seen and not
  // yet drawn, and when the modules reading it were last drawn (D-409 point 4).
  const [waiting, setWaiting] = useState<PerPart<number | null>>({ events: null, stats: null });
  const [drawnAt, setDrawnAt] = useState<PerPart<number>>(() => both(Date.now()));
  const id = initial.fixture.id;
  const router = useRouter();

  // What the stream's listener reads without starting again: the page's
  // slots, the newest snapshot, the signature the modules on screen were
  // drawn from, and the newest answer drawn (the server's clock).
  const slotsRef = useRef(slots);
  const seen = useRef(initial);
  const drawn = useRef<LiveSignature>(liveSignature(initial));
  const drawnRead = useRef(0);
  const considerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (slotsRef.current === slots) return;
    // The page was drawn again (a status change, a panel event): its slots
    // are drawn from `initial`, the match as the page read it (review B2),
    // which a snapshot may already have passed. What is still behind waits
    // on, and is asked for at once.
    slotsRef.current = slots;
    drawn.current = liveSignature(initial);
    drawnRead.current = 0;
    setDrawnAt(both(Date.now()));
    const behind = changedParts(drawn.current, liveSignature(seen.current), LIVE_PARTS);
    setWaiting((was) => ({
      events: behind.includes('events') ? was.events : null,
      stats: behind.includes('stats') ? was.stats : null,
    }));
    considerRef.current?.();
  }, [slots, initial]);

  // Lite mode (T-1387): a snapshot a minute rather than an open stream.
  const { on: lite } = useLite();

  useEffect(() => {
    let stopped = false;
    let pageRefresh: ReturnType<typeof setTimeout> | null = null;
    // One render of the page, collapsed with any other asked in the same breath.
    const refreshPage = (): void => {
      if (pageRefresh !== null) return;
      pageRefresh = setTimeout(() => {
        pageRefresh = null;
        router.refresh();
      }, PANEL_REFRESH_MS);
    };

    // The server modules' refresh (D-409 point 3): when it is due, one call
    // in flight at most, what it was asked for, and whether the stream has
    // reopened since (then every part is asked for).
    let plan = NO_REFRESH;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let asked: LiveSignature | null = null;
    let reopened = false;
    // Follow-up calls in a row that came back still behind the stream.
    let followUps = 0;
    const arm = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (plan.due !== null) timer = setTimeout(fire, Math.max(0, plan.due - Date.now()));
    };
    const fire = (): void => {
      timer = null;
      const next = refreshDue(plan, Date.now());
      plan = next.plan;
      if (next.call) call();
      else arm();
    };
    const settle = (): void => {
      asked = null;
      if (stopped) return;
      const next = refreshSettled(plan);
      plan = next.plan;
      if (next.call) call();
      else arm();
    };
    const call = (): void => {
      plan = refreshStarted(plan);
      const from = slotsRef.current;
      const read = liveParts(from);
      const latest = liveSignature(seen.current);
      // Only the parts that changed (review m2); every part after a reopen.
      const want = reopened ? read : changedParts(drawn.current, latest, read);
      reopened = false;
      if (want.length === 0) {
        settle();
        return;
      }
      asked = markDrawn(drawn.current, latest, want);
      // The public address every reader of this match in this locale and
      // zone asks for these parts (D-422): Cloudflare answers most of them.
      fetch(liveModulesPath(id, { instance, locale, parts: want, timeZone }))
        .then((response) => (response.ok ? (response.json() as Promise<LiveAnswer>) : null))
        .then(
          (answer) => {
            if (stopped || answer === null) return;
            // Drawn by another server process (a deploy, a restart), or in
            // another shape: one render of the page, which loads the new
            // build when there is one (the router sees the build changed).
            if (answer.v !== LIVE_FORMAT || answer.instance !== instance) {
              // Once a minute at most, across loads too: a page kept at the
              // edge from before the deploy must not reload itself in a loop.
              if (mayRefreshForSkew(Date.now())) router.refresh();
              if (answer.v !== LIVE_FORMAT) return;
            }
            // An answer older than one already drawn is not drawn over it.
            if (answer.readAt < drawnRead.current) return;
            drawnRead.current = answer.readAt;
            // Only what the server drew is drawn, from the data it read (review B2).
            drawn.current = markDrawn(drawn.current, answer.drawn, answer.parts);
            const modules: MatchSlots = {};
            for (const [slot, card] of Object.entries(answer.modules)) {
              modules[slot as LiveSlot] = fromWire(card);
            }
            setFresh((was) => ({
              from,
              slots: { ...(was !== null && was.from === from ? was.slots : {}), ...modules },
            }));
            const at = Date.now();
            setDrawnAt((was) => ({
              events: answer.parts.includes('events') ? at : was.events,
              stats: answer.parts.includes('stats') ? at : was.stats,
            }));
            const still = changedParts(drawn.current, liveSignature(seen.current), answer.parts);
            setWaiting((was) => ({
              events:
                answer.parts.includes('events') && !still.includes('events') ? null : was.events,
              stats: answer.parts.includes('stats') && !still.includes('stats') ? null : was.stats,
            }));
            // The read was older than the snapshot that asked (it had started
            // before the change was written): ask again once the shared read
            // has expired, a few times at most; the next snapshot asks too.
            if (still.length > 0 && followUps < MAX_FOLLOW_UPS) {
              followUps += 1;
              plan = planFollowUp(plan, { now: at, random: Math.random() });
            } else if (still.length === 0) {
              followUps = 0;
            }
          },
          // A failed request or answer keeps what is drawn; the next snapshot asks again.
          () => undefined,
        )
        .finally(settle);
    };
    // Plan a call when the server modules on screen read something older
    // than the newest snapshot (or the stream reopened after a break).
    const consider = (reason?: RefreshReason): void => {
      const read = liveParts(slotsRef.current);
      if (read.length === 0) return;
      const latest = liveSignature(seen.current);
      const parts = changedParts(asked ?? drawn.current, latest, read);
      const change = reason ?? liveChange(asked ?? drawn.current, latest, read);
      if (change === null) return;
      if (reason === 'reopen') reopened = true;
      const at = Date.now();
      plan = planRefresh(plan, change, { now: at, random: Math.random(), lite });
      // A statistics change held on purpose in lite mode is not "behind".
      setWaiting((was) => ({
        events: parts.includes('events') ? (was.events ?? at) : was.events,
        stats: parts.includes('stats') && !lite ? (was.stats ?? at) : was.stats,
      }));
      arm();
    };
    considerRef.current = () => consider();

    let broken = false;
    const stamp = (snapshot: boolean): void =>
      setClock((c) => ({
        lastEventAt: Date.now(),
        lastSnapshotAt: snapshot ? Date.now() : c.lastSnapshotAt,
        broken: false,
      }));
    // The reader's names in every snapshot, as on the server-rendered page (T-1312).
    const stop = openLiveSource(
      withLocale(`/api/fixtures/${id}/stream`, locale),
      lite,
      (source) => {
        source.addEventListener('snapshot', (event) => {
          const next = JSON.parse((event as MessageEvent<string>).data) as MatchCentre;
          const before = seen.current;
          seen.current = next;
          setCentre((previous) => {
            const said = matchAnnouncements(previous, next, words);
            if (said.length > 0) {
              setAnnouncement(said.join(' '));
              // The matchday rail over the page asks for its scores now (T-1635).
              signalLiveMoved();
            }
            return next;
          });
          stamp(true);
          // Kick-off, full time, a suspension: the whole page changes (D-409).
          if (before.fixture.status !== next.fixture.status) refreshPage();
          else consider();
        });
        source.addEventListener('heartbeat', () => stamp(false));
        source.addEventListener('panel', () => {
          stamp(false);
          refreshPage();
        });
        source.addEventListener('stale', () => setClock((c) => ({ ...c, broken: true })));
        source.onerror = () => {
          broken = true;
          setClock((c) => ({ ...c, broken: true }));
        };
        source.onopen = () => {
          setClock((c) => ({ ...c, broken: false }));
          // Open again after a break: whatever was missed, and a deploy that
          // replaced the server function, are found by one call (D-409).
          if (broken) consider('reopen');
          broken = false;
        };
      },
    );
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      stopped = true;
      clearInterval(tick);
      if (pageRefresh !== null) clearTimeout(pageRefresh);
      if (timer !== null) clearTimeout(timer);
      considerRef.current = null;
      stop();
    };
  }, [id, router, words, locale, lite, timeZone, instance]);

  // In lite mode the threshold is a missed poll plus the usual slack (T-1387).
  const staleAfter = staleAfterMs(lite);
  const state = liveState(clock, now, staleAfter);
  const status = centre.fixture.status;
  // The stream's line sits in the score band, under the status (T-1384);
  // none once the match is over (T-1394): a result is not a live connection.
  // Before kick-off it is no counter either (T-1743, D-364): nothing on the
  // page is moving, and when its data was last checked is the band's own
  // line. The stream is only named there when it has broken, since a page
  // left open would then miss the kick-off (rule 4).
  const inPlay = status === 'live' || status === 'suspended';
  const broken = state === 'stale' || state === 'unavailable';
  const live = showsLiveLine(centre.fixture.status) ? (
    inPlay ? (
      <p
        className={`text-xs ${
          state === 'live'
            ? 'text-muted'
            : state === 'connecting'
              ? 'font-medium'
              : 'font-medium text-warning'
        }`}
        data-testid="live-state"
        data-state={state}
        role={broken ? 'status' : undefined}
      >
        {(state === 'live' || state === 'stale') && clock.lastEventAt !== null ? (
          // "Last checked 8 sec ago", amber with "may be behind" past the
          // stream's own threshold (T-1388); the other states keep their words.
          <FreshnessStamp
            checkedAt={clock.lastEventAt}
            now={now}
            staleAfterMs={staleAfter}
            behind={state === 'stale'}
            locale={locale}
            words={words.m}
          />
        ) : (
          liveLabel(state, clock, locale, timeZone, words.m)
        )}
      </p>
    ) : broken ? (
      <p
        className="text-xs font-medium text-warning"
        data-testid="live-state"
        data-state={state}
        role="status"
      >
        {liveLabel(state, clock, locale, timeZone, words.m)}
      </p>
    ) : undefined
  ) : undefined;
  // Per part, whether the server modules may be behind the stream (D-409 point 4).
  const behind: PerPart<boolean> = {
    events: modulesBehind(waiting.events, now),
    stats: modulesBehind(waiting.stats, now),
  };
  return (
    <LiveClockProvider value={{ now, behind, drawnAt }}>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="live-announcements"
        // The stream's state, for a page that draws no line about it (T-1743).
        data-stream={state}
        // Whether the server modules may be behind the stream (D-409).
        data-modules={behind.events || behind.stats ? 'behind' : 'current'}
      >
        {announcement}
      </div>
      <MatchCentreView
        centre={centre}
        timeZone={timeZone}
        locale={locale}
        now={now}
        slots={fresh !== null && fresh.from === slots ? { ...slots, ...fresh.slots } : slots}
        hero={{ ...hero, live, streamBroken: inPlay && broken }}
        words={words}
      />
    </LiveClockProvider>
  );
}
