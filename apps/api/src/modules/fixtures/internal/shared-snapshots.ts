/**
 * One read and one serialisation per distinct snapshot at a time -- the first
 * remedy in `docs/08-load-test.md`, "What limits it".
 *
 * Without it every open stream re-reads and re-serialises its own snapshot
 * after a change, and the work is linear in clients: on the two-core
 * production server 1,000 clients took 3.2 s (p95) to see a change and 2.4 s
 * to see their first snapshot, both outside D-047. Streams asking the same
 * question -- the same filters for the same viewer, or the same match -- now
 * share the read that is already in flight.
 *
 * Sharing never serves an older picture than a fresh read would (rule 4). A
 * read in flight is joined only if no change has arrived since it started; a
 * change noted after a read began makes that read unjoinable, and the next
 * stream to ask starts another. Nothing is kept once a read settles, so this
 * is not a cache: it only collapses reads that would have run side by side.
 */
export class SharedSnapshots {
  /** Strictly increasing, so a read and a change are never simultaneous. */
  private tick = 0;
  private lastChange = 0;
  private readonly inFlight = new Map<string, { startedAt: number; event: Promise<string> }>();

  /** Every change the feed delivers, whichever stream it concerns. */
  noteChange(): void {
    this.lastChange = ++this.tick;
  }

  /**
   * The serialised event for `key`: the one a read already in flight will
   * produce when no change has arrived since it started, a new read otherwise.
   */
  event(key: string, render: () => Promise<string>): Promise<string> {
    const current = this.inFlight.get(key);
    if (current !== undefined && current.startedAt > this.lastChange) return current.event;

    const entry = { startedAt: ++this.tick, event: render() };
    this.inFlight.set(key, entry);
    const forget = (): void => {
      if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
    };
    entry.event.then(forget, forget);
    return entry.event;
  }

  /** Reads in flight right now. */
  get reading(): number {
    return this.inFlight.size;
  }
}
