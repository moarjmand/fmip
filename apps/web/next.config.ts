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
};

export default nextConfig;
