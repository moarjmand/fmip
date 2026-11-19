/**
 * Which addresses a Web Push subscription may name (T-1880). A subscription's
 * `endpoint` is an address the API later sends a request to, so an endpoint a
 * caller made up is a request to a host of the caller's choosing. Only the
 * browsers' own push services are taken: over https, on the default port, by
 * name (never an IP literal), with no user or password in the address, and
 * written the way a URL parser writes it back, so no two parsers can read two
 * different hosts out of it.
 *
 * Pure, and the delivery module's to own: it is the module that sends.
 */

/** A push service that is one host. */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  // Chrome, Edge on Android, Opera, Brave, Samsung Internet and the other Chromium browsers.
  'fcm.googleapis.com',
  // Firefox.
  'updates.push.services.mozilla.com',
  // Safari.
  'web.push.apple.com',
];

/**
 * A push service that is many hosts under one name: any name ending in one of
 * these. Only where the browser really is handed many: Safari's endpoints are
 * all on `web.push.apple.com` (`api.push.apple.com` is APNs, which no browser
 * subscription names), so Apple has no suffix here (review of PR #948).
 */
export const PUSH_SERVICE_SUFFIXES: readonly string[] = [
  // Firefox: `updates.push.services.mozilla.com` today; the service's other hosts in Mozilla's own zone.
  '.push.services.mozilla.com',
  // Edge and Windows (WNS): `wns2-par02p.notify.windows.com` and its like, one per data centre.
  '.notify.windows.com',
];

/** The longest endpoint taken. */
export const PUSH_ENDPOINT_MAX = 1000;

const LABELS = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Whether `host` (lower case, no port) is a push service's. */
export function isPushServiceHost(host: string): boolean {
  if (!LABELS.test(host)) return false;
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_SUFFIXES.some((suffix) => host.length > suffix.length && host.endsWith(suffix))
  );
}

/** Whether a subscription's endpoint is an address of a browser's push service. */
export function isPushServiceEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > PUSH_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  // `new URL` drops https's own port, so anything left is another one.
  if (url.port !== '') return false;
  // As the parser writes it back: no backslash, space, upper-case host or
  // other spelling a second parser could read differently.
  if (url.href !== endpoint) return false;
  return isPushServiceHost(url.hostname);
}
