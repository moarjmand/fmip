import type { HealthReport } from '@fmip/contracts';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

/**
 * The API's own reachability, as seen from the web app.
 *
 * `unreachable` is a state, not an error to swallow: rule 3 says a missing
 * answer is labelled, never faked. The caller renders the difference.
 */
export type ApiHealth = { reachable: true; report: HealthReport } | { reachable: false };

export async function fetchApiHealth(): Promise<ApiHealth> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });

    if (!response.ok) {
      return { reachable: false };
    }

    return { reachable: true, report: (await response.json()) as HealthReport };
  } catch {
    // The API being down is an expected state during development, not an
    // exception the page should crash on.
    return { reachable: false };
  }
}
