// next.config.js - Configuration for subdomain routing and container preview support
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  // CRITICAL: Transpile monaco-editor and y-monaco to preserve collaborative editing
  transpilePackages: [
    'monaco-editor',
    '@monaco-editor/react',
    'y-monaco'
  ],
  webpack: (config, { isServer, dev }) => {
    // Client-side fallbacks
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        path: false,
        crypto: false,
      };
    }

    // Handle ESM and optional dependencies
    config.externals = config.externals || [];
    if (isServer) {
      // Filter out @kubernetes/client-node from externals to transpile it
      config.externals = config.externals.filter(external => {
        if (typeof external === 'string') {
          return !external.includes('@kubernetes/client-node');
        }
        return true;
      });

      // Add optional dependency handling
      config.externals.push({
        '../monitoring/logger': 'commonjs ../monitoring/logger',
        '../tools/dynamic-tool-creator': 'commonjs ../tools/dynamic-tool-creator',
        '../orchestration/enhanced-orchestrator': 'commonjs ../orchestration/enhanced-orchestrator',
        '../../unified-llm-client': 'commonjs ../../unified-llm-client',
        '@kubernetes/client-node': 'commonjs @kubernetes/client-node'
      });

      // Skip Monaco in SSR completely (but still available client-side)
      config.resolve.alias = {
        ...config.resolve.alias,
        'monaco-editor': false,
        '@monaco-editor/react': false,
        'y-monaco': false,
      };
    }

    // Development-specific configs
    if (dev) {
      config.watchOptions = {
        ignored: /node_modules/,
        poll: false
      };
      config.optimization = {
        ...config.optimization,
        minimize: false,
      };
    }

    // CRITICAL: Monaco Editor handling
    // transpilePackages above handles the CSS imports
    // We just need to ensure workers are available
    if (!isServer) {
      // Monaco Editor requires special webpack handling for workers
      config.plugins = config.plugins || [];
    }

    return config;
  },
  output: 'standalone',

  // Production URL
  productionBrowserSourceMaps: false,

  async rewrites() {
    return {
      beforeFiles: [
        // Handle subdomain routing for deployed sites
        {
          source: '/:path*',
          has: [
            {
              type: 'host',
              value: '(?<subdomain>\\w+)\\.(?<domain>.*)',
            },
          ],
          destination: '/api/site/:subdomain/:path*',
        },
      ],
      afterFiles: [
        // Handle preview routes
        {
          source: '/preview/:projectId/:path*',
          destination: '/api/preview/render/:projectId/:path*',
        },
      ],
    };
  },

  async headers() {
    // Enhanced security headers
    const ContentSecurityPolicy = `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: *.vercel.app *.googleapis.com;
      style-src 'self' 'unsafe-inline' *.googleapis.com;
      img-src 'self' blob: data: *.googleapis.com *.gstatic.com *.unsplash.com *.githubusercontent.com *.googleusercontent.com;
      font-src 'self' data: *.gstatic.com;
      connect-src 'self' blob: *.supabase.co *.supabase.in wss://*.supabase.co wss://*.supabase.in *.googleapis.com *.anthropic.com *.openai.com http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:*;
      worker-src 'self' blob:;
      media-src 'self';
      frame-src 'self' *.youtube.com *.google.com;
      frame-ancestors 'self';
      base-uri 'self';
      form-action 'self';
      object-src 'none';
      upgrade-insecure-requests;
    `.replace(/\s{2,}/g, ' ').trim();

    return [
      // Enhanced security headers for all pages
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()'
          },
          {
            key: 'Content-Security-Policy',
            value: ContentSecurityPolicy
          }
        ],
      },
      // Allow iframe embedding for editor and preview pages
      {
        source: '/editor',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; connect-src 'self' blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:* data:; worker-src 'self' blob:; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:;",
          },
        ],
      },
      // Headers for deployed sites iframe embedding
      {
        source: '/api/site/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL', // Allow embedding in iframes
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' http://localhost:* https://*.ezcoder.app",
          },
        ],
      },
      // Headers for preview routes
      {
        source: '/api/preview/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL',
          },
        ],
      },
    ];
  },

  // Image optimization for deployed sites
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.ezcoder.app',
      },
      {
        protocol: 'https',
        hostname: 'rovzexmkxepmlxelyqkg.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.vercel.app',
      }
    ],
  },

  // Environment variables
  env: {
    DEPLOYMENT_DOMAIN: process.env.DEPLOYMENT_DOMAIN || 'ezcoder.app',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },

  // Experimental features for better performance
  experimental: {
    // Exclude webpack cache from serverless function tracing to fix size limit
    outputFileTracingExcludes: {
      '*': [
        '.next/cache/**/*',
        'node_modules/@swc/**',
        'node_modules/webpack/**',
        'node_modules/terser-webpack-plugin/**'
      ]
    }
  },

  // Custom build ID for deployments
  async generateBuildId() {
    // You can customize build ID if needed
    return 'ezcoder-' + Date.now();
  },
};

module.exports = nextConfig;
