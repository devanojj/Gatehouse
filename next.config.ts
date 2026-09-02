import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The IMAP client and the MIME parser are Node libraries that reach for
  // built-ins and optional dependencies at runtime. Leaving them out of the
  // bundle keeps the mail fetcher working on the server.
  serverExternalPackages: ["imapflow", "mailparser"],
  experimental: {
    serverActions: {
      // Attachments are posted through the composer's Server Action, and the
      // default cap on an action body is 1MB. This leaves room for the 10MB
      // per-file limit in `src/lib/attachments.ts` plus multipart overhead;
      // the file size itself is still enforced server-side.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
