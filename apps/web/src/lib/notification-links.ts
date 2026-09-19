import type { Notification } from '@fmip/contracts';
import { notificationPath } from '@fmip/contracts';

/**
 * Turning a notification into a route (T-272), and what it says.
 *
 * Both moved into `@fmip/contracts` on 2026-09-20 (T-330): an e-mail and a
 * push must open exactly what the inbox opens and say exactly what it says,
 * and two copies of a routing table are how they drift apart. The web keeps
 * this module as the place its components import from.
 */
export { NOTIFICATION_TEXT, notificationLine } from '@fmip/contracts';

/** The route the inbox opens, or `null` for a notification that cannot be opened (a subject that no longer resolves). */
export function notificationHref(locale: string, notification: Notification): string | null {
  return notificationPath(locale, notification);
}
