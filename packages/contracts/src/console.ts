/**
 * The agents console's runtime constants (T-1728, T-1729), on their own entry
 * point `@fmip/contracts/console`: the main barrel is in every public page's
 * first-load bundle, and these are only the console's (the match centre went
 * 0.4 kB over its budget when they sat in the barrel). Types stay in the barrel.
 */
export {
  CONSOLE_DECISION_CHOICES,
  CONSOLE_DECISION_TEXT_MAX,
  CONSOLE_REQUEST_BODY_MAX,
  CONSOLE_REQUEST_EVENT_KINDS,
  CONSOLE_REQUEST_PRIORITIES,
  CONSOLE_REQUEST_QUESTION_MAX,
  CONSOLE_REQUEST_RESULT_MAX,
  CONSOLE_REQUEST_STATUSES,
  CONSOLE_REQUEST_TITLE_MAX,
} from './agents-console';
export {
  CONSOLE_MODEL_CALIBRATION_MINIMUM,
  CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM,
  CONSOLE_MODEL_NO_WORSE_MARGIN,
  CONSOLE_MODEL_PAIRED_MINIMUM,
} from './console-model';
