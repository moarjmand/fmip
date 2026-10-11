'use client';

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import {
  type ConnectionHints,
  type LitePreference,
  type LiteReason,
  liteMode,
  slowConnection,
  slowCookieString,
  SLOW_COOKIE,
} from '@/lib/lite';

/**
 * Lite mode on the client (T-1387, D-205).
 *
 * The server already rendered the page lite or not (`data-lite` on <html>,
 * from the choice, `Save-Data` and the hint cookie: `readLite`), and this
 * starts from exactly that, so hydration matches. Then it asks what only a
 * script can: the Network Information API. On `auto`, a slow connection
 * turns lite mode on at once -- the images not yet drawn are not drawn, the
 * fonts fall back, the live surfaces poll -- and is written to the hint
 * cookie, so the next page is lite from the server's first byte. A fast one
 * clears the hint for the next page and leaves this page as it was rendered:
 * the page never flips back under the reader.
 *
 * `useLite()` is the mode for any client component; `Pictured` is how a
 * server component draws an image only when lite mode is off.
 */

export interface LiteValue {
  on: boolean;
  reason: LiteReason | null;
  preference: LitePreference;
}

const LiteContext = createContext<LiteValue>({ on: false, reason: null, preference: 'auto' });

/** Lite mode as this page is drawn now. Off outside a `LiteProvider` (a spec, an error page). */
export function useLite(): LiteValue {
  return useContext(LiteContext);
}

type NetworkInformationLike = ConnectionHints & Partial<EventTarget>;

function connection(): NetworkInformationLike | undefined {
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

function subscribe(onChange: () => void): () => void {
  const source = connection();
  source?.addEventListener?.('change', onChange);
  return () => source?.removeEventListener?.('change', onChange);
}

/** `undefined` where the browser cannot say, and always on the server. */
const browserSlow = (): boolean | undefined => slowConnection(connection());
const serverSlow = (): boolean | undefined => undefined;

export function LiteProvider({
  preference,
  slow,
  children,
}: {
  /** The reader's choice, from the cookie. */
  preference: LitePreference;
  /** What the server could already tell: `Save-Data`, or the hint an earlier page left. */
  slow: boolean;
  children: ReactNode;
}) {
  const seen = useSyncExternalStore(subscribe, browserSlow, serverSlow);
  const { on, reason } = liteMode(preference, slow || seen === true);

  // The next page's render: a slow connection is remembered for the server;
  // a fast one clears an old hint. Where the browser cannot say, nothing changes.
  useEffect(() => {
    if (seen === undefined) return;
    if (!seen && !document.cookie.includes(`${SLOW_COOKIE}=1`)) return;
    document.cookie = slowCookieString(seen, window.location.protocol === 'https:');
  }, [seen]);

  // The fonts and the compact lists follow <html>, which the server rendered;
  // a slow connection found after load moves it here.
  useEffect(() => {
    document.documentElement.dataset.lite = on ? 'on' : 'off';
  }, [on]);

  const value = useMemo(() => ({ on, reason, preference }), [on, reason, preference]);
  return <LiteContext value={value}>{children}</LiteContext>;
}

/**
 * An image only outside lite mode: in lite mode no `<img>` is rendered at all
 * (so nothing is fetched), and `fallback` -- a lettered mark, or nothing --
 * stands in its place. The image itself is rendered by the caller, server or
 * client, and handed in as `children`.
 */
export function Pictured({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useLite().on ? fallback : children;
}
