// Server-side only: `next/headers` has no client build, so an import from a
// client component fails at build time, which is the guard we want.
import { cookies } from 'next/headers';
import type {
  ApiError,
  ConsoleAuditEntry,
  ConsoleBoardCard,
  ConsoleCommand,
  ConsoleConversation,
  ConsoleInvitationView,
  ConsoleMe,
  ConsoleRequestCounts,
  ConsoleRequestList,
  ConsoleRequestStatus,
  ConsoleModelReport,
  ConsoleSnapshotResponse,
} from '@fmip/contracts';
import { consoleBase } from './console-base';

/**
 * The agents console's calls to the API (D-340), made by the web server with
 * the console's own cookie, `fmip_console`, which lives on the console's
 * host only. The browser never calls the API for the console.
 */

export const CONSOLE_COOKIE = 'fmip_console';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

export type ConsoleResult<T> =
  | { ok: true; status: number; data: T; setCookie: string | null }
  | { ok: false; status: number; error: ApiError | null; setCookie: string | null };

async function cookieHeader(): Promise<string | undefined> {
  const value = (await cookies()).get(CONSOLE_COOKIE)?.value;
  return value === undefined || value === ''
    ? undefined
    : `${CONSOLE_COOKIE}=${encodeURIComponent(value)}`;
}

export async function consoleCall<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ConsoleResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const cookie = await cookieHeader();
  if (cookie !== undefined) headers.cookie = cookie;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/console/${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, error: null, setCookie: null };
  }
  const setCookie = response.headers.get('set-cookie');
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    json = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: json as T, setCookie };
  const error =
    typeof json === 'object' && json !== null && 'error' in json ? (json as ApiError) : null;
  return { ok: false, status: response.status, error, setCookie };
}

/** The `fmip_console` value from the API's `Set-Cookie`, and its age; `null` when it set none. */
export function parseConsoleSetCookie(
  header: string | null,
): { value: string; maxAge: number } | null {
  if (header === null) return null;
  const match = new RegExp(`(?:^|,\\s*)${CONSOLE_COOKIE}=([^;]*)`).exec(header);
  if (match === null) return null;
  const maxAge = /Max-Age=(\d+)/i.exec(header.slice(match.index));
  let value = match[1] ?? '';
  try {
    value = decodeURIComponent(value);
  } catch {
    value = '';
  }
  return { value, maxAge: maxAge === null ? 0 : Number(maxAge[1]) };
}

/**
 * Mirrors the API's console cookie onto the console's host: host-only, strict,
 * and only under the console's base path when it shares a host (D-341).
 */
export async function applyConsoleCookie(header: string | null): Promise<void> {
  const parsed = parseConsoleSetCookie(header);
  if (parsed === null) return;
  const store = await cookies();
  if (parsed.maxAge <= 0 || parsed.value === '') {
    store.delete(CONSOLE_COOKIE);
    return;
  }
  store.set({
    name: CONSOLE_COOKIE,
    value: parsed.value,
    httpOnly: true,
    sameSite: 'strict',
    path: (await consoleBase()) || '/',
    maxAge: parsed.maxAge,
    secure: process.env.NODE_ENV === 'production',
  });
}

export const consoleMe = () => consoleCall<ConsoleMe>('me');
export const consoleSnapshot = () => consoleCall<ConsoleSnapshotResponse>('snapshot');
export const consoleCommands = () => consoleCall<{ commands: ConsoleCommand[] }>('commands');
export const consoleBoard = () => consoleCall<{ cards: ConsoleBoardCard[] }>('board');
export const consoleAudit = () => consoleCall<{ entries: ConsoleAuditEntry[] }>('audit');
/** The forecast model's page (T-1729): the published version, its accuracy, and shadow. */
export const consoleModel = () => consoleCall<ConsoleModelReport>('model');
/** An agent's conversation (T-1722): the newest page, or the one before `before`. */
export const consoleConversation = (agent: string, before?: string) =>
  consoleCall<ConsoleConversation>(
    `agents/${encodeURIComponent(agent)}/messages${
      before === undefined ? '' : `?before=${encodeURIComponent(before)}`
    }`,
  );
/** The teammate requests (T-1728): all, or one status, each with its history. */
export const consoleRequests = (status?: ConsoleRequestStatus) =>
  consoleCall<ConsoleRequestList>(
    `requests${status === undefined ? '' : `?status=${encodeURIComponent(status)}`}`,
  );
/** The counts alone, for the navigation's badge. */
export const consoleRequestCounts = () => consoleCall<ConsoleRequestCounts>('requests/counts');
export const consoleInvitation = (token: string) =>
  consoleCall<ConsoleInvitationView>(`invitations/${encodeURIComponent(token)}`);
