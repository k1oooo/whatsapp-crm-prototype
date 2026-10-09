import type { NextConfig } from "next";

// Headers that are safe for every page. A full Content-Security-Policy is left out on purpose: Next's inline
// scripts need nonces, and Meta's Embedded Signup loads its SDK and opens a popup, so a strict policy has to
// be built and tested together with those.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nobody should be able to put the dashboard in a frame (clickjacking on "Payment received" and friends).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      // Knowledge base PDF uploads go through a server action. The default cap is 1MB. Vercel's
      // own request limit is 4.5MB, so 4MB of file plus multipart overhead is the practical ceiling.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
