import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "./db.js";
import { hashToken, verifyCookie } from "./security.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; display_name: string; email: string | null; avatar_url: string | null };
      sessionId?: string;
      isAdmin?: boolean;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = verifyCookie(req.cookies?.soralink_session);
    if (!raw) return res.status(401).json({ error: "ログインしてください。" });
    const session = await db.execute({
      sql: `SELECT s.user_id, s.is_admin, u.display_name, u.email, u.avatar_url, u.banned_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id_hash = ? AND s.expires_at > ?`,
      args: [hashToken(raw), Date.now()]
    });
    if (!session.rows.length) return res.status(401).json({ error: "セッションの有効期限が切れました。再ログインしてください。" });
    const row = session.rows[0];
    if (row.banned_at) {
      // A banned account loses every session at once, so it cannot keep acting with an old cookie.
      await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [String(row.user_id)] });
      return res.status(403).json({ error: "このアカウントは利用停止中です。", code: "ACCOUNT_BANNED" });
    }
    req.user = {
      id: String(row.user_id),
      display_name: String(row.display_name),
      email: row.email === null ? null : String(row.email),
      avatar_url: row.avatar_url === null ? null : String(row.avatar_url)
    };
    req.isAdmin = Number(row.is_admin) === 1;
    req.sessionId = raw;
    next();
  } catch {
    res.status(500).json({ error: "認証情報を確認できませんでした。" });
  }
}

const adminOnly: RequestHandler = (req, res, next) => {
  if (!req.isAdmin) {
    res.status(403).json({ error: "管理者としてログインしてください。", code: "NOT_ADMIN" });
    return;
  }
  next();
};

// Use as: router.get(path, ...requireAdmin, handler). Requires a signed-in session that was granted admin rights.
export const requireAdmin: RequestHandler[] = [requireAuth, adminOnly];
