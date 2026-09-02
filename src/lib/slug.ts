/**
 * Inbound routing slugs.
 *
 * Kept dependency-free: the database module backfills slugs for organizations
 * that predate inbound mail, so this cannot reach back into `db.ts`.
 */

/** No look-alike characters — these end up in addresses people retype. */
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SUFFIX_LENGTH = 6;
const MAX_BASE_LENGTH = 24;

/**
 * The readable half of a slug. Everything outside `a-z0-9` becomes a hyphen so
 * the result is safe in the local part of an email address.
 */
export function slugifyOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, "");

  return base || "org";
}

function randomSuffix(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return suffix;
}

/**
 * A fresh slug for an organization, e.g. `northwind-support-k4m2xp`.
 *
 * The random suffix is what makes it unique — two organizations called
 * "Support" get different addresses. Callers still retry on a unique-index
 * collision rather than trusting the odds.
 */
export function newInboundSlug(orgName: string): string {
  return `${slugifyOrgName(orgName)}-${randomSuffix()}`;
}

/**
 * Turns the shared inbox address into an organization's own address by
 * plus-addressing it: `support@gmail.com` + `acme-k4m2xp` becomes
 * `support+acme-k4m2xp@gmail.com`.
 *
 * Any `+tag` already on the shared address is replaced, so configuring
 * GMAIL_USER with a tag on it cannot produce a double-tagged address.
 */
export function plusAddress(inboxAddress: string, slug: string): string | null {
  const at = inboxAddress.lastIndexOf("@");
  if (at <= 0) return null;

  const localPart = inboxAddress.slice(0, at).split("+")[0];
  const domain = inboxAddress.slice(at + 1);
  if (!localPart || !domain) return null;

  return `${localPart}+${slug}@${domain}`;
}

/**
 * Pulls the slug back out of a recipient address. Returns null for addresses
 * that carry no `+tag`.
 */
export function slugFromAddress(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at <= 0) return null;

  const localPart = address.slice(0, at);
  const plus = localPart.indexOf("+");
  if (plus === -1) return null;

  const slug = localPart.slice(plus + 1).toLowerCase().trim();
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
}
