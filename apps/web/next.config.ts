import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone: the server plus only the node_modules it actually
  // reaches. The alternative is copying the whole workspace's node_modules into
  // the image, which for a pnpm monorepo means shipping every package every app
  // depends on.
  output: 'standalone',
  // The build must fail on a type error, not ship past it. Next's default
  // already does this; stating it means a later `ignoreBuildErrors: true` has
  // to be a deliberate edit. Linting is not a build concern in Next 16 — it
  // runs as its own `pnpm lint` task.
  typescript: { ignoreBuildErrors: false },
  // The page's stylesheet goes into the HTML as <style> instead of a <link>
  // (T-1469, D-246): on a phone, the two CSS requests held the first paint
  // back by about 1.8 s (PageSpeed, 2026-10-22). The cost is ~13 kB more per
  // HTML answer and no CSS cached across visits; a guest's page is itself
  // cached at the edge (D-244), so the trade is paid once per 30 seconds.
  experimental: { inlineCss: true },
};

export default nextConfig;
