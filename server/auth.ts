import type { NextFunction, Request, Response } from "express";
import { db } from "./db.js";
import { hashToken, verifyCookie } from "./security.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; display_name: string; email: string | null; avatar_url: string | null };
      sessionId?: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = verifyCookie(req.cookies?.soralink_session);
    if (!raw) return res.status(401).json({ error: "ログインしてください。" });
    const session = await db.execute({
      sql: `SELECT s.user_id, u.display_name, u.email, u.avatar_url
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id_hash = ? AND s.expires_at > ?`,
      args: [hashToken(raw), Date.now()]
    });
    if (!session.rows.length) return res.status(401).json({ error: "セッションの有効期限が切れました。再ログインしてください。" });
    const row = session.rows[0];
    req.user = {
      id: String(row.user_id),
      display_name: String(row.display_name),
      email: row.email === null ? null : String(row.email),
      avatar_url: row.avatar_url === null ? null : String(row.avatar_url)
    };
    req.sessionId = raw;
    next();
  } catch {
    res.status(500).json({ error: "認証情報を確認できませんでした。" });
  }
}