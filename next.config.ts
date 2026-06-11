import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // prompts/*.md are read with fs at runtime (lib/agent/client.ts loadPrompt);
  // the file tracer can't see dynamic reads, so include them explicitly or
  // every agent call 500s with ENOENT on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**"],
  },
};

export default nextConfig;
