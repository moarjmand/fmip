/**
 * Server-sent events, by hand: the format is four field names and a blank
 * line, and a dependency would hide the one thing that matters here — that
 * every event carries an `id` (the snapshot time) so a client that reconnects
 * can tell how stale what it shows has become.
 */

export type SseEventName = 'snapshot' | 'heartbeat' | 'stale';

/** One event as bytes on the wire. `id` is the ISO time the payload was true. */
export function sseEvent(name: SseEventName, data: unknown, id?: string): string {
  const lines = [`event: ${name}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  // JSON never contains a raw newline, so one `data:` line is enough and
  // the framing cannot be broken by content.
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join('\n')}\n\n`;
}

/** The comment line that keeps proxies from closing an idle stream. */
export const SSE_PING = ': ping\n\n';

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Nginx and Cloudflare buffer responses unless told otherwise.
  'x-accel-buffering': 'no',
} as const;

/**
 * Collapses a burst of changes into one refresh. A goal is three writes
 * (score, incident, fixture minute) inside a few milliseconds; the client
 * wants one snapshot, not three.
 */
export function debounce(
  delayMs: number,
  run: () => void,
): { trigger: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger: () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
