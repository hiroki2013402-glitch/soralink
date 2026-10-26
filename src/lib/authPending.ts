// Remembers that a sign-in is in progress across the Sennin Account redirect, so the 認証中 overlay
// can stay up while the app loads on return. sessionStorage can be blocked, so every access is guarded.
const KEY = "soralink_auth_pending";

export function markAuthPending() {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* storage unavailable: the overlay still shows on click */ }
}

export function clearAuthPending() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function isAuthPending(): boolean {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}
