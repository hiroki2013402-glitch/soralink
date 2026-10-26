import type { Request } from "express";
import { verifyCookie } from "./security.js";

// Admin gate. Entering the admin password sets a short-lived signed cookie. The next Sennin Account login
// that completes while the cookie is still valid is granted admin rights, and the cookie is cleared at once.
export const ADMIN_GATE_COOKIE = "soralink_admin_gate";
export const ADMIN_GATE_MS = 15 * 60 * 1000;
// Admin sessions last 12 hours, much shorter than normal sessions, and end at logout.
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

export function adminGateOpen(req: Request): boolean {
  const value = verifyCookie(req.cookies?.[ADMIN_GATE_COOKIE]);
  return value !== null && Number(value) > Date.now();
}
