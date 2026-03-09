/*
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here %/
};

export default nextConfig;

*/

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * MediaPipe's @mediapipe/tasks-genai package includes .wasm files that webpack
   * tries to process. We point it at the CDN instead (see useLLM.ts), but we
   * still need to tell webpack how to handle wasm imports from node_modules.
   */
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Allow async wasm imports (needed for mediapipe internals)
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
        layers: true,
      };
    }

    // Prevent webpack from bundling mediapipe's wasm files (they're loaded via CDN)
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };

    return config;
  },
  turbopack: {},

  async rewrites() {
    return [{
      source: '/assets/gemma-3n-E4B-it-int4-Web.litertlm',
      destination: 'https://pub-b70c4fb87d5a4729bea48e6ac51944eb.r2.dev/gemma-3n-E4B-it-int4-Web.litertlm',
    }]
  }

  /**
   * The model file (gemma-3n-E4B-it-int4-Web.litertlm) is ~3GB and lives in
   * public/assets/. Next.js serves it as a static file — no special config needed,
   * but note that Vercel's edge network may have issues with files this large.
   * For deployment, consider a CDN or object storage (R2, S3) instead.
   */
};

export default nextConfig;