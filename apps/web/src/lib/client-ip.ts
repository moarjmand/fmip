/**
 * The reader's network address, for the API's per-address rate limits on the
 * account forms (T-810, D-093).
 *
 * Only Cloudflare's `CF-Connecting-IP` is read. Behind Cloudflare that header
 * is set by Cloudflare itself and is the reader's address; `X-Forwarded-For`
 * is not used, because past Caddy its only entry is a Cloudflare edge (or,
 * with Next.js adding one, the proxy container), and keying a limit on that
 * would put every reader in one bucket and lock them all out together.
 * Without Cloudflare -- local development, the tests -- there is no address,
 * and the API applies its per-account limits only.
 *
 * Returns a well-formed IPv4 or IPv6 literal, or `undefined`.
 */
export function clientIpFrom(cfConnectingIp: string | null | undefined): string | undefined {
  const value = cfConnectingIp?.trim();
  if (value === undefined || value === '' || value.length > 64) return undefined;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4 !== null) {
    return ipv4.slice(1).every((part) => Number(part) <= 255) ? value : undefined;
  }
  return /^[0-9a-fA-F:.]+$/.test(value) && value.includes(':') ? value : undefined;
}
