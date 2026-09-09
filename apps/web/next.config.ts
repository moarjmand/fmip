import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The build must fail on a type error, not ship past it. Next's default
  // already does this; stating it means a later `ignoreBuildErrors: true` has
  // to be a deliberate edit. Linting is not a build concern in Next 16 — it
  // runs as its own `pnpm lint` task.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
