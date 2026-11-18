import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // Keep local Docker builds within the desktop VM's memory budget.
  ...(process.env.TIREK_DOCKER_BUILD === '1' ? { experimental: { cpus: 2 } } : {}),
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    }];
  },
  webpack(config) {
    // Keep local paths stable when node_modules lives on another Windows drive.
    config.resolve.symlinks = false;
    config.resolveLoader.symlinks = false;
    // Workspace junctions contain changing source, unlike installed npm dependencies.
    config.snapshot.managedPaths = [/^(.+?[\\/]node_modules[\\/])(?!@tirek[\\/])/];
    return config;
  },
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/:path*` }]; },
};
export default nextConfig;
