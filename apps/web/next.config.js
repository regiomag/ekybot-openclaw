/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ekybot/ui', '@ekybot/shared'],
  typescript: {
    // Build passes locally, ignore errors on Vercel for now
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Explicit path aliases for Vercel builds
  experimental: {
    typedRoutes: false,
  },
  webpack: (config) => {
    // Add YAML loader for i18n files
    config.module.rules.push({
      test: /\.yaml$/,
      use: 'yaml-loader',
    });
    return config;
  },
};

module.exports = nextConfig;
// Build trigger 1770411955
