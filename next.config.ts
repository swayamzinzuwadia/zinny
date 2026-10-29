import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Certificates read their OFL fonts from node_modules at run time (src/modules/certificates/ENV.md);
  // tracing doesn't follow those paths, so serverless deployments (Vercel) need them listed.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@expo-google-fonts/lexend/{300Light,400Regular,600SemiBold}/*.ttf",
      "./node_modules/@expo-google-fonts/libre-baskerville/{400Regular,400Regular_Italic,700Bold}/*.ttf",
    ],
  },
};

export default nextConfig;
