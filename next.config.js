/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/sitemap.xml',
        destination: '/api/sitemap',
      },
      // Vanity event URL: mentioned.market/berlinsummit (+ ?c=CODE) serves the
      // generic promo landing while keeping the clean URL. Add one line per
      // future event campaign (slug must match lib/eventCampaigns.ts).
      {
        source: '/berlinsummit',
        destination: '/promo/berlinsummit',
      },
    ]
  },
  // Enable compression
  compress: true,
  // Generate ETags
  generateEtags: true,
  // Disable font optimization — Material Symbols variable font axes aren't supported by Next.js optimizer
  optimizeFonts: false,
}

module.exports = nextConfig


