/**
 * The web server's clock for the visual baseline (T-1502), loaded with
 * `NODE_OPTIONS=--require=./tests/e2e/fixed-clock.cjs`. The server writes
 * "today" into a page (the scores day strip, the date picker, the home
 * page's date line), so a picture taken on another day would differ from
 * the baseline by those words alone.
 *
 * The clock is shifted, not stopped: it starts at FMIP_FIXED_CLOCK (default
 * 2026-10-24 18:00 UTC, the browser clock of `visual.spec.ts`) and runs on
 * from there, so timers, timeouts and anything that measures a duration with
 * `Date.now()` behave as they always do.
 */
'use strict';

const RealDate = Date;
const offset =
  RealDate.parse(globalThis.process.env.FMIP_FIXED_CLOCK ?? '2026-10-24T18:00:00Z') -
  RealDate.now();

/** `Date` as a function, as `new Date()` and as `Date.now()`; every other use is the real one. */
function ShiftedDate(...args) {
  if (!new.target) return new RealDate(RealDate.now() + offset).toString();
  return Reflect.construct(
    RealDate,
    args.length === 0 ? [RealDate.now() + offset] : args,
    new.target,
  );
}
ShiftedDate.prototype = RealDate.prototype;
ShiftedDate.parse = RealDate.parse;
ShiftedDate.UTC = RealDate.UTC;
ShiftedDate.now = () => RealDate.now() + offset;

globalThis.Date = ShiftedDate;
