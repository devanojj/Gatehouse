/**
 * Kept dependency-free on purpose: `proxy.ts` imports this, and pulling the
 * database or `server-only` into the proxy bundle would break it.
 */
export const SESSION_COOKIE = "gatehouse_session";
