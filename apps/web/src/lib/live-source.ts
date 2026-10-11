import { LITE_POLL_MS } from '@/lib/lite';

/**
 * A live surface's connection to its stream (T-032, T-034), and how lite mode
 * makes fewer live updates (T-1387, D-205).
 *
 * Normally the EventSource stays open: a snapshot on connect, then every
 * change and a heartbeat every 15 s. In lite mode it is a poll instead: the
 * stream's first event is always a full snapshot (D-027), so the source is
 * closed as soon as that arrives and opened again `LITE_POLL_MS` later. A
 * reader on a slow connection gets the same complete picture once a minute
 * and holds no connection in between; the freshness line keeps saying when
 * it last checked (rule 4), judged against `LITE_STALE_AFTER_MS`.
 *
 * `attach` adds the surface's own listeners to each new source; this adds the
 * poll's after them, so the snapshot is handled before the source closes.
 * Returns the cleanup for an effect.
 */
export function openLiveSource(
  url: string,
  lite: boolean,
  attach: (source: EventSource) => void,
): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const open = (): void => {
    timer = null;
    const current = new EventSource(url);
    source = current;
    attach(current);
    if (!lite) return;
    current.addEventListener('snapshot', () => {
      current.close();
      if (source === current) source = null;
      if (!stopped) timer = setTimeout(open, LITE_POLL_MS);
    });
  };

  open();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    source?.close();
  };
}
