import type { FastifyInstance } from 'fastify';

/**
 * The headers of every agents-console answer the API gives (T-1881, D-340):
 * `/console/...` is never framed, kept, indexed or a referrer. A browser
 * does not call the API (the web app does, and its proxy and Caddy say the
 * same of what the browser gets); this holds wherever the API is reached
 * without them.
 */
export const CONSOLE_API_HEADERS: Readonly<Record<string, string>> = {
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
};

const FRAME_POLICY = "frame-ancestors 'none'";

/** Whether a request's address is the console's: `/console` or under it. */
export function isConsoleAddress(url: string): boolean {
  const path = url.split('?')[0]!;
  return path === '/console' || path.startsWith('/console/');
}

/**
 * A route's own policy with framing refused, or that alone. A picture's
 * `default-src 'none'; sandbox` (D-357) is kept and added to.
 */
export function withFramingRefused(policy: unknown): string {
  if (typeof policy !== 'string' || policy.trim() === '') return FRAME_POLICY;
  return /(^|;)\s*frame-ancestors\s/.test(policy) ? policy : `${policy}; ${FRAME_POLICY}`;
}

/**
 * Before every console answer is sent, refusals and errors too. No console
 * answer is kept: a route that names no `cache-control` gets `private,
 * no-store`, and the one that names its own, a request picture, says the
 * same (the hour D-357 gave it never reached a browser: the web proxy and
 * Caddy both answer `no-store` for every console address).
 */
export function registerConsoleHeaders(fastify: FastifyInstance): void {
  fastify.addHook('onSend', (request, reply, payload, done) => {
    if (isConsoleAddress(request.url)) {
      for (const [name, value] of Object.entries(CONSOLE_API_HEADERS))
        void reply.header(name, value);
      if (!reply.hasHeader('cache-control'))
        void reply.header('cache-control', 'private, no-store');
      void reply.header(
        'content-security-policy',
        withFramingRefused(reply.getHeader('content-security-policy')),
      );
    }
    done(null, payload);
  });
}
