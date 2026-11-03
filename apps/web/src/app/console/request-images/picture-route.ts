/**
 * The console pictures' route handlers' shared checks (T-1731, D-357). Pure,
 * so they are tested once.
 */

export const PICTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The header the console's page sets on an upload; another site's form cannot. */
export const UPLOAD_HEADER = 'x-fmip-console-upload';

/**
 * Whether an upload comes from the console's own page: it carries the
 * header, and its `Origin` is this host (as Caddy passes it on, or as the
 * proxy in front names it).
 */
export function isConsoleUpload(headers: Headers): boolean {
  if (headers.get(UPLOAD_HEADER) !== '1') return false;
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (origin === null || host === null) return false;
  try {
    return new URL(origin).host === host.split(',')[0]!.trim();
  } catch {
    return false;
  }
}

/** The headers of a served picture the viewer's browser needs too. */
export const PASSED_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'content-disposition',
  'x-content-type-options',
  'content-security-policy',
] as const;
