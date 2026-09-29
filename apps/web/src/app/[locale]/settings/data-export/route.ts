import type { DataExport, DataExportRequest } from '@fmip/contracts';
import { apiRequest } from '@/lib/api';
import { type DataExportRefusal, refusalOf } from '@/lib/data-export';
import { readerAddress, sessionCookieHeader } from '@/lib/session';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';

export const dynamic = 'force-dynamic';

/**
 * Settings -> Download my data (T-846, D-158). A plain form posts the password
 * here; the API decides it, and the file comes back as an attachment to this
 * session only -- never e-mailed, never cached. Any refusal sends the member
 * back to the section with the reason, so it works without script.
 *
 * A form from another site cannot use this: the session cookie is SameSite=Lax
 * (D-026), so a cross-site POST arrives signed out, and the `Origin` must be
 * this site's as well.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  // A relative Location: behind the TLS-terminating proxy the handler's own
  // URL says http, and the browser resolves this against the page it is on.
  const back = (reason: DataExportRefusal) =>
    new Response(null, {
      status: 303,
      headers: { location: `/${locale}/settings?export=${reason}#download-data` },
    });

  if (!sameSite(request)) return back('signed_out');

  const cookie = await sessionCookieHeader();
  if (cookie === undefined) return back('signed_out');

  let password = '';
  try {
    const value = (await request.formData()).get('password');
    password = typeof value === 'string' ? value : '';
  } catch {
    return back('password');
  }
  if (password === '') return back('password');

  const body: DataExportRequest = { password };
  const result = await apiRequest<DataExport>('/auth/account/export', {
    method: 'POST',
    body,
    cookie,
    // The password check is held to the sign-in ceilings, per address too (T-811).
    clientIp: await readerAddress(),
  });
  if (!result.ok) return back(refusalOf(result.status, result.error));

  const day = result.data.generated_at.slice(0, 10);
  return new Response(JSON.stringify(result.data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="fmip-data-${result.data.account.username}-${day}.json"`,
      'cache-control': 'no-store',
    },
  });
}

/**
 * The form was posted from this site: an `Origin` naming another host is
 * refused. Hosts are compared, not origins, because the scheme the handler
 * sees behind the proxy is not the one the browser used.
 */
function sameSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
