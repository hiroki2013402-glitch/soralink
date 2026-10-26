import "dotenv/config";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;

if (!url || !anonKey || !serviceKey || !jwtSecret) {
  throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWT_SECRET を設定してください。");
}

export const supabaseUrl: string = url;
export const supabaseAnonKey: string = anonKey;

// Server-side client. The service role bypasses RLS, so every DM route checks membership itself.
export const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Browsers subscribe to Supabase Realtime with a short-lived JWT whose `sub` is the SoraLink user id.
// Row Level Security on dm_members / dm_messages reads that claim, so each browser only receives its own conversations.
export function mintRealtimeToken(userId: string, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: userId, role: "authenticated", aud: "authenticated", iss: "soralink", iat: now, exp: now + ttlSeconds });
  const signature = crypto.createHmac("sha256", jwtSecret as string).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
