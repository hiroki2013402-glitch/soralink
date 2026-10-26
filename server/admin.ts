import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "./auth.js";
import { ADMIN_GATE_COOKIE, ADMIN_GATE_MS, adminGateOpen } from "./adminGate.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { hashToken, signCookie, verifyCookie } from "./security.js";
import { sb } from "./supabase.js";
import { deleteVideoForPost } from "./videos.js";
import { postCleanupStatements } from "./postExtras.js";
import { VISIBILITIES } from "./visibility.js";

// Admin area: user bans and per-user settings, post edit/delete, site-wide announcements, reading every DM.
// Every admin action is written to admin_audit. DM reads use the service role, so they are gated here by requireAdmin.
export const admin = Router();

const BUCKET = "dm-images";
const DM_PAGE_SIZE = 50;
const cookieBase = { httpOnly: true, secure: config.nodeEnv === "production", sameSite: "lax" as const, path: "/" };
const pick = (value: unknown) => (typeof value === "string" ? value : "");
const queryText = (value: unknown, max = 50) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const likeEscape = (value: string) => value.replace(/[\\%_]/g, c => `\\${c}`);
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
const unknownPerson = (id: string) => ({ id, display_name: "退会したユーザー", avatar_url: null as string | null });

// Wrong passwords per IP: 5 within 15 minutes locks the gate until the window ends.
const FAILURE_LIMIT = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();
function isLocked(ip: string) {
  const f = failures.get(ip);
  return Boolean(f && f.resetAt > Date.now() && f.count >= FAILURE_LIMIT);
}
function recordFailure(ip: string) {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || f.resetAt <= now) failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  else f.count += 1;
}

// Compare SHA-256 digests so the check takes the same time whatever the input is.
function passwordMatches(input: string) {
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

async function audit(adminId: string, action: string, target: string | null, detail: string | null) {
  await db.execute({
    sql: "INSERT INTO admin_audit(id, admin_id, action, target, detail, created_at) VALUES(?,?,?,?,?,?)",
    args: [crypto.randomUUID(), adminId, action, target, detail ? detail.slice(0, 500) : null, new Date().toISOString()]
  });
}

// Names and avatars come from Turso, where the user directory lives.
async function peopleFor(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const people = new Map<string, { id: string; display_name: string; avatar_url: string | null }>();
  if (!unique.length) return people;
  const r = await db.execute({
    sql: `SELECT id, display_name, avatar_url FROM users WHERE id IN (${unique.map(() => "?").join(",")})`,
    args: unique
  });
  for (const row of r.rows) {
    people.set(String(row.id), {
      id: String(row.id),
      display_name: String(row.display_name),
      avatar_url: row.avatar_url === null ? null : String(row.avatar_url)
    });
  }
  return people;
}

// ---- Admin login: password gate, then Sennin Account login (the callback grants admin, see oauth.ts) ----

const unlockSchema = z.object({ password: z.string().min(1).max(200) });

admin.post("/admin/unlock", async (req, res) => {
  if (!config.adminPassword) {
    return res.status(503).json({ error: "管理者パスワードが設定されていません。サーバーの ADMIN_PASSWORD を確認してください。" });
  }
  const ip = req.ip ?? "unknown";
  if (isLocked(ip)) return res.status(429).json({ error: "パスワードの入力回数が上限に達しました。15分ほど待ってから再試行してください。" });
  const parsed = unlockSchema.safeParse(req.body);
  if (!parsed.success || !passwordMatches(parsed.data.password)) {
    recordFailure(ip);
    return res.status(401).json({ error: "パスワードが正しくありません。" });
  }
  failures.delete(ip);
  res.cookie(ADMIN_GATE_COOKIE, signCookie(String(Date.now() + ADMIN_GATE_MS)), { ...cookieBase, maxAge: ADMIN_GATE_MS });
  res.json({ ok: true });
});

// Works without a session: tells the admin page which step to show.
admin.get("/admin/status", async (req, res) => {
  try {
    const raw = verifyCookie(req.cookies?.soralink_session);
    let user: { id: string; display_name: string; avatar_url: string | null } | null = null;
    let isAdmin = false;
    if (raw) {
      const r = await db.execute({
        sql: `SELECT s.is_admin, u.id, u.display_name, u.avatar_url
              FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.id_hash = ? AND s.expires_at > ? AND u.banned_at IS NULL`,
        args: [hashToken(raw), Date.now()]
      });
      if (r.rows.length) {
        const row = r.rows[0];
        isAdmin = Number(row.is_admin) === 1;
        user = { id: String(row.id), display_name: String(row.display_name), avatar_url: row.avatar_url === null ? null : String(row.avatar_url) };
      }
    }
    res.json({ configured: Boolean(config.adminPassword), gateOpen: !isAdmin && adminGateOpen(req), isAdmin, user });
  } catch {
    res.status(500).json({ error: "管理者の状態を確認できませんでした。" });
  }
});

// ---- Users and per-user settings ----

admin.get("/admin/users", ...requireAdmin, async (req, res) => {
  const q = queryText(req.query.q);
  const pattern = `%${likeEscape(q)}%`;
  try {
    const r = await db.execute({
      sql: `SELECT id, display_name, email, avatar_url, created_at, banned_at, banned_reason FROM users
            WHERE ? = '' OR display_name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'
            ORDER BY created_at DESC LIMIT 100`,
      args: [q, pattern, pattern, pattern]
    });
    res.json({ users: r.rows });
  } catch {
    res.status(500).json({ error: "ユーザーを読み込めませんでした。" });
  }
});

admin.get("/admin/users/:id", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  try {
    const u = await db.execute({
      sql: "SELECT id, display_name, email, avatar_url, cover_url, bio, website, created_at, banned_at, banned_reason FROM users WHERE id = ?",
      args: [id]
    });
    if (!u.rows.length) return res.status(404).json({ error: "ユーザーが見つかりません。" });
    const [posts, followers, following, sessions] = await Promise.all([
      db.execute({
        sql: "SELECT id, media_type, media_url, caption, visibility, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
        args: [id]
      }),
      db.execute({ sql: "SELECT COUNT(*) n FROM follows WHERE followed_id = ?", args: [id] }),
      db.execute({ sql: "SELECT COUNT(*) n FROM follows WHERE follower_id = ?", args: [id] }),
      db.execute({ sql: "SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND expires_at > ?", args: [id, Date.now()] })
    ]);
    res.json({
      user: u.rows[0],
      posts: posts.rows,
      followers: Number(followers.rows[0]?.n ?? 0),
      following: Number(following.rows[0]?.n ?? 0),
      activeSessions: Number(sessions.rows[0]?.n ?? 0)
    });
  } catch {
    res.status(500).json({ error: "ユーザー情報を読み込めませんでした。" });
  }
});

const banSchema = z.object({ reason: z.string().trim().max(200).optional().default("") });

admin.post("/admin/users/:id/ban", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  const parsed = banSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "停止理由は200文字以内で入力してください。" });
  if (id === req.user!.id) return res.status(400).json({ error: "自分自身は停止できません。" });
  try {
    const target = await db.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [id] });
    if (!target.rows.length) return res.status(404).json({ error: "ユーザーが見つかりません。" });
    const otherAdmin = await db.execute({
      sql: "SELECT 1 FROM sessions WHERE user_id = ? AND is_admin = 1 AND expires_at > ?",
      args: [id, Date.now()]
    });
    if (otherAdmin.rows.length) return res.status(400).json({ error: "管理者アカウントは停止できません。" });
    const reason = parsed.data.reason || null;
    await db.batch([
      { sql: "UPDATE users SET banned_at = ?, banned_reason = ? WHERE id = ?", args: [new Date().toISOString(), reason, id] },
      { sql: "DELETE FROM sessions WHERE user_id = ?", args: [id] }
    ], "write");
    await audit(req.user!.id, "ban_user", id, reason);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "利用停止にできませんでした。" });
  }
});

admin.post("/admin/users/:id/unban", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  try {
    const r = await db.execute({ sql: "UPDATE users SET banned_at = NULL, banned_reason = NULL WHERE id = ?", args: [id] });
    if (!r.rowsAffected) return res.status(404).json({ error: "ユーザーが見つかりません。" });
    await audit(req.user!.id, "unban_user", id, null);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "利用停止を解除できませんでした。" });
  }
});

// ---- Posts: list, edit, delete ----

admin.get("/admin/posts", ...requireAdmin, async (req, res) => {
  const q = queryText(req.query.q);
  try {
    const r = await db.execute({
      sql: `SELECT p.id, p.user_id, p.media_type, p.media_url, p.caption, p.visibility, p.created_at, u.display_name, u.avatar_url
            FROM posts p JOIN users u ON u.id = p.user_id
            WHERE ? = '' OR p.caption LIKE ? ESCAPE '\\'
            ORDER BY p.created_at DESC LIMIT 100`,
      args: [q, `%${likeEscape(q)}%`]
    });
    res.json({ posts: r.rows });
  } catch {
    res.status(500).json({ error: "投稿を読み込めませんでした。" });
  }
});

const postEditSchema = z.object({
  caption: z.string().trim().max(500, "本文は500文字以内で入力してください。"),
  visibility: z.enum(VISIBILITIES).optional()
});

admin.patch("/admin/posts/:id", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  const parsed = postEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "入力を確認してください。" });
  try {
    const found = await db.execute({ sql: "SELECT id, media_type, caption, visibility FROM posts WHERE id = ?", args: [id] });
    if (!found.rows.length) return res.status(404).json({ error: "投稿が見つかりません。" });
    const before = found.rows[0];
    if (!parsed.data.caption && !before.media_type) return res.status(400).json({ error: "テキストか画像・動画を入力してください。" });
    const visibility = parsed.data.visibility ?? String(before.visibility);
    await db.execute({ sql: "UPDATE posts SET caption = ?, visibility = ? WHERE id = ?", args: [parsed.data.caption, visibility, id] });
    await audit(req.user!.id, "edit_post", id, `公開範囲: ${before.visibility} → ${visibility} / 変更前の本文: ${String(before.caption).slice(0, 200)}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "投稿を更新できませんでした。" });
  }
});

admin.delete("/admin/posts/:id", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  try {
    const found = await db.execute({ sql: "SELECT id, user_id, media_type, media_url FROM posts WHERE id = ?", args: [id] });
    if (!found.rows.length) return res.status(404).json({ error: "投稿が見つかりません。" });
    const post = found.rows[0];
    // Remove dependents explicitly so deletion does not rely on foreign-key cascades being enabled.
    await db.batch([...postCleanupStatements(id), { sql: "DELETE FROM posts WHERE id = ?", args: [id] }], "write");
    if (post.media_type === "video") {
      await deleteVideoForPost(post.media_url === null ? null : String(post.media_url)).catch(() => undefined);
    }
    await audit(req.user!.id, "delete_post", id, `投稿者: ${String(post.user_id)}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "投稿を削除できませんでした。" });
  }
});

// ---- Announcements ----

const announcementSchema = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください。").max(60, "タイトルは60文字以内で入力してください。"),
  body: z.string().trim().min(1, "本文を入力してください。").max(500, "本文は500文字以内で入力してください。")
});

admin.get("/admin/announcements", ...requireAdmin, async (_req, res) => {
  try {
    const r = await db.execute("SELECT id, title, body, created_at FROM announcements ORDER BY created_at DESC LIMIT 100");
    res.json({ announcements: r.rows });
  } catch {
    res.status(500).json({ error: "お知らせを読み込めませんでした。" });
  }
});

admin.post("/admin/announcements", ...requireAdmin, async (req, res) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "入力を確認してください。" });
  try {
    const id = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO announcements(id, title, body, created_by, created_at) VALUES(?,?,?,?,?)",
      args: [id, parsed.data.title, parsed.data.body, req.user!.id, new Date().toISOString()]
    });
    await audit(req.user!.id, "create_announcement", id, parsed.data.title);
    res.status(201).json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "お知らせを配信できませんでした。" });
  }
});

admin.delete("/admin/announcements/:id", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  try {
    const r = await db.execute({ sql: "DELETE FROM announcements WHERE id = ?", args: [id] });
    if (!r.rowsAffected) return res.status(404).json({ error: "お知らせが見つかりません。" });
    await audit(req.user!.id, "delete_announcement", id, null);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "お知らせを削除できませんでした。" });
  }
});

// Signed-in users read the latest announcements (shown as banners in the app).
admin.get("/announcements", requireAuth, async (_req, res) => {
  try {
    const r = await db.execute("SELECT id, title, body, created_at FROM announcements ORDER BY created_at DESC LIMIT 10");
    res.json({ announcements: r.rows });
  } catch {
    res.status(500).json({ error: "お知らせを読み込めませんでした。" });
  }
});

// ---- Direct messages (read-only, every conversation) ----

admin.get("/admin/dm/conversations", ...requireAdmin, async (req, res) => {
  const userId = queryText(req.query.userId, 200);
  try {
    let scope: string[] | null = null;
    if (userId) {
      const mine = await sb.from("dm_members").select("conversation_id").eq("user_id", userId);
      if (mine.error) throw mine.error;
      const ids: string[] = (mine.data ?? []).map((r: { conversation_id: string }) => r.conversation_id);
      if (!ids.length) return res.json({ conversations: [] });
      scope = ids;
    }
    const base = sb.from("dm_conversations")
      .select("id, is_group, title, last_message_at, last_preview, last_sender_id")
      .order("last_message_at", { ascending: false })
      .limit(100);
    const convs = await (scope ? base.in("id", scope) : base);
    if (convs.error) throw convs.error;
    const rows: { id: string; is_group: boolean; title: string | null; last_message_at: string; last_preview: string | null; last_sender_id: string | null }[] = convs.data ?? [];
    if (!rows.length) return res.json({ conversations: [] });

    const members = await sb.from("dm_members").select("conversation_id, user_id, role").in("conversation_id", rows.map(r => r.id));
    if (members.error) throw members.error;
    const memberRows: { conversation_id: string; user_id: string; role: string }[] = members.data ?? [];
    const people = await peopleFor([...memberRows.map(m => m.user_id), ...rows.map(r => r.last_sender_id ?? "")]);

    res.json({
      conversations: rows.map(c => ({
        id: c.id,
        is_group: c.is_group,
        title: c.title,
        last_message_at: c.last_message_at,
        last_preview: c.last_preview,
        last_sender_name: c.last_sender_id ? (people.get(c.last_sender_id)?.display_name ?? null) : null,
        members: memberRows
          .filter(m => m.conversation_id === c.id)
          .map(m => ({ ...(people.get(m.user_id) ?? unknownPerson(m.user_id)), role: m.role }))
      }))
    });
  } catch {
    res.status(500).json({ error: "DMを読み込めませんでした。" });
  }
});

admin.get("/admin/dm/conversations/:id", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: "会話が見つかりません。" });
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : "";
  try {
    const [conv, members] = await Promise.all([
      sb.from("dm_conversations").select("id, is_group, title, description").eq("id", id).maybeSingle(),
      sb.from("dm_members").select("user_id, role, joined_at").eq("conversation_id", id)
    ]);
    if (conv.error) throw conv.error;
    if (members.error) throw members.error;
    if (!conv.data) return res.status(404).json({ error: "会話が見つかりません。" });

    const base = sb.from("dm_messages").select("id, sender_id, created_at, kind, body, image_path").eq("conversation_id", id);
    const msgs = await (before ? base.lt("created_at", before) : base).order("created_at", { ascending: false }).limit(DM_PAGE_SIZE + 1);
    if (msgs.error) throw msgs.error;
    const rows: { id: string; sender_id: string; created_at: string; kind: string | null; body: string | null }[] = msgs.data ?? [];
    const memberRows: { user_id: string; role: string }[] = members.data ?? [];
    const people = await peopleFor([...memberRows.map(m => m.user_id), ...rows.map(r => r.sender_id)]);

    // Each page view is recorded, so the owner can see who read which conversation.
    await audit(req.user!.id, "view_dm", id, before ? "過去のメッセージを表示" : "最新のメッセージを表示");

    res.json({
      conversation: {
        id: conv.data.id,
        is_group: conv.data.is_group,
        title: conv.data.title,
        description: conv.data.description ?? null,
        members: memberRows.map(m => ({ ...(people.get(m.user_id) ?? unknownPerson(m.user_id)), role: m.role }))
      },
      messages: rows.slice(0, DM_PAGE_SIZE).reverse().map(m => ({
        id: m.id,
        sender_id: m.sender_id,
        sender_name: (people.get(m.sender_id) ?? unknownPerson(m.sender_id)).display_name,
        created_at: m.created_at,
        kind: m.kind === "text" ? "text" : "image",
        body: m.kind === "text" ? m.body : null,
        image_url: m.kind === "text" ? null : `/api/admin/dm/messages/${m.id}/image`
      })),
      hasMore: rows.length > DM_PAGE_SIZE
    });
  } catch {
    res.status(500).json({ error: "DMを読み込めませんでした。" });
  }
});

admin.get("/admin/dm/messages/:id/image", ...requireAdmin, async (req, res) => {
  const id = pick(req.params.id);
  if (!isUuid(id)) return res.status(404).end();
  try {
    const found = await sb.from("dm_messages").select("image_path").eq("id", id).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data?.image_path) return res.status(404).end();
    const signed = await sb.storage.from(BUCKET).createSignedUrl(String(found.data.image_path), 300);
    if (signed.error || !signed.data) throw signed.error ?? new Error("署名付きURLを作成できませんでした。");
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(signed.data.signedUrl);
  } catch {
    res.status(500).end();
  }
});

// ---- Audit log ----

admin.get("/admin/audit", ...requireAdmin, async (_req, res) => {
  try {
    const r = await db.execute(`SELECT a.id, a.action, a.target, a.detail, a.created_at, u.display_name AS admin_name
                                FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id
                                ORDER BY a.created_at DESC LIMIT 200`);
    res.json({ entries: r.rows });
  } catch {
    res.status(500).json({ error: "操作ログを読み込めませんでした。" });
  }
});
