/**
 * How far back a finished fixture is still scored, in days (T-066): the
 * evaluation tick (`ForecastTriggersService.evaluateFinished`) takes a
 * finished fixture with an unscored forecast while its kick-off is this
 * recent, since its result can still be corrected upstream. The public
 * accuracy answer keeps a week or month running while one of its matches
 * could still be scored in this window (T-1751, D-408): one constant, so the
 * two can never disagree.
 */
export const EVALUATE_WINDOW_DAYS = 14;
