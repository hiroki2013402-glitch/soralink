import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { db } from "./db.js";

// Per-account settings. Each switch is on unless the person turns it off.
// The browser-level choice ("this device gets notifications") lives in the push subscription, not here.
export type NotificationSettings = { dm_push: boolean; notify_likes: boolean; notify_follows: boolean };

const DEFAULTS: NotificationSettings = { dm_push: true, notify_likes: true, notify_follows: true };

export async function settingsFor(userId: string): Promise<NotificationSettings> {
  const r = await db.execute({ sql: "SELECT dm_push, notify_likes, notify_follows FROM user_settings WHERE user_id=?", args: [userId] });
  const row = r.rows[0];
  if (!row) return { ...DEFAULTS };
  return {
    dm_push: Number(row.dm_push) !== 0,
    notify_likes: Number(row.notify_likes) !== 0,
    notify_follows: Number(row.notify_follows) !== 0
  };
}

export const settingsRouter = Router();

settingsRouter.get("/me/settings", requireAuth, async (req, res) => {
  try {
    res.json({ settings: await settingsFor(req.user!.id) });
  } catch {
    res.status(500).json({ error: "設定を読み込めませんでした。" });
  }
});

const patchSchema = z.object({
  dm_push: z.boolean().optional(),
  notify_likes: z.boolean().optional(),
  notify_follows: z.boolean().optional()
}).strict();

settingsRouter.patch("/me/settings", requireAuth, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "設定の内容が正しくありません。" });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "変更する設定がありません。" });
  const me = req.user!.id;
  try {
    const next = { ...(await settingsFor(me)), ...parsed.data };
    await db.execute({
      sql: `INSERT INTO user_settings(user_id, dm_push, notify_likes, notify_follows, updated_at) VALUES(?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET dm_push=excluded.dm_push, notify_likes=excluded.notify_likes,
            notify_follows=excluded.notify_follows, updated_at=excluded.updated_at`,
      args: [me, next.dm_push ? 1 : 0, next.notify_likes ? 1 : 0, next.notify_follows ? 1 : 0, new Date().toISOString()]
    });
    res.json({ settings: next });
  } catch {
    res.status(500).json({ error: "設定を保存できませんでした。" });
  }
});
