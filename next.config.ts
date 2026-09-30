import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Knowledge base PDF uploads go through a server action. The default cap is 1MB. Vercel's
      // own request limit is 4.5MB, so 4MB of file plus multipart overhead is the practical ceiling.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
