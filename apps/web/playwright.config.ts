import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WEB_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // A layout assertion that passes only sometimes is worse than none: it
  // teaches everyone to re-run the job.
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Escape hatch for environments that ship a browser but cannot download
        // one (a sandbox with no access to Playwright's CDN, an air-gapped
        // machine). Unset everywhere else, including CI, which installs the
        // browser matching the pinned @playwright/test version.
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
          : {}),
      },
    },
  ],
  webServer: {
    // Against a production build, not the dev server: the dev server applies
    // CSS differently enough that a passing check would not prove much.
    //
    // Built through Turbo from the workspace root rather than `pnpm build`
    // here, so the `^build` edge pulls in @fmip/contracts first. Building
    // apps/web alone bypasses the dependency graph and fails to type check on
    // any checkout where the contracts package has not already been built —
    // which is every CI run.
    command: `pnpm --dir ../.. exec turbo run build --filter=@fmip/web && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
