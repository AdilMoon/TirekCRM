import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
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
