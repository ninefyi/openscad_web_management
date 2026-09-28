import type { Configuration } from "../types/template";

const STASH_PREFIX = "openscad-web-management.pendingConfig.";

export function signInPath(returnTo: string): string {
  return `/login?next=${encodeURIComponent(returnTo)}`;
}

export function signUpPath(returnTo: string | null): string {
  return returnTo ? `/signup?next=${encodeURIComponent(returnTo)}` : "/signup";
}

// Only same-origin paths — `next` comes from the URL, so anything else
// would turn Login into an open redirect.
export function safeReturnPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return null;
  }
  return next;
}

// Survives the round trip through Login/Signup so a visitor who clicks
// Sign in mid-edit comes back to their own Configuration, not the defaults.
export function stashConfiguration(templateId: string, config: Configuration) {
  try {
    sessionStorage.setItem(STASH_PREFIX + templateId, JSON.stringify(config));
  } catch {
    // Blocked storage — the visitor just comes back to the defaults.
  }
}

export function readStashedConfiguration(templateId: string): Configuration | undefined {
  try {
    const raw = sessionStorage.getItem(STASH_PREFIX + templateId);
    return raw ? (JSON.parse(raw) as Configuration) : undefined;
  } catch {
    return undefined;
  }
}

export function clearStashedConfiguration(templateId: string) {
  try {
    sessionStorage.removeItem(STASH_PREFIX + templateId);
  } catch {
    // Nothing to clean up if storage is blocked.
  }
}
