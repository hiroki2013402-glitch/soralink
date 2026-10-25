import crypto from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { db } from "./db.js";
import { mintRealtimeToken, sb, supabaseAnonKey, supabaseUrl } from "./supabase.js";

// Direct messages. Conversations, members and messages live in Supabase; the user directory stays in Turso.
export const dm = Router();

const BUCKET = "dm-images";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CONVERSATION_MEMBERS = 20;
const PAGE_SIZE = 50;
const IMAGE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, IMAGE_EXTENSIONS.has(file.mimetype))
});

const uploadImage = (req: Request, res: Response, next: () => void) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "画像は10MB以下にしてください。" });
      return;
    }
    res.status(400).json({ error: "画像をアップロードできませんでした。" });
  });
};

const createSchema = z.object({
  userIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_CONVERSATION_MEMBERS - 1),
  title: z.string().trim().max(60).optional().default("")
});

type Person = { id: string; display_name: string; avatar_url: string | null };

const param = (req: Request, name: string) => {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
};
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
const imageUrlFor = (messageId: string) => `/api/dm/messages/${messageId}/image`;
const unknownPerson = (id: string): Person => ({ id, display_name: "退会したユーザー", avatar_url: null });

// Checks the file's leading bytes so a renamed non-image cannot be stored as an image.
function hasImageSignature(buffer: Buffer, mime: string) {
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/gif") {
    const head = buffer.subarray(0, 6).toString("ascii");
    return head === "GIF87a" || head === "GIF89a";
  }
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

async function isMember(conversationId: string, userId: string) {
  if (!isUuid(conversationId)) return false;
  const { data, error } = await sb.from("dm_members").select("conversation_id")
    .eq("conversation_id", conversationId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// Names and avatars are read from Turso, where the user directory lives.
async function peopleById(ids: string[]) {
  const unique = [...new Set(ids)];
  const people = new Map<string, Person>();
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

// A 1:1 conversation is reused instead of creating a duplicate.
async function findDirectConversation(a: string, b: string) {
  const [mine, theirs] = await Promise.all([
    sb.from("dm_members").select("conversation_id").eq("user_id", a),
    sb.from("dm_members").select("conversation_id").eq("user_id", b)
  ]);
  if (mine.error) throw mine.error;
  if (theirs.error) throw theirs.error;
  const theirIds = new Set<string>((theirs.data ?? []).map((r: { conversation_id: string }) => r.conversation_id));
  const shared: string[] = (mine.data ?? [])
    .map((r: { conversation_id: string }) => r.conversation_id)
    .filter((id: string) => theirIds.has(id));
  if (!shared.length) return null;
  const direct = await sb.from("dm_conversations").select("id").in("id", shared).eq("is_group", false);
  if (direct.error) throw direct.error;
  for (const row of direct.data ?? []) {
    const count = await sb.from("dm_members").select("user_id", { count: "exact", head: true }).eq("conversation_id", row.id);
    if (count.count === 2) return String(row.id);
  }
  return null;
}

// Short-lived token for the browser's Supabase Realtime connection.
dm.get("/dm/realtime-token", requireAuth, (req, res) => {
  res.json({ url: supabaseUrl, anonKey: supabaseAnonKey, token: mintRealtimeToken(req.user!.id), expiresIn: 3600 });
});

// Unread message counts: total for the nav badge, and per conversation for the list.
dm.get("/dm/unread", requireAuth, async (req, res) => {
  try {
    const { data, error } = await sb.rpc("dm_unread_counts", { uid: req.user!.id });
    if (error) throw error;
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of data ?? []) {
      const n = Number(row.unread_count) || 0;
      counts[String(row.conv_id)] = n;
      total += n;
    }
    res.json({ total, counts });
  } catch {
    res.status(500).json({ error: "未読数を読み込めませんでした。" });
  }
});

dm.get("/dm/conversations", requireAuth, async (req, res) => {
  try {
    const me = req.user!.id;
    const mine = await sb.from("dm_members").select("conversation_id").eq("user_id", me);
    if (mine.error) throw mine.error;
    const ids: string[] = (mine.data ?? []).map((r: { conversation_id: string }) => r.conversation_id);
    if (!ids.length) return res.json({ conversations: [] });

    const [convs, members] = await Promise.all([
      sb.from("dm_conversations").select("id, is_group, title, last_message_at").in("id", ids).order("last_message_at", { ascending: false }),
      sb.from("dm_members").select("conversation_id, user_id").in("conversation_id", ids)
    ]);
    if (convs.error) throw convs.error;
    if (members.error) throw members.error;

    const people = await peopleById((members.data ?? []).map((m: { user_id: string }) => m.user_id));
    const membersByConversation = new Map<string, string[]>();
    for (const m of members.data ?? []) {
      const list = membersByConversation.get(m.conversation_id) ?? [];
      list.push(m.user_id);
      membersByConversation.set(m.conversation_id, list);
    }

    res.json({
      conversations: (convs.data ?? []).map((c: { id: string; is_group: boolean; title: string | null; last_message_at: string }) => ({
        id: c.id,
        is_group: c.is_group,
        title: c.title,
        last_message_at: c.last_message_at,
        members: (membersByConversation.get(c.id) ?? []).map(uid => people.get(uid) ?? unknownPerson(uid))
      }))
    });
  } catch {
    res.status(500).json({ error: "会話を読み込めませんでした。" });
  }
});

// One user creates a 1:1 chat; two or more create a group chat.
dm.post("/dm/conversations", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "入力を確認してください。" });
  const me = req.user!.id;
  const others = [...new Set(parsed.data.userIds)].filter(id => id !== me);
  if (!others.length) return res.status(400).json({ error: "相手を選択してください。" });

  try {
    const found = await peopleById(others);
    if (found.size !== others.length) return res.status(404).json({ error: "ユーザーが見つかりません。" });

    if (others.length === 1) {
      const existingId = await findDirectConversation(me, others[0]);
      if (existingId) return res.json({ id: existingId });
    }

    const isGroup = others.length > 1;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = isGroup && parsed.data.title ? parsed.data.title : null;
    const created = await sb.from("dm_conversations").insert({ id, is_group: isGroup, title, created_by: me, created_at: now, last_message_at: now });
    if (created.error) throw created.error;

    const memberRows = [me, ...others].map(userId => ({ conversation_id: id, user_id: userId, last_read_at: now, joined_at: now }));
    const members = await sb.from("dm_members").insert(memberRows);
    if (members.error) {
      await sb.from("dm_conversations").delete().eq("id", id);
      throw members.error;
    }
    res.status(201).json({ id });
  } catch {
    res.status(500).json({ error: "会話を作成できませんでした。" });
  }
});

// Latest messages first page; pass ?before=<created_at> to load older ones.
dm.get("/dm/conversations/:id", requireAuth, async (req, res) => {
  const id = param(req, "id");
  try {
    if (!(await isMember(id, req.user!.id))) return res.status(404).json({ error: "会話が見つかりません。" });

    const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : "";
    let messageQuery = sb.from("dm_messages").select("id, sender_id, created_at").eq("conversation_id", id);
    if (before) messageQuery = messageQuery.lt("created_at", before);

    const [conversation, members, messages] = await Promise.all([
      sb.from("dm_conversations").select("id, is_group, title").eq("id", id).single(),
      sb.from("dm_members").select("user_id").eq("conversation_id", id),
      messageQuery.order("created_at", { ascending: false }).limit(PAGE_SIZE + 1)
    ]);
    if (conversation.error) throw conversation.error;
    if (members.error) throw members.error;
    if (messages.error) throw messages.error;

    const memberIds: string[] = (members.data ?? []).map((m: { user_id: string }) => m.user_id);
    const people = await peopleById(memberIds);
    const rows: { id: string; sender_id: string; created_at: string }[] = messages.data ?? [];

    res.json({
      conversation: {
        id: conversation.data.id,
        is_group: conversation.data.is_group,
        title: conversation.data.title,
        members: memberIds.map(uid => people.get(uid) ?? unknownPerson(uid))
      },
      messages: rows.slice(0, PAGE_SIZE).reverse().map(m => ({
        id: m.id,
        sender_id: m.sender_id,
        created_at: m.created_at,
        image_url: imageUrlFor(m.id)
      })),
      hasMore: rows.length > PAGE_SIZE
    });
  } catch {
    res.status(500).json({ error: "会話を読み込めませんでした。" });
  }
});

// Image-only messages. The bytes go to a private Supabase Storage bucket; the row stores the path.
dm.post("/dm/conversations/:id/messages", requireAuth, uploadImage, async (req, res) => {
  const me = req.user!.id;
  const conversationId = param(req, "id");
  const file = req.file;
  try {
    if (!(await isMember(conversationId, me))) return res.status(404).json({ error: "会話が見つかりません。" });
    if (!file) return res.status(400).json({ error: "画像を選択してください。" });
    if (!hasImageSignature(file.buffer, file.mimetype)) return res.status(400).json({ error: "画像の内容と形式が一致しません。" });

    const messageId = crypto.randomUUID();
    const path = `${conversationId}/${messageId}.${IMAGE_EXTENSIONS.get(file.mimetype)}`;
    const uploaded = await sb.storage.from(BUCKET).upload(path, new Uint8Array(file.buffer), { contentType: file.mimetype, upsert: false });
    if (uploaded.error) throw uploaded.error;

    const now = new Date().toISOString();
    const inserted = await sb.from("dm_messages").insert({
      id: messageId,
      conversation_id: conversationId,
      sender_id: me,
      image_path: path,
      mime_type: file.mimetype,
      created_at: now
    });
    if (inserted.error) {
      await sb.storage.from(BUCKET).remove([path]);
      throw inserted.error;
    }
    await sb.from("dm_conversations").update({ last_message_at: now }).eq("id", conversationId);

    res.status(201).json({ message: { id: messageId, sender_id: me, created_at: now, image_url: imageUrlFor(messageId) } });
  } catch {
    res.status(500).json({ error: "画像を送信できませんでした。" });
  }
});

// Members only. Issues a 5-minute signed URL and redirects to it.
dm.get("/dm/messages/:id/image", requireAuth, async (req, res) => {
  const messageId = param(req, "id");
  try {
    if (!isUuid(messageId)) return res.status(404).end();
    const found = await sb.from("dm_messages").select("conversation_id, image_path").eq("id", messageId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data || !(await isMember(String(found.data.conversation_id), req.user!.id))) return res.status(404).end();

    const signed = await sb.storage.from(BUCKET).createSignedUrl(String(found.data.image_path), 300);
    if (signed.error || !signed.data) throw signed.error ?? new Error("署名付きURLを作成できませんでした。");
    res.setHeader("Cache-Control", "private, max-age=240");
    res.redirect(signed.data.signedUrl);
  } catch {
    res.status(500).end();
  }
});

dm.post("/dm/conversations/:id/read", requireAuth, async (req, res) => {
  const me = req.user!.id;
  const id = param(req, "id");
  try {
    if (!(await isMember(id, me))) return res.status(404).json({ error: "会話が見つかりません。" });
    const updated = await sb.from("dm_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", id).eq("user_id", me);
    if (updated.error) throw updated.error;
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "既読にできませんでした。" });
  }
});

// Leaving a group. The conversation is removed once its last member leaves.
dm.post("/dm/conversations/:id/leave", requireAuth, async (req, res) => {
  const me = req.user!.id;
  const id = param(req, "id");
  try {
    if (!(await isMember(id, me))) return res.status(404).json({ error: "会話が見つかりません。" });
    const conversation = await sb.from("dm_conversations").select("is_group").eq("id", id).single();
    if (conversation.error) throw conversation.error;
    if (!conversation.data.is_group) return res.status(400).json({ error: "個人チャットは退出できません。" });

    const removed = await sb.from("dm_members").delete().eq("conversation_id", id).eq("user_id", me);
    if (removed.error) throw removed.error;
    const remaining = await sb.from("dm_members").select("user_id", { count: "exact", head: true }).eq("conversation_id", id);
    if (remaining.error) throw remaining.error;
    if (!remaining.count) await sb.from("dm_conversations").delete().eq("id", id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "退出できませんでした。" });
  }
});
