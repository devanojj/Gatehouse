import "server-only";

export type EmailOptions = {
  /**
   * Display name to send under, e.g. the organization's name. The address
   * itself cannot change — it has to stay on a domain the provider has
   * verified — so only the name in front of it varies per tenant.
   */
  fromName?: string | null;
  /** Where a reply should go. For ticket mail, the org's inbound address. */
  replyTo?: string | null;
};

/**
 * The single seam between Gatehouse and an email provider.
 *
 * With RESEND_API_KEY set, mail goes out through Resend. Without it, the
 * message is logged to the server console — which is enough to run the whole
 * app locally, magic links included, with no domain or provider configured.
 *
 * Wiring up a real domain later means changing this function and nothing else.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options: EmailOptions = {},
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = fromHeader(options.fromName);
  const replyTo = headerSafe(options.replyTo);

  if (!apiKey) {
    console.log(
      [
        "",
        "──────────────── email (not sent: no RESEND_API_KEY) ────────────────",
        `From:    ${from}`,
        `To:      ${to}`,
        ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
        `Subject: ${subject}`,
        "",
        body,
        "─────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: body,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend rejected the message (${response.status}): ${detail}`);
  }
}

const DEFAULT_FROM = "Gatehouse <onboarding@resend.dev>";

/**
 * Rebuilds the From header with a per-tenant display name in front of the
 * configured address.
 */
function fromHeader(displayName?: string | null): string {
  const configured = process.env.EMAIL_FROM ?? DEFAULT_FROM;
  const name = headerSafe(displayName);
  if (!name) return configured;

  const angled = configured.match(/<([^>]+)>/);
  const address = (angled ? angled[1] : configured).trim();

  // Quote the display name so commas, colons and the like cannot split the
  // header into extra fields.
  return `"${name.replace(/"/g, "'")}" <${address}>`;
}

/**
 * Strips anything that could start a new header line. Organization names reach
 * this from a signup form, so a name containing CRLF must not be able to inject
 * a Bcc or a second Reply-To.
 */
function headerSafe(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim();
  return cleaned || null;
}
