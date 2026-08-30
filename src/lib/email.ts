import "server-only";

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
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log(
      [
        "",
        "──────────────── email (not sent: no RESEND_API_KEY) ────────────────",
        `To:      ${to}`,
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
      from: process.env.EMAIL_FROM ?? "Gatehouse <onboarding@resend.dev>",
      to: [to],
      subject,
      text: body,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend rejected the message (${response.status}): ${detail}`);
  }
}
