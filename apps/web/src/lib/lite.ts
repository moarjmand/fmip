/**
 * Lite mode for slow connections (T-1387, D-205): no images, no web fonts
 * (the device's own), compact lists and fewer live updates.
 *
 * The preference is kept the way the appearance preferences are (T-602,
 * T-621): a cookie the locale layout reads and renders on <html> as
 * `data-lite`, so the first paint is already lite and no image or font is
 * requested before a script could stop it. Unlike them it is this browser's
 * alone and never goes to the account: a connection belongs to a device --
 * the same member is on a train's 3G with one and on fibre with another --
 * and a guest keeps it in a cookie anyway (D-205: no migration).
 *
 *   auto  (default) on when the connection is slow, off otherwise
 *   on    always lite
 *   off   never lite, however slow the connection
 *
 * "Slow" is what the browser itself reports, never a guess from timing: the
 * `Save-Data: on` request header (the reader asked the browser to save data),
 * which the server sees on the first request, and the Network Information
 * API's `saveData` or an `effectiveType` of `slow-2g`, `2g` or `3g`, which only
 * a script sees. What a script sees is written to a second, short-lived
 * cookie (`fmip_slow`), so the next page is rendered lite by the server.
 *
 * Pure, so both sides share it and the rules are unit-tested.
 */

export const LITE_PREFERENCES = ['auto', 'on', 'off'] as const;
export type LitePreference = (typeof LITE_PREFERENCES)[number];

export const DEFAULT_LITE: LitePreference = 'auto';

/** The reader's choice: server-read, set by a form post, a year (like the theme). */
export const LITE_COOKIE = 'fmip_lite';

/**
 * What a script saw of the connection, for the server's next render: `1`
 * slow. Readable and written by the page's script; a week, and re-checked on
 * every page load where the browser can tell, so it follows the connection.
 */
export const SLOW_COOKIE = 'fmip_slow';
export const SLOW_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** The `effectiveType` values the Network Information API calls slow enough. */
export const SLOW_EFFECTIVE_TYPES: readonly string[] = ['slow-2g', '2g', '3g'];

/**
 * In lite mode a live surface does not hold a stream open: it takes one
 * snapshot, closes, and asks again after this long. Its freshness line
 * still says when it last checked (rule 4).
 */
export const LITE_POLL_MS = 60_000;

/** The words the banner, its switch and the footnote use, resolved by the layout. */
export const LITE_BANNER_KEYS = [
  'lite.banner.slow',
  'lite.banner.chosen',
  'lite.switch',
  'lite.footnote',
] as const;

/** A value from a cookie or a form: one of the three, or `undefined`. */
export function parseLite(raw: unknown): LitePreference | undefined {
  return LITE_PREFERENCES.find((value) => value === raw);
}

/** What the layout renders with: the choice, or `auto` when there is none. */
export function litePreferenceOf(raw: unknown): LitePreference {
  return parseLite(raw) ?? DEFAULT_LITE;
}

/** `Save-Data: on` (the header's one defined value; case and spaces aside). */
export function saveDataRequested(header: string | null | undefined): boolean {
  return typeof header === 'string' && header.trim().toLowerCase() === 'on';
}

/** The part of `navigator.connection` this reads. */
export interface ConnectionHints {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Whether the browser reports a slow connection: `true` or `false`, or
 * `undefined` when it cannot say (no Network Information API, as in Safari
 * and Firefox) -- which is not the same as fast, so the caller leaves what
 * it knew alone.
 */
export function slowConnection(
  connection: ConnectionHints | null | undefined,
): boolean | undefined {
  if (connection === null || connection === undefined) return undefined;
  if (connection.saveData === true) return true;
  if (typeof connection.effectiveType === 'string') {
    return SLOW_EFFECTIVE_TYPES.includes(connection.effectiveType);
  }
  return connection.saveData === false ? false : undefined;
}

/** The hint cookie's value read back: only `1` is slow. */
export function slowHint(raw: unknown): boolean {
  return raw === '1';
}

/**
 * Why lite mode is on, which the banner says: the reader chose it, or `auto`
 * found a slow connection. `null` when it is off.
 */
export type LiteReason = 'chosen' | 'slow';

export interface LiteMode {
  on: boolean;
  reason: LiteReason | null;
}

/** On when chosen, or on `auto` with a slow connection; never on `off`. */
export function liteMode(preference: LitePreference, slow: boolean): LiteMode {
  if (preference === 'on') return { on: true, reason: 'chosen' };
  if (preference === 'auto' && slow) return { on: true, reason: 'slow' };
  return { on: false, reason: null };
}

/**
 * The hint cookie as the page's script writes it (`document.cookie`): slow
 * sets it for a week, fast clears it. Readable by a script on purpose -- it
 * is a hint about the connection, not a choice, and holds nothing personal.
 */
export function slowCookieString(slow: boolean, secure: boolean): string {
  const tail = `; path=/; samesite=lax${secure ? '; secure' : ''}`;
  return slow
    ? `${SLOW_COOKIE}=1; max-age=${SLOW_COOKIE_MAX_AGE}${tail}`
    : `${SLOW_COOKIE}=; max-age=0${tail}`;
}
