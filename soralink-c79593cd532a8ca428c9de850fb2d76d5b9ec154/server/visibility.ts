import type { Request } from "express";
import { db } from "./db.js";
import { hashToken, verifyCookie } from "./security.js";

export const VISIBILITIES = ["public", "followers", "close_friends"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

// Returns the signed-in user id from the session cookie, or null for guests. Never sends a response.
export async function resolveViewer(req: Request): Promise<string | null> {
  const raw = verifyCookie(req.cookies?.soralink_session);
  if (!raw) return null;
  const r = await db.execute({
    sql: "SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash=? AND s.expires_at>? AND u.banned_at IS NULL",
    args: [hashToken(raw), Date.now()]
  });
  return r.rows.length ? String(r.rows[0].user_id) : null;
}

// SQL condition: which posts (table alias p) the viewer may see. Bind it with visibleArgs(viewer).
// Public posts are visible to everyone; followers-only posts to followers; close-friend posts to the author's close friends.
// The author always sees their own posts. A guest is represented by an empty viewer id, which matches nothing private.
export const VISIBLE_TO_SQL = `(p.visibility='public' OR p.user_id=? OR (p.visibility='followers' AND EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.followed_id=p.user_id)) OR (p.visibility='close_friends' AND EXISTS(SELECT 1 FROM close_friends vc WHERE vc.owner_id=p.user_id AND vc.friend_id=?)))`;

export function visibleArgs(viewer: string | null): string[] {
  const v = viewer ?? "";
  return [v, v, v];
}

// Single-post check, used when a route already has the post's owner and visibility.
export async function canSeePost(viewer: string | null, ownerId: string, visibility: string): Promise<boolean> {
  if (visibility === "public" || (viewer !== null && viewer === ownerId)) return true;
  if (!viewer) return false;
  if (visibility === "followers") {
    const r = await db.execute({ sql: "SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?", args: [viewer, ownerId] });
    return r.rows.length > 0;
  }
  if (visibility === "close_friends") {
    const r = await db.execute({ sql: "SELECT 1 FROM close_friends WHERE owner_id=? AND friend_id=?", args: [ownerId, viewer] });
    return r.rows.length > 0;
  }
  return false;
}
