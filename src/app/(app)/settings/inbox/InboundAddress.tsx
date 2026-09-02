"use client";

import { useState } from "react";

/** The address is retyped into another provider's settings, so make it copyable. */
export function InboundAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the address is on screen either way.
      setCopied(false);
    }
  }

  return (
    <div className="address-row">
      <code className="address">{address}</code>
      <button className="btn btn-secondary" type="button" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
