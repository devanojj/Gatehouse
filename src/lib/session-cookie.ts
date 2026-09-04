/**
 * Kept dependency-free on purpose: `proxy.ts` imports this, and pulling the
 * database or `server-only` into the proxy bundle would break it.
 */
export const SESSION_COOKIE = "gatehouse_session";

/**
 * The customer portal's cookie, deliberately a different name from the agent
 * one. The two realms never share a session: a customer cookie can never
 * resolve to an agent, whatever a request claims.
 */
export const CUSTOMER_SESSION_COOKIE = "gatehouse_customer";
