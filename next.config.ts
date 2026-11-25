import type { NextConfig } from "next";
import { SAME_ORIGIN_FRAMEABLE_SOURCES, staticSecurityHeaders } from "./src/server/security/csp";

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js" on responses.
  poweredByHeader: false,
  // Browser source maps stay private (this is the default; set so nobody turns it on by accident).
  productionBrowserSourceMaps: false,
  // Certificates read their OFL fonts from node_modules at run time (src/modules/certificates/ENV.md);
  // tracing doesn't follow those paths, so serverless deployments (Vercel) need them listed.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@expo-google-fonts/lexend/{300Light,400Regular,600SemiBold}/*.ttf",
      "./node_modules/@expo-google-fonts/libre-baskerville/{400Regular,400Regular_Italic,700Bold}/*.ttf",
    ],
  },
  // Going back to a tab opened in the last 30 seconds shows it at once, without the server.
  experimental: { staleTimes: { dynamic: 30 } },
  async redirects() {
    return [{ source: "/platform/universities/:path*", destination: "/platform/institutes/:path*", permanent: true }];
  },
  // Security headers for every response, static files included. The Content-Security-Policy
  // carries a per-request nonce, so src/proxy.ts sets it (src/server/security/csp.ts).
  async headers() {
    return [
      { source: "/:path*", headers: staticSecurityHeaders() },
      // Files our own pages show in an iframe (the PDF viewer) may be framed by Zinny only.
      ...SAME_ORIGIN_FRAMEABLE_SOURCES.map((source) => ({ source, headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] })),
    ];
  },
};

export default nextConfig;
