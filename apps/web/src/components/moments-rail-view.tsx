'use client';

import { unstable_isUnrecognizedActionError } from 'next/navigation';
import {
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { FreshnessStamp, type FreshnessWords } from '@/components/freshness-stamp';
import { useLite } from '@/components/lite-mode';
import { LITE_POLL_MS } from '@/lib/lite';
import { LIVE_MOVED, RAIL_POLL_MS } from '@/lib/live-signal';
import { refreshRail } from '@/lib/rail-actions';

/**
 * The moments rail's client half (T-1642, D-300): what needs a script, and
 * nothing more (D-264). Everything a reader sees arrives drawn by the server
 * (`components/moments-rail.tsx`): the lead, each card, each card's hover
 * card and the "N more" links. Which cards fit a desktop row is the
 * stylesheet's (`.moments-row` in globals.css, container queries), so no
 * width is measured here. Two jobs are left:
 *
 * - **The hover card.** On a device with a fine pointer that hovers, from
 *   768px, resting on a card for `OPEN_DELAY_MS` or reaching it with the
 *   keyboard puts its panel under it, floating (absolutely placed, so nothing
 *   on the page moves). It is in the page only while open: a touch device
 *   never gets one, and a tap opens the match. It follows its card in the
 *   tab order, so Tab walks into its buttons and on out to the next card; it
 *   never holds the focus. Esc closes it (and keeps it closed until the focus
 *   leaves that card); leaving the card closes it.
 * - **Kept current** (as the matchday rail was, T-1635, D-297). The layout is
 *   never drawn again on a client-side navigation, so the rail asks the
 *   server to draw it again (`refreshRail`) and takes the answer whole:
 *   every `RAIL_POLL_MS` while anything is being played (`askIn` 0), at the
 *   answer's own time otherwise, never while the page is hidden, and at once
 *   when the page's own stream saw a match move (`LIVE_MOVED`). When the
 *   answers stop coming the rail is marked `data-behind` from `behindAt` on
 *   (rule 4): its live cards read "Behind" for their minute and "May be
 *   behind" under it, by CSS.
 *
 * On a quiet day with no moment, or with no answer, nothing is drawn, but
 * the asking goes on, so the rail appears once there is something to show.
 */

export interface MomentSlot {
  id: string;
  kind: string;
  /** The card, a link to the match, drawn by the server. */
  card: ReactNode;
  /** Its hover card, drawn by the server, put in the page only while open. */
  panel: ReactNode;
}

export interface MomentsRailProps {
  locale: string;
  /** The reader's zone and whether a member: what the rail is asked for again with. */
  timeZone: string;
  signedIn: boolean;
  /** The landmark's name, drawn by the server (marked when it is the English standing in). */
  title: ReactNode;
  /** "● 3 live", the caption and Leagues, drawn by the server. */
  lead: ReactNode;
  /** The moments in the answer's order; empty draws nothing. */
  moments: readonly MomentSlot[];
  /** The "N more" links, one per row width (`moreVariants`), drawn by the server. */
  more: ReactNode;
  /** Milliseconds after this answer to ask again; 0 while a match is played (`momentsAskIn`). */
  askIn: number;
  /** When the cards may be behind (epoch ms), `null` when nothing on them can change. */
  behindAt: number | null;
  /** Already behind when the server drew it. */
  behind: boolean;
}

/** A pointer that hovers, a fine one, on a screen wide enough for the desktop row. */
export const HOVER_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 48rem)';
/** How long a pointer rests on a card before its hover card opens. */
export const OPEN_DELAY_MS = 150;
/** How long after the pointer leaves before it closes: time to cross into the panel. */
const CLOSE_DELAY_MS = 120;
/** The hover card's width (rem), as `.moment-float` draws it. */
const PANEL_REM = 23;
/** A burst of `LIVE_MOVED` (a goal, then its card) asks once. */
const MOVED_GAP_MS = 5_000;
/** `setTimeout` takes at most 2^31 - 1 ms; the rail never waits that long. */
const LONGEST_WAIT_MS = 2_147_000_000;
/** An ask with no answer after this long is taken as failed and tried again a poll later. */
const ASK_TIMEOUT_MS = 20_000;

/** Which hover card is open, and the one Esc closed (kept closed while its card holds the focus). */
export interface HoverState {
  open: string | null;
  dismissed: string | null;
}

export type HoverEvent =
  /** The pointer rested on a card long enough, or the keyboard reached it. */
  | { type: 'open'; id: string }
  /** The pointer, or the focus, left a card. */
  | { type: 'leave'; id: string }
  | { type: 'escape' }
  /** A new answer: a card no longer on the rail takes its hover card with it. */
  | { type: 'shown'; ids: readonly string[] };

export const CLOSED: HoverState = { open: null, dismissed: null };

/** The hover card's state after an event, pure so the spec can walk it. */
export function hoverAfter(state: HoverState, event: HoverEvent): HoverState {
  switch (event.type) {
    case 'open':
      return state.dismissed === event.id ? state : { open: event.id, dismissed: null };
    case 'leave':
      return {
        open: state.open === event.id ? null : state.open,
        dismissed: state.dismissed === event.id ? null : state.dismissed,
      };
    case 'escape':
      return state.open === null ? state : { open: null, dismissed: state.open };
    case 'shown':
      return state.open !== null && !event.ids.includes(state.open)
        ? { open: null, dismissed: state.dismissed }
        : state;
  }
}

/**
 * Where the hover card sits under its card: from the card's inline start,
 * or from its inline end when the room from its start to the window's
 * inline edge is less than the card's width and a margin.
 */
export function panelAlign(room: number, panel: number): 'start' | 'end' {
  return room >= panel + 16 ? 'start' : 'end';
}

function canHover(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(HOVER_QUERY).matches;
}

/** The room (px) from a slot's inline start to the window's inline edge, and the panel's width. */
function roomFor(slot: HTMLElement): 'start' | 'end' {
  const box = slot.getBoundingClientRect();
  const rtl = getComputedStyle(slot).direction === 'rtl';
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return panelAlign(rtl ? box.right : window.innerWidth - box.left, PANEL_REM * rem);
}

/**
 * Asks for the rail again while it can change, and hands each answer to
 * `replace` (the matchday rail's schedule, T-1635). Each answer sets the next
 * ask; a failed ask is tried again a poll later.
 */
function useRailRefresh(rail: MomentsRailProps, replace: (next: MomentsRailProps) => void): void {
  const { on: lite } = useLite();
  const lastAsk = useRef(0);
  const retired = useRef(false);

  // Run again for every answer, even one with the same `askIn`: it sets the next ask.
  useEffect(() => {
    const { locale, timeZone, signedIn, askIn } = rail;
    const poll = lite ? LITE_POLL_MS : RAIL_POLL_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let waiting = false;
    let stopped = false;

    const later = (wait: number): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => ask(false), Math.min(Math.max(0, wait), LONGEST_WAIT_MS));
    };
    const ask = (fresh: boolean): void => {
      if (busy || stopped || retired.current) return;
      // A hidden page asks nothing; it asks when it is shown again.
      if (document.visibilityState === 'hidden') {
        waiting = true;
        return;
      }
      busy = true;
      waiting = false;
      lastAsk.current = Date.now();
      let settled = false;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        busy = false;
        clearTimeout(guard);
        return !stopped;
      };
      // An answer that never comes must not stop the asking.
      const guard = setTimeout(() => {
        if (settle()) later(poll);
      }, ASK_TIMEOUT_MS);
      refreshRail(locale, timeZone, signedIn, fresh).then(
        (next) => {
          if (!settle()) return;
          if (next === null) later(poll);
          else replace(next);
        },
        (error: unknown) => {
          if (!settle()) return;
          // A page from an earlier build: its Server Function is gone; the
          // next navigation loads the new build. Marked behind meanwhile.
          if (unstable_isUnrecognizedActionError(error)) retired.current = true;
          else later(poll);
        },
      );
    };
    const onShown = (): void => {
      if (document.visibilityState === 'visible' && waiting) ask(false);
    };
    const onMoved = (): void => {
      if (Date.now() - lastAsk.current >= MOVED_GAP_MS) ask(true);
    };

    later(askIn === 0 ? poll : askIn);
    document.addEventListener('visibilitychange', onShown);
    window.addEventListener(LIVE_MOVED, onMoved);
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShown);
      window.removeEventListener(LIVE_MOVED, onMoved);
    };
  }, [rail, lite, replace]);
}

/** Whether `behindAt` has passed: the server's word, or the clock reaching it since. */
function useBehind(behindAt: number | null, already: boolean): boolean {
  const [passed, setPassed] = useState<number | null>(null);
  useEffect(() => {
    if (behindAt === null) return;
    const wait = Math.min(Math.max(0, behindAt - Date.now()), LONGEST_WAIT_MS);
    const timer = setTimeout(() => setPassed(behindAt), wait);
    return () => clearTimeout(timer);
  }, [behindAt]);
  return already || (behindAt !== null && passed === behindAt);
}

export function MomentsRailView(props: MomentsRailProps) {
  // The rail as last drawn: the server's on a page load, then each answer.
  const [rail, setRail] = useState(props);
  const [drawn, setDrawn] = useState(props);
  const [hover, setHover] = useState<HoverState>(CLOSED);
  const [align, setAlign] = useState<'start' | 'end'>('start');
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [show] = useState(() => (next: MomentsRailProps) => {
    setRail(next);
    setHover((state) => hoverAfter(state, { type: 'shown', ids: next.moments.map((m) => m.id) }));
  });
  // A layout the server drew again (`router.refresh()`) is the newest answer.
  if (props !== drawn) {
    setDrawn(props);
    show(props);
  }
  useRailRefresh(rail, show);
  const behind = useBehind(rail.behindAt, rail.behind);

  // Esc closes the open hover card wherever the focus is; a focus inside the
  // panel goes back to its card, so it is not lost with the panel.
  useEffect(() => {
    if (hover.open === null) return;
    const id = hover.open;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const slot = document.querySelector(`[data-moment="${CSS.escape(id)}"]`);
      if (slot?.querySelector('[data-testid="moment-panel"]')?.contains(document.activeElement)) {
        slot.querySelector<HTMLElement>('[data-testid="moment-card"]')?.focus();
      }
      setHover((state) => hoverAfter(state, { type: 'escape' }));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hover.open]);

  useEffect(
    () => () => {
      if (opening.current !== null) clearTimeout(opening.current);
      if (closing.current !== null) clearTimeout(closing.current);
    },
    [],
  );

  const stopTimers = (): void => {
    if (opening.current !== null) clearTimeout(opening.current);
    if (closing.current !== null) clearTimeout(closing.current);
    opening.current = null;
    closing.current = null;
  };
  const open = (id: string, slot: HTMLElement): void => {
    stopTimers();
    setAlign(roomFor(slot));
    setHover((state) => hoverAfter(state, { type: 'open', id }));
  };
  const handlers = (id: string) => ({
    onPointerEnter: (event: PointerEvent<HTMLLIElement>) => {
      if (event.pointerType !== 'mouse' || !canHover()) return;
      const slot = event.currentTarget;
      stopTimers();
      opening.current = setTimeout(() => open(id, slot), OPEN_DELAY_MS);
    },
    onPointerLeave: (event: PointerEvent<HTMLLIElement>) => {
      if (event.pointerType !== 'mouse') return;
      const slot = event.currentTarget;
      stopTimers();
      closing.current = setTimeout(() => {
        // The keyboard is still in this card or its panel: it stays.
        const focused = document.activeElement;
        if (focused !== null && slot.contains(focused) && focused.matches(':focus-visible')) return;
        setHover((state) => hoverAfter(state, { type: 'leave', id }));
      }, CLOSE_DELAY_MS);
    },
    // Opening the match (the card, or the panel's button) takes the panel away with it.
    onClick: () => {
      stopTimers();
      setHover(CLOSED);
    },
    onFocus: (event: FocusEvent<HTMLLIElement>) => {
      if (!canHover() || !(event.target as Element).matches(':focus-visible')) return;
      open(id, event.currentTarget);
    },
    onBlur: (event: FocusEvent<HTMLLIElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      stopTimers();
      setHover((state) => hoverAfter(state, { type: 'leave', id }));
    },
  });

  if (rail.moments.length === 0) return null;
  return (
    <section
      aria-labelledby="moments-title"
      data-testid="moments-rail"
      data-behind={behind ? 'true' : undefined}
      className="group/moments border-b border-default bg-surface"
    >
      <h2 id="moments-title" className="sr-only">
        {rail.title}
      </h2>
      <div className="page-frame moments-frame">
        {rail.lead}
        <div className="moments-row">
          <ul className="moments-cards" data-testid="moments-cards">
            {rail.moments.map((moment) => (
              <li
                key={moment.id}
                className="moment-slot"
                data-moment={moment.id}
                data-kind={moment.kind}
                data-testid="moment"
                {...handlers(moment.id)}
              >
                {moment.card}
                {hover.open === moment.id && (
                  <div className="moment-float" data-align={align}>
                    {moment.panel}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {rail.more}
        </div>
      </div>
    </section>
  );
}

/**
 * The hover card's freshness stamp ("Updated 20:31 · 8 sec ago", rule 4): an
 * island, because the age is the reader's clock's when the card opens, which
 * the server cannot know. The hover card is only ever drawn here in the
 * browser, so the first render already has the clock; the server keys the
 * stamp by `checkedAt`, so each answer is read afresh. Past `behindAt`, or
 * when the server already knew, it says the card may be behind.
 */
export function MomentStamp({
  locale,
  checkedAt,
  behindAt,
  behind,
  words,
}: {
  locale: string;
  /** When the rail's answer was made (ISO). */
  checkedAt: string;
  behindAt: number | null;
  behind: boolean;
  words: FreshnessWords;
}) {
  // The clock when the card opened. A new answer draws the stamp afresh
  // (`key`, by the server), and with it a new reading.
  const [now] = useState(() => Date.now());
  return (
    <FreshnessStamp
      checkedAt={checkedAt}
      now={now}
      staleAfterMs={Number.POSITIVE_INFINITY}
      behind={behind || (behindAt !== null && now >= behindAt)}
      locale={locale}
      words={words}
      testId="moment-panel-stamp"
    />
  );
}
