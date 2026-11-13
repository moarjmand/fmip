'use client';

import type { MatchCentre } from '@fmip/contracts';
import { unstable_isUnrecognizedActionError, useRouter } from 'next/navigation';
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
  type LiveSignature,
  NO_REFRESH,
  type RefreshReason,
  liveChange,
  liveParts,
  liveSignature,
  modulesBehind,
  planRefresh,
  refreshDue,
  refreshSettled,
  refreshStarted,
} from '@/lib/live-modules';
import { refreshLiveModules } from '@/lib/live-modules-actions';
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
 * The moving modules the server draws (D-409; the key events since T-1811)
 * are drawn again through one read-only server function, `refreshLiveModules`,
 * and only when a snapshot changed what they read: never for the clock, an
 * event within three seconds, statistics within fifteen (`lib/live-modules`).
 * A call that fails keeps the modules on screen, never the live view's
 * place; after a deploy the function this page knows is gone, and one render
 * of the page takes the new build.
 */

/** Collapse a burst of panel events -- three in a second is one render, not three. */
const PANEL_REFRESH_MS = 400;
export function LiveMatch({
  initial,
  timeZone,
  locale,
  slots,
  hero = {},
  words,
}: {
  initial: MatchCentre;
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
  // The server modules drawn again by `refreshLiveModules` (D-409), and the
  // page's slots they were asked against: a later render of the page brings
  // newer slots of its own, which then win.
  const [fresh, setFresh] = useState<{ from: MatchSlots; slots: MatchSlots } | null>(null);
  // When a change the server modules read was first seen and not yet drawn.
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const id = initial.fixture.id;
  const router = useRouter();

  // What the stream's listener reads without starting again: the page's
  // slots, the newest snapshot, and the signature the modules on screen
  // were drawn from.
  const slotsRef = useRef(slots);
  const seen = useRef(initial);
  const drawn = useRef<LiveSignature>(liveSignature(initial));
  useEffect(() => {
    if (slotsRef.current === slots) return;
    // The page was drawn again (a status change, a panel event): its slots
    // are as new as the snapshot the stream last sent.
    slotsRef.current = slots;
    drawn.current = liveSignature(seen.current);
    setWaitingSince(null);
  }, [slots]);

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
    // in flight at most, and what it was asked for.
    let plan = NO_REFRESH;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let asked: LiveSignature | null = null;
    let skewed = false;
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
    const call = (): void => {
      plan = refreshStarted(plan);
      const from = slotsRef.current;
      const signature = liveSignature(seen.current);
      asked = signature;
      refreshLiveModules(id, locale, timeZone)
        .then(
          (modules) => {
            if (stopped || modules === null) return;
            drawn.current = signature;
            setFresh({ from, slots: modules });
            if (liveChange(signature, liveSignature(seen.current), liveParts(from)) === null) {
              setWaitingSince(null);
            }
          },
          (error: unknown) => {
            // After a deploy this page's function is unknown to the server:
            // one render of the page, which then loads the new build (the
            // router sees the build changed). Anything else keeps what is drawn.
            if (stopped || skewed || !unstable_isUnrecognizedActionError(error)) return;
            skewed = true;
            router.refresh();
          },
        )
        .finally(() => {
          asked = null;
          if (stopped) return;
          const next = refreshSettled(plan);
          plan = next.plan;
          if (next.call) call();
          else arm();
        });
    };
    // Plan a call when the server modules on screen read something older
    // than the newest snapshot (or the stream reopened after a break).
    const consider = (reason?: RefreshReason): void => {
      const parts = liveParts(slotsRef.current);
      if (parts.length === 0) return;
      const latest = liveSignature(seen.current);
      const change = reason ?? liveChange(asked ?? drawn.current, latest, parts);
      if (change === null) return;
      const at = Date.now();
      plan = planRefresh(plan, change, { now: at, random: Math.random(), lite });
      // A statistics change held on purpose in lite mode is not "behind".
      if (change !== 'reopen' && !(lite && change === 'stats')) {
        setWaitingSince((since) => since ?? at);
      }
      arm();
    };

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
      stop();
    };
  }, [id, router, words, locale, lite, timeZone]);

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
  const behind = modulesBehind(waitingSince, now);
  return (
    <LiveClockProvider value={{ now, behind }}>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="live-announcements"
        // The stream's state, for a page that draws no line about it (T-1743).
        data-stream={state}
        // Whether the server modules may be behind the stream (D-409).
        data-modules={behind ? 'behind' : 'current'}
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
