import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The IMAP client and the MIME parser are Node libraries that reach for
  // built-ins and optional dependencies at runtime. Leaving them out of the
  // bundle keeps the mail fetcher working on the server.
  serverExternalPackages: ["imapflow", "mailparser"],
};

export default nextConfig;
