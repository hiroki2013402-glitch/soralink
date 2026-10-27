import "dotenv/config";
import { Router } from "express";
import webpush from "web-push";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { db } from "./db.js";

// Web Push notifications for direct messages (Android Chrome, and iOS 16.4+ when added to the home screen).
// Keys come from the environment. Without them the feature stays off and the rest of the app is unaffected.
export const push = Router();

const publicKey = process.env.VAPID_PUBLIC_KEY || "";
const privateKey = process.env.VAPID_PRIVATE_KEY || "";
const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
export const pushEnabled = Boolean(publicKey && privateKey);

if (pushEnabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が未設定のため、プッシュ通知は無効です。");
}

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048).refine(s => s.startsWith("https://"), "通知の登録先が正しくありません。"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) })
});

push.get("/push/public-key", (_req, res) => {
  res.json({ enabled: pushEnabled, publicKey: pushEnabled ? publicKey : null });
});

// Stores (or refreshes) this browser's subscription for the signed-in user.
push.post("/push/subscribe", requireAuth, async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: "通知は現在利用できません。" });
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "通知の登録情報が正しくありません。" });
  try {
    // A browser that signs in as someone else takes over its endpoint, so the old owner stops receiving its notifications.
    await db.execute({
      sql: "INSERT OR REPLACE INTO push_subscriptions(endpoint, user_id, p256dh, auth, created_at) VALUES(?,?,?,?,?)",
      args: [parsed.data.endpoint, req.user!.id, parsed.data.keys.p256dh, parsed.data.keys.auth, new Date().toISOString()]
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "通知を登録できませんでした。" });
  }
});

// Removes this browser's subscription (used on sign-out and when the user turns notifications off).
push.post("/push/unsubscribe", requireAuth, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  try {
    await db.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", args: [endpoint, req.user!.id] });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "通知の解除に失敗しました。" });
  }
});

// Sends one notification to every subscribed device of the given users, skipping those who are online right now.
// Subscriptions the push service reports as gone (404/410) are removed.
export async function notifyDmRecipients(args: {
  recipients: string[];
  conversationId: string;
  senderName: string;
  preview: string;
  isOnline: (userId: string) => boolean;
}) {
  if (!pushEnabled) return;
  const targets = args.recipients.filter(id => !args.isOnline(id));
  if (!targets.length) return;
  try {
    const found = await db.execute({
      sql: `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${targets.map(() => "?").join(",")})`,
      args: targets
    });
    const payload = JSON.stringify({
      title: args.senderName,
      body: args.preview,
      url: `/page/messages/${encodeURIComponent(args.conversationId)}`,
      tag: `dm-${args.conversationId}`
    });
    await Promise.all(found.rows.map(async row => {
      const endpoint = String(row.endpoint);
      try {
        await webpush.sendNotification(
          { endpoint, keys: { p256dh: String(row.p256dh), auth: String(row.auth) } },
          payload,
          { TTL: 3600, urgency: "normal" }
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [endpoint] });
        }
      }
    }));
  } catch {
    // A failed notification must never fail the message that caused it.
  }
}
