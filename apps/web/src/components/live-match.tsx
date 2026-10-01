'use client';

import type { MatchCentre } from '@fmip/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MatchCentreView, type MatchSlots } from '@/components/match-centre-view';
import { matchAnnouncements } from '@/lib/announce';
import { withLocale } from '@/lib/locale-query';
import { INITIAL_CLOCK, type LiveClock, liveLabel, liveState } from '@/lib/live';
import type { MatchWords } from '@/lib/words-server';

/**
 * The match centre that stays current (T-032, T-034): renders the server's
 * snapshot, then subscribes to the web app's `/api/fixtures/:id/stream` and
 * replaces the whole payload on every `snapshot`. The freshness line is the
 * same one the scores page uses.
 *
 * The same stream says when the public discussion moved (T-254, D-068): a
 * `panel` event carries nothing to render, and the page asks the server to
 * render itself again -- the shape `LiveConversation` set, so there is one
 * way a post can look. Collapsed, because a reply and the reaction it draws
 * are two events and one change to what the reader sees.
 */

/** Collapse a burst of panel events -- three in a second is one render, not three. */
const PANEL_REFRESH_MS = 400;
export function LiveMatch({
  initial,
  timeZone,
  locale,
  slots,
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
  /** The reader's words, resolved by the page on the server (T-1303). */
  words: MatchWords;
}) {
  const [centre, setCentre] = useState(initial);
  const [clock, setClock] = useState<LiveClock>(INITIAL_CLOCK);
  const [now, setNow] = useState(() => Date.now());
  // What the last snapshot changed, in words, for the polite live region (T-081).
  const [announcement, setAnnouncement] = useState('');
  const id = initial.fixture.id;
  const router = useRouter();

  useEffect(() => {
    // The reader's names in every snapshot, as on the server-rendered page (T-1312).
    const source = new EventSource(withLocale(`/api/fixtures/${id}/stream`, locale));
    let panelRefresh: ReturnType<typeof setTimeout> | null = null;
    const stamp = (snapshot: boolean): void =>
      setClock((c) => ({
        lastEventAt: Date.now(),
        lastSnapshotAt: snapshot ? Date.now() : c.lastSnapshotAt,
        broken: false,
      }));
    source.addEventListener('snapshot', (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as MatchCentre;
      setCentre((previous) => {
        const said = matchAnnouncements(previous, next, words);
        if (said.length > 0) setAnnouncement(said.join(' '));
        return next;
      });
      stamp(true);
    });
    source.addEventListener('heartbeat', () => stamp(false));
    source.addEventListener('panel', () => {
      stamp(false);
      if (panelRefresh !== null) return;
      panelRefresh = setTimeout(() => {
        panelRefresh = null;
        router.refresh();
      }, PANEL_REFRESH_MS);
    });
    source.addEventListener('stale', () => setClock((c) => ({ ...c, broken: true })));
    source.onerror = () => setClock((c) => ({ ...c, broken: true }));
    source.onopen = () => setClock((c) => ({ ...c, broken: false }));
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(tick);
      if (panelRefresh !== null) clearTimeout(panelRefresh);
      source.close();
    };
  }, [id, router, words, locale]);

  const state = liveState(clock, now);
  return (
    <>
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
        role={state === 'stale' || state === 'unavailable' ? 'status' : undefined}
      >
        {liveLabel(state, clock, locale, timeZone, words.m)}
      </p>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="live-announcements"
      >
        {announcement}
      </div>
      <MatchCentreView
        centre={centre}
        timeZone={timeZone}
        locale={locale}
        now={now}
        slots={slots}
        words={words}
      />
    </>
  );
}
