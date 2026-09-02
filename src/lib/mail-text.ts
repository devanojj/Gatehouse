import "server-only";

/**
 * Turning a received email into something readable in a ticket.
 *
 * Two jobs, both deliberately conservative: recover a plain-text body from mail
 * that only carried HTML, and drop the quoted history a mail client staples to
 * a reply. Losing a customer's actual words is far worse than showing a few
 * lines of quoting, so every trim here refuses to run when it cannot see real
 * content on the other side of it.
 */

const BLOCK_TAGS =
  /<\/?(?:p|div|br|tr|li|h[1-6]|blockquote|table|section|article|header|footer|hr)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Control characters and out-of-range code points stay as written.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * A usable plain-text body from an HTML-only message.
 *
 * Nothing here is rendered as HTML anywhere in Gatehouse — comment bodies are
 * printed as text — so this is about legibility, not sanitization. Scripts and
 * styles go first so their contents do not end up as words in the ticket.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]+>/g, "");

  return collapse(decodeEntities(text));
}

function collapse(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Where the new message stops and the quoted history begins.
 *
 * Each pattern has to match a whole line, so a sentence that happens to mention
 * "from:" mid-paragraph does not truncate someone's question.
 */
const QUOTE_MARKERS: RegExp[] = [
  // "On Tue, 3 Jun 2025 at 14:02, Dana <dana@acme.com> wrote:"
  /^\s*On\s.+\bwrote:\s*$/i,
  // The same header split across two lines by a narrow window.
  /^\s*On\s.{0,200}$/i,
  /^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/i,
  /^\s*_{10,}\s*$/,
  /^\s*-{10,}\s*$/,
  /^\s*(sent from my \w+|get outlook for \w+)\s*$/i,
];

/** The opening line of a quoted header block, which needs a second field. */
const HEADER_BLOCK_START = /^\s*(from|von|de)\s*:\s*.+$/i;

/** Only the two-line "On …" opener needs its second half confirmed. */
function isQuoteStart(lines: string[], index: number): boolean {
  const line = lines[index];

  if (QUOTE_MARKERS[0].test(line)) return true;

  if (QUOTE_MARKERS[1].test(line)) {
    const next = lines[index + 1] ?? "";
    return /\bwrote:\s*$/i.test(next);
  }

  if (HEADER_BLOCK_START.test(line)) {
    // A mail client's quoted header block always carries a second field.
    const following = lines.slice(index + 1, index + 4).join("\n");
    return /^\s*(sent|date|to|subject|gesendet|an)\s*:/im.test(following);
  }

  return QUOTE_MARKERS.slice(2).some((pattern) => pattern.test(line));
}

/**
 * Trims quoted replies and the standard signature delimiter off the end of a
 * message. Returns the original text whenever trimming would leave nothing —
 * an empty ticket comment is never an improvement.
 */
export function trimQuotedReply(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  let cut = lines.length;

  for (let index = 0; index < lines.length; index++) {
    if (isQuoteStart(lines, index)) {
      cut = index;
      break;
    }

    // A run of quoted lines that continues to the end of the message.
    if (/^\s*>/.test(lines[index])) {
      const rest = lines.slice(index);
      const meaningful = rest.filter((line) => line.trim().length > 0);
      if (meaningful.every((line) => /^\s*>/.test(line))) {
        cut = index;
        break;
      }
    }

    // The RFC 3676 signature delimiter: "-- " on a line of its own.
    if (/^--\s*$/.test(lines[index])) {
      cut = index;
      break;
    }
  }

  const kept = collapse(lines.slice(0, cut).join("\n"));
  return kept ? kept : collapse(normalized);
}

/**
 * The body a ticket should show for an inbound message: the plain-text part
 * when there is one, otherwise the HTML flattened, with quoted history trimmed
 * off either way. Null when the message really carried no words at all.
 */
export function readableBody(parts: {
  text?: string | null;
  html?: string | null;
}): string | null {
  const plain = parts.text?.trim();
  if (plain) return trimQuotedReply(plain) || null;

  const html = parts.html?.trim();
  if (html) {
    const flattened = htmlToText(html);
    return flattened ? trimQuotedReply(flattened) || null : null;
  }

  return null;
}
