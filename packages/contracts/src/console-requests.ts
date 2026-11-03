/**
 * The teammate requests' runtime constants (T-1728, D-354; pictures T-1731,
 * D-357), on the console's entry point only (`./console`). They are kept out
 * of `agents-console.ts` because that module is in every public page's
 * bundle (the barrel exports some of its values, and the package is
 * CommonJS, so nothing in it is shaken out). Their types are in
 * `agents-console.ts`, read from these by a type-only import.
 */

/**
 * Where a request stands. `new`: written, not started. `in_progress`: Claude
 * is on it. `waiting_decision`: a question is open for a console user.
 * `decided`: the question was answered and waits for the maintainer's word.
 * `done` and `cancelled` are closed; only reopening moves them.
 */
export const CONSOLE_REQUEST_STATUSES = [
  'new',
  'in_progress',
  'waiting_decision',
  'decided',
  'done',
  'cancelled',
] as const;

export const CONSOLE_REQUEST_PRIORITIES = ['normal', 'high'] as const;

export const CONSOLE_DECISION_CHOICES = ['approve', 'reject', 'other'] as const;

/** The longest title, details, result, question and decision text, in characters. */
export const CONSOLE_REQUEST_TITLE_MAX = 200;
export const CONSOLE_REQUEST_BODY_MAX = 4000;
export const CONSOLE_REQUEST_RESULT_MAX = 8000;
export const CONSOLE_REQUEST_QUESTION_MAX = 2000;
export const CONSOLE_DECISION_TEXT_MAX = 4000;

/** What one line of a request's history records. */
export const CONSOLE_REQUEST_EVENT_KINDS = [
  'created',
  'edited',
  'cancelled',
  'reopened',
  'execute_requested',
  'execute_withdrawn',
  'asked',
  'decided',
  'result',
  // T-1731 (D-357): a picture added to a request, removed from it, or its caption changed.
  'image_added',
  'image_removed',
  'image_captioned',
] as const;

// --- Pictures on a teammate request (T-1731, D-357) -------------------------

/** What a console user may upload; HEIC is refused (the server cannot decode it). */
export const CONSOLE_REQUEST_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
/** The largest file accepted, before it is re-encoded: 8 MiB. */
export const CONSOLE_REQUEST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** The most pictures one request holds. */
export const CONSOLE_REQUEST_IMAGES_MAX = 8;
/** A caption's longest, in characters. */
export const CONSOLE_REQUEST_IMAGE_CAPTION_MAX = 300;
/** The stored picture's long side at most, in pixels, and the thumbnail's. */
export const CONSOLE_REQUEST_IMAGE_LONG_SIDE = 2400;
export const CONSOLE_REQUEST_IMAGE_THUMB_SIDE = 480;
