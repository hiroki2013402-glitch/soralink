import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import multer from "multer";
import { db } from "./db.js";
import { requireAuth } from "./auth.js";
import { settingsFor } from "./settings.js";
import { canSeePost, resolveViewer, VISIBILITIES, VISIBLE_TO_SQL, visibleArgs } from "./visibility.js";
import { deleteVideoForPost, mediaUrlForVideo } from "./videos.js";
import { extractHashtags, extractMentionNames } from "./richText.js";
import { attachPostExtras, postCleanupStatements } from "./postExtras.js";

export const api = Router();
const routeId = (value: string | string[] | undefined): string | undefined => typeof value === "string" ? value : undefined;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 }, fileFilter: (_req, file, cb) => { const ok = ["image/jpeg","image/png","image/webp","image/gif"].includes(file.mimetype); if (ok) cb(null, true); else cb(new Error("JPG、PNG、WebP、GIF形式の画像を選択してください。")); } });
// Images only. Videos go to Cloudflare R2 through /api/media/video/* (see videos.ts).
api.post("/media/upload", requireAuth, (req, res, next) => upload.single("file")(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "ファイルは20MB以下にしてください。" });
  return res.status(400).json({ error: err instanceof multer.MulterError ? "ファイルをアップロードできませんでした。" : err instanceof Error ? err.message : "ファイルをアップロードできませんでした。" });
}), async (req, res) => {
  const file = req.file; if (!file) return res.status(400).json({ error: "画像または動画を選択してください。" });
  const b = file.buffer; const starts = (...bytes:number[]) => bytes.every((v,i)=>b[i]===v);
  const signatureOk = file.mimetype === "image/jpeg" ? starts(0xff,0xd8,0xff) : file.mimetype === "image/png" ? starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a) : file.mimetype === "image/gif" ? (b.subarray(0,6).toString("ascii")==="GIF87a"||b.subarray(0,6).toString("ascii")==="GIF89a") : file.mimetype === "image/webp" ? (b.subarray(0,4).toString("ascii")==="RIFF"&&b.subarray(8,12).toString("ascii")==="WEBP") : false;
  if (!signatureOk) return res.status(400).json({ error: "ファイルの内容と形式が一致しません。対応形式の画像を選択してください。" });
  if (file.size > MAX_FILE_BYTES) return res.status(413).json({ error: "ファイルは20MB以下にしてください。" });
  // An optional smaller copy (uploaded first by the same user) that the feed shows instead of the full image.
  const thumbRaw = typeof req.body?.thumbId === "string" ? req.body.thumbId : "";
  if (thumbRaw && !/^[0-9a-f-]{36}$/i.test(thumbRaw)) return res.status(400).json({ error: "サムネイルの指定が不正です。" });
  if (thumbRaw) {
    const own = await db.execute({ sql: "SELECT id FROM media_assets WHERE id=? AND user_id=? AND mime_type LIKE 'image/%'", args: [thumbRaw, req.user!.id] });
    if (!own.rows.length) return res.status(403).json({ error: "自分がアップロードした画像のみ指定できます。" });
  }
  try { const id = crypto.randomUUID(); await db.execute({ sql: "INSERT INTO media_assets(id,user_id,mime_type,file_name,size_bytes,created_at,thumb_id) VALUES(?,?,?,?,?,?,?)", args: [id, req.user!.id, file.mimetype, file.originalname.slice(0, 180), file.size, new Date().toISOString(), thumbRaw || null] }); const chunkSize = 256 * 1024; const statements = []; for (let offset = 0, index = 0; offset < file.buffer.length; offset += chunkSize, index++) statements.push({ sql: "INSERT INTO media_chunks(media_id,chunk_index,data) VALUES(?,?,?)", args: [id, index, new Uint8Array(file.buffer.subarray(offset, Math.min(offset + chunkSize, file.buffer.length)))] }); if (statements.length) await db.batch(statements, "write"); res.status(201).json({ id, url: `/api/media/${id}`, mimeType: file.mimetype, size: file.size }); } catch { res.status(500).json({ error: "メディアをTursoに保存できませんでした。データベースの容量・プランを確認してください。" }); }
});

// Media that belongs to a post follows that post's visibility. Avatars, covers and unattached files stay public.
// ?size=thumb serves the smaller copy in thumb_id when there is one. Bytes are cached in memory after the
// visibility check, because one stored file is many Turso rows and the same image is requested again and again.
const MEDIA_CACHE_LIMIT = 96 * 1024 * 1024;
const mediaCache = new Map<string, { mime: string; body: Buffer }>();
let mediaCacheBytes = 0;

function readMediaCache(id: string) {
  const hit = mediaCache.get(id);
  if (hit) { mediaCache.delete(id); mediaCache.set(id, hit); }
  return hit;
}

function writeMediaCache(id: string, value: { mime: string; body: Buffer }) {
  if (value.body.length > MEDIA_CACHE_LIMIT / 4) return;
  const old = mediaCache.get(id);
  if (old) { mediaCacheBytes -= old.body.length; mediaCache.delete(id); }
  mediaCache.set(id, value);
  mediaCacheBytes += value.body.length;
  while (mediaCacheBytes > MEDIA_CACHE_LIMIT) {
    const oldest = mediaCache.keys().next().value;
    if (oldest === undefined) break;
    mediaCacheBytes -= mediaCache.get(oldest)?.body.length ?? 0;
    mediaCache.delete(oldest);
  }
}

// Metadata per media id: type, thumbnail, and the post it is attached to. Kept for a minute, so a visibility change
// still takes effect quickly, while a busy feed does not repeat two lookups for every picture.
const META_TTL_MS = 60_000;
const META_CACHE_MAX = 5000;
type MediaMeta = { thumbId: string | null; post: { user_id: string; visibility: string } | null; at: number };
const metaCache = new Map<string, MediaMeta>();

async function mediaMeta(id: string): Promise<MediaMeta | null> {
  const hit = metaCache.get(id);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit;
  const r = await db.execute({ sql: "SELECT thumb_id FROM media_assets WHERE id=?", args: [id] });
  if (!r.rows.length) return null;
  // Attached when a post uses this file, or when this file is the thumbnail of a post's file.
  const attached = await db.execute({
    sql: `SELECT p.user_id, p.visibility FROM posts p
          WHERE p.media_url = ? OR p.media_url IN (SELECT '/api/media/' || a.id FROM media_assets a WHERE a.thumb_id = ?)
          LIMIT 1`,
    args: [`/api/media/${id}`, id]
  });
  const meta: MediaMeta = {
    thumbId: r.rows[0].thumb_id ? String(r.rows[0].thumb_id) : null,
    post: attached.rows.length ? { user_id: String(attached.rows[0].user_id), visibility: String(attached.rows[0].visibility) } : null,
    at: Date.now()
  };
  if (metaCache.size >= META_CACHE_MAX) metaCache.delete(metaCache.keys().next().value as string);
  metaCache.set(id, meta);
  return meta;
}

// Concurrent requests for the same uncached picture share one database read instead of each reading every chunk.
const bodyLoads = new Map<string, Promise<{ mime: string; body: Buffer } | null>>();

function loadMedia(servedId: string): Promise<{ mime: string; body: Buffer } | null> {
  const cached = readMediaCache(servedId);
  if (cached) return Promise.resolve(cached);
  const running = bodyLoads.get(servedId);
  if (running) return running;
  const load = (async () => {
    const meta = await db.execute({ sql: "SELECT mime_type FROM media_assets WHERE id=?", args: [servedId] });
    if (!meta.rows.length) return null;
    const chunks = await db.execute({ sql: "SELECT data FROM media_chunks WHERE media_id=? ORDER BY chunk_index", args: [servedId] });
    const body = Buffer.concat(chunks.rows.map(({ data }) => {
      if (!(data instanceof ArrayBuffer)) throw new TypeError("Stored media chunk is not binary data.");
      return Buffer.from(data);
    }));
    const value = { mime: String(meta.rows[0].mime_type), body };
    writeMediaCache(servedId, value);
    return value;
  })().finally(() => bodyLoads.delete(servedId));
  bodyLoads.set(servedId, load);
  return load;
}

api.get("/media/:id", async (req, res) => {
  try {
    const id = routeId(req.params.id) || "";
    const meta = await mediaMeta(id);
    if (!meta) return res.status(404).end();
    // Public posts need no viewer lookup. Restricted ones are checked for every request.
    if (meta.post && meta.post.visibility !== "public" && !(await canSeePost(await resolveViewer(req), meta.post.user_id, meta.post.visibility))) return res.status(404).end();
    const restricted = Boolean(meta.post && meta.post.visibility !== "public");

    const servedId = req.query.size === "thumb" && meta.thumbId ? meta.thumbId : id;
    const etag = `"${servedId}"`;
    res.setHeader("Cache-Control", restricted ? "private, max-age=3600" : "public, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) return res.status(304).end();

    const media = await loadMedia(servedId);
    if (!media) return res.status(404).end();
    res.setHeader("Content-Type", media.mime);
    res.setHeader("Content-Length", String(media.body.length));
    res.end(media.body);
  } catch { res.status(500).end(); }
});

const mediaUrl = z.string().url().max(2048).refine((s) => { try { return new URL(s).protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(new URL(s).hostname) && !new URL(s).hostname.endsWith(".local") && !new URL(s).hostname.endsWith(".internal") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(new URL(s).hostname) && !new URL(s).hostname.includes("@"); } catch { return false; } }, "HTTPSのメディアURLを入力してください。");
const storedMedia = z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i, "アップロード済みのメディアを指定してください。");
const visibilitySchema = z.enum(VISIBILITIES, { errorMap: () => ({ message: "公開範囲の指定が不正です。" }) });
// A post needs text, media, or both. Media is optional so text-only posts work.
// Images reference a Turso upload (mediaUrl); videos reference an R2 upload (videoId). The server sets the video URL.
// A poll is text-only: the caption is the question and each option is one short line.
const pollSchema = z.object({
  options: z.array(z.string().trim().min(1, "選択肢を入力してください。").max(60, "選択肢は60文字以内で入力してください。")).min(2, "選択肢は2つ以上入力してください。").max(4, "選択肢は4つまでです。")
});
const postSchema = z.object({
  mediaType: z.enum(["image", "video"]).nullish(),
  mediaUrl: storedMedia.nullish(),
  videoId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "アップロード済みの動画を指定してください。").nullish(),
  caption: z.string().trim().max(500).default(""),
  visibility: visibilitySchema.default("public"),
  poll: pollSchema.nullish()
}).superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.mediaType === "image" && (!value.mediaUrl || value.videoId)) issue("メディアの指定が不正です。");
  if (value.mediaType === "video" && (!value.videoId || value.mediaUrl)) issue("メディアの指定が不正です。");
  if (!value.mediaType && (value.mediaUrl || value.videoId)) issue("メディアの指定が不正です。");
  if (!value.mediaType && !value.caption) issue("テキストか画像・動画を入力してください。");
  if (value.poll) {
    if (value.mediaType) issue("投票は写真や動画と一緒には投稿できません。");
    if (!value.caption) issue("投票には質問文を入力してください。");
    const labels = value.poll.options.map(o => o.toLowerCase());
    if (new Set(labels).size !== labels.length) issue("同じ選択肢があります。");
  }
});
const commentSchema = z.object({ body: z.string().trim().min(1, "コメントを入力してください。").max(500, "コメントは500文字以内で入力してください。") });
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(80), bio: z.string().max(300).default(""), website: z.string().max(2048).optional().default(""), avatarUrl: z.union([z.literal(""), mediaUrl, storedMedia]).optional().default(""), coverUrl: z.union([z.literal(""), mediaUrl, storedMedia]).optional().default("") });
const friendSchema = z.object({ userId: z.string().min(1).max(200) });

// LIKE pattern escaping so user input cannot act as wildcards.
const likeEscape = (value: string) => value.replace(/[\\%_]/g, c => `\\${c}`);
const searchText = (value: unknown) => String(value ?? "").trim().slice(0, 50);

// Shared post projection. `?` is the viewer's user id, used for the `liked` flag.
const postSelect = `SELECT p.id,p.user_id,p.media_type,p.media_url,p.caption,p.visibility,p.created_at,u.display_name,u.avatar_url,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) likes_count,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comments_count,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) liked
  FROM posts p JOIN users u ON u.id=p.user_id`;

// True when the post exists and the viewer may see it.
async function visiblePost(viewer: string, id: string) {
  const r = await db.execute({ sql: `SELECT p.id FROM posts p WHERE p.id=? AND ${VISIBLE_TO_SQL}`, args: [id, ...visibleArgs(viewer)] });
  return r.rows.length > 0;
}

api.get("/me", requireAuth, async (req, res) => {
  const r = await db.execute({sql:"SELECT id, display_name, email, avatar_url, cover_url, bio, website, created_at FROM users WHERE id = ?", args:[req.user!.id]});
  res.json({ user: r.rows[0] ?? req.user });
});

// Feed: guests see public posts only; signed-in users also see what they are allowed to see.
api.get("/feed", async (req, res) => {
  try {
    const viewer = await resolveViewer(req);
    const r = await db.execute({ sql: `SELECT p.id,p.user_id,p.media_type,p.media_url,p.caption,p.visibility,p.created_at,u.display_name,u.avatar_url,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) likes_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comments_count
      FROM posts p JOIN users u ON u.id=p.user_id WHERE ${VISIBLE_TO_SQL} ORDER BY p.created_at DESC LIMIT 80`, args: visibleArgs(viewer) });
    res.json({posts: await attachPostExtras(r.rows, viewer)});
  } catch { res.status(500).json({error:"タイムラインを読み込めませんでした。"}); }
});

api.get("/likes/mine", requireAuth, async(req,res)=>{ try { const r=await db.execute({sql:"SELECT post_id FROM likes WHERE user_id=?",args:[req.user!.id]}); res.json({ids:r.rows.map(x=>String(x.post_id))}); } catch { res.status(500).json({error:"いいね状態を読み込めませんでした。"}); } });

api.post("/posts", requireAuth, async (req,res) => {
  const p=postSchema.safeParse(req.body); if(!p.success) return res.status(400).json({error:p.error.issues[0]?.message||"入力を確認してください。"});
  let mediaUrl: string | null = p.data.mediaUrl ?? null;
  if (p.data.mediaType === "image" && mediaUrl) { const owned=await db.execute({sql:"SELECT id FROM media_assets WHERE id=? AND user_id=?",args:[mediaUrl.slice("/api/media/".length),req.user!.id]}); if(!owned.rows.length)return res.status(403).json({error:"自分がアップロードしたメディアのみ投稿できます。"}); }
  if (p.data.mediaType === "video") {
    let resolved: Awaited<ReturnType<typeof mediaUrlForVideo>>;
    try { resolved = await mediaUrlForVideo(req.user!.id, p.data.videoId!, p.data.visibility); } catch { return res.status(500).json({error:"動画を確認できませんでした。"}); }
    if (!resolved) return res.status(403).json({error:"自分がアップロードし、処理が完了した動画のみ投稿できます。"});
    if ("error" in resolved) return res.status(400).json({error: resolved.error});
    mediaUrl = resolved.url;
  }
  try { const id=crypto.randomUUID(), created=new Date().toISOString();
    const statements: { sql: string; args: string[] | (string | null)[] }[] = [
      {sql:"INSERT INTO posts(id,user_id,media_type,media_url,caption,visibility,created_at) VALUES(?,?,?,?,?,?,?)",args:[id,req.user!.id,p.data.mediaType??null,mediaUrl,p.data.caption,p.data.visibility,created]}
    ];
    // A mention links only when the name matches an existing display name. Other "@words" stay plain text.
    for (const name of extractMentionNames(p.data.caption)) {
      const found = await db.execute({ sql: "SELECT id, display_name FROM users WHERE display_name = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1", args: [name] });
      if (found.rows.length) statements.push({ sql: "INSERT OR IGNORE INTO post_mentions(post_id,user_id,name) VALUES(?,?,?)", args: [id, String(found.rows[0].id), String(found.rows[0].display_name)] });
    }
    for (const tag of extractHashtags(p.data.caption)) {
      statements.push({ sql: "INSERT OR IGNORE INTO post_hashtags(post_id,tag) VALUES(?,?)", args: [id, tag] });
    }
    (p.data.poll?.options ?? []).forEach((label, position) => {
      statements.push({ sql: "INSERT INTO poll_options(id,post_id,label,position) VALUES(?,?,?,?)", args: [crypto.randomUUID(), id, label, String(position)] });
    });
    await db.batch(statements, "write");
    res.status(201).json({ok:true,id});
  } catch { res.status(500).json({error:"保存できませんでした。データベース設定を確認してください。"}); }
});

api.get("/posts/:id", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  try {
    const r=await db.execute({sql:`${postSelect} WHERE p.id=? AND ${VISIBLE_TO_SQL}`,args:[req.user!.id,id,...visibleArgs(req.user!.id)]});
    if(!r.rows.length) return res.status(404).json({error:"投稿が見つかりません。"});
    const [post] = await attachPostExtras(r.rows, req.user!.id);
    res.json({post});
  } catch { res.status(500).json({error:"投稿を読み込めませんでした。"}); }
});

api.get("/posts/:id/comments", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  try {
    if (!(await visiblePost(req.user!.id, id))) return res.status(404).json({error:"投稿が見つかりません。"});
    const r=await db.execute({sql:"SELECT c.id,c.user_id,c.body,c.created_at,u.display_name,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at ASC LIMIT 200",args:[id]});
    res.json({comments:r.rows});
  } catch { res.status(500).json({error:"コメントを読み込めませんでした。"}); }
});

api.post("/posts/:id/comments", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  const c=commentSchema.safeParse(req.body); if(!c.success) return res.status(400).json({error:c.error.issues[0]?.message||"入力を確認してください。"});
  try {
    if (!(await visiblePost(req.user!.id, id))) return res.status(404).json({error:"投稿が見つかりません。"});
    const commentId=crypto.randomUUID(), created=new Date().toISOString();
    await db.execute({sql:"INSERT INTO comments(id,post_id,user_id,body,created_at) VALUES(?,?,?,?,?)",args:[commentId,id,req.user!.id,c.data.body,created]});
    const me=await db.execute({sql:"SELECT display_name,avatar_url FROM users WHERE id=?",args:[req.user!.id]});
    res.status(201).json({comment:{id:commentId,user_id:req.user!.id,body:c.data.body,created_at:created,display_name:me.rows[0]?.display_name??"",avatar_url:me.rows[0]?.avatar_url??null}});
  } catch { res.status(500).json({error:"コメントを投稿できませんでした。"}); }
});

api.delete("/comments/:id", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"コメントIDが不正です。"});
  const r=await db.execute({sql:"DELETE FROM comments WHERE id=? AND user_id=?",args:[id,req.user!.id]});
  if(!r.rowsAffected)return res.status(404).json({error:"コメントが見つからないか、削除権限がありません。"});
  res.json({ok:true});
});

const saveProfileHandler = async (req: Request, res: Response) => {
  // Validate the complete profile payload before writing anything.
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    console.warn("[profile] validation failed", {
      userId: req.user!.id,
      field: issue?.path.join("."),
      code: issue?.code
    });
    return res.status(400).json({
      error: issue?.message || "入力内容を確認してください。",
      code: "PROFILE_VALIDATION_FAILED"
    });
  }

  const profile = parsed.data;
  const userId = req.user!.id;

  try {
    // Only allow this user to select media they uploaded.
    for (const [field, value] of [
      ["avatarUrl", profile.avatarUrl],
      ["coverUrl", profile.coverUrl]
    ] as const) {
      if (!value.startsWith("/api/media/")) continue;

      const mediaId = value.slice("/api/media/".length);
      const owned = await db.execute({
        sql: "SELECT id FROM media_assets WHERE id = ? AND user_id = ?",
        args: [mediaId, userId]
      });

      if (!owned.rows.length) {
        return res.status(403).json({
          error: "自分がアップロードした画像のみ設定できます。",
          code: "PROFILE_MEDIA_NOT_OWNED",
          field
        });
      }
    }

    const website = profile.website.trim();
    if (website && !/^https:\/\//i.test(website)) {
      return res.status(400).json({
        error: "リンクはhttps://から入力してください。",
        code: "PROFILE_INVALID_WEBSITE",
        field: "website"
      });
    }

    // Update only the authenticated user's row, never a client-supplied user ID.
    const updated = await db.execute({
      sql: "UPDATE users SET display_name = ?, bio = ?, website = ?, avatar_url = ?, cover_url = ? WHERE id = ?",
      args: [
        profile.displayName,
        profile.bio,
        website || null,
        profile.avatarUrl || null,
        profile.coverUrl || null,
        userId
      ]
    });

    // Detect a stale/deleted account rather than returning an undefined user.
    if (updated.rowsAffected === 0) {
      const exists = await db.execute({
        sql: "SELECT id FROM users WHERE id = ?",
        args: [userId]
      });
      if (!exists.rows.length) {
        return res.status(401).json({
          error: "アカウントを確認できません。再ログインしてください。",
          code: "PROFILE_USER_NOT_FOUND"
        });
      }
    }

    const result = await db.execute({
      sql: "SELECT id, display_name, email, avatar_url, cover_url, bio, website, created_at FROM users WHERE id = ?",
      args: [userId]
    });

    if (!result.rows.length) {
      throw new Error("Profile update completed but the user row could not be reloaded");
    }

    return res.json({ user: result.rows[0] });
  } catch (error) {
    // Keep detailed diagnostics on the server; do not expose DB details to clients.
    console.error("[profile] save failed", {
      userId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      error: "プロフィールの保存に失敗しました。時間をおいて再試行してください。",
      code: "PROFILE_SAVE_FAILED"
    });
  }
};

// Keep PATCH for existing clients and add POST for environments that block PATCH.
api.route("/me/profile")
  .patch(requireAuth, saveProfileHandler)
  .post(requireAuth, saveProfileHandler);

api.get("/users/search", requireAuth, async(req,res)=>{
  const q=searchText(req.query.q); if(!q)return res.json({users:[]});
  const r=await db.execute({sql:"SELECT id,display_name,avatar_url,bio FROM users WHERE display_name LIKE ? ESCAPE '\\' AND id<>? LIMIT 30",args:[`%${likeEscape(q)}%`,req.user!.id]});
  res.json({users:r.rows});
});

// Full search: people and posts the viewer can see.
api.get("/search", requireAuth, async (req, res) => {
  const me = req.user!.id;
  const q = searchText(req.query.q);
  if (!q) return res.json({ users: [], posts: [] });
  // "#tag" searches the hashtag index; anything else searches names and caption text.
  const tag = q.startsWith("#") ? q.slice(1).toLowerCase() : null;
  if (tag !== null && !tag) return res.json({ users: [], posts: [] });
  const pattern = `%${likeEscape(q)}%`;
  try {
    const usersQuery = tag !== null ? null : db.execute({ sql: "SELECT id,display_name,avatar_url,bio FROM users WHERE display_name LIKE ? ESCAPE '\\' AND id<>? ORDER BY display_name COLLATE NOCASE LIMIT 30", args: [pattern, me] });
    const postsQuery = tag !== null
      ? db.execute({ sql: `${postSelect} WHERE ${VISIBLE_TO_SQL} AND p.id IN (SELECT post_id FROM post_hashtags WHERE tag = ?) ORDER BY p.created_at DESC LIMIT 30`, args: [me, ...visibleArgs(me), tag] })
      : db.execute({ sql: `${postSelect} WHERE ${VISIBLE_TO_SQL} AND p.caption LIKE ? ESCAPE '\\' ORDER BY p.created_at DESC LIMIT 30`, args: [me, ...visibleArgs(me), pattern] });
    const [users, posts] = await Promise.all([usersQuery, postsQuery]);
    res.json({ users: users?.rows ?? [], posts: await attachPostExtras(posts.rows, me) });
  } catch { res.status(500).json({ error: "検索できませんでした。" }); }
});

// Close friends: the owner picks them from their own followers.
api.get("/me/close-friends", requireAuth, async (req, res) => {
  const me = req.user!.id;
  try {
    const r = await db.execute({ sql: "SELECT u.id,u.display_name,u.avatar_url,u.bio,EXISTS(SELECT 1 FROM close_friends cf WHERE cf.owner_id=? AND cf.friend_id=u.id) is_close FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.followed_id=? ORDER BY u.display_name COLLATE NOCASE ASC LIMIT 500", args: [me, me] });
    res.json({
      followers: r.rows.map(row => ({
        id: String(row.id),
        display_name: String(row.display_name),
        avatar_url: row.avatar_url === null ? null : String(row.avatar_url),
        bio: String(row.bio ?? ""),
        close: Number(row.is_close) === 1
      }))
    });
  } catch { res.status(500).json({ error: "親しい友達を読み込めませんでした。" }); }
});

api.post("/me/close-friends", requireAuth, async (req, res) => {
  const parsed = friendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ユーザーを指定してください。" });
  const me = req.user!.id;
  const friend = parsed.data.userId;
  if (friend === me) return res.status(400).json({ error: "自分自身は追加できません。" });
  try {
    const follower = await db.execute({ sql: "SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?", args: [friend, me] });
    if (!follower.rows.length) return res.status(403).json({ error: "親しい友達はフォロワーの中から選べます。" });
    await db.execute({ sql: "INSERT OR IGNORE INTO close_friends(owner_id,friend_id,created_at) VALUES(?,?,?)", args: [me, friend, new Date().toISOString()] });
    res.status(201).json({ ok: true });
  } catch { res.status(500).json({ error: "親しい友達に追加できませんでした。" }); }
});

api.delete("/me/close-friends/:userId", requireAuth, async (req, res) => {
  const friend = routeId(req.params.userId);
  if (!friend) return res.status(400).json({ error: "ユーザーIDが不正です。" });
  try {
    await db.execute({ sql: "DELETE FROM close_friends WHERE owner_id=? AND friend_id=?", args: [req.user!.id, friend] });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "親しい友達から外せませんでした。" }); }
});

api.get("/users/:id/relations", requireAuth, async(req,res)=>{
  const id = routeId(req.params.id); const type = req.query.type === "following" ? "following" : "followers";
  if (!id) return res.status(400).json({error:"ユーザーIDが不正です。"});
  try { const sql = type === "followers" ? "SELECT u.id,u.display_name,u.avatar_url,u.bio FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.followed_id=? ORDER BY f.created_at DESC LIMIT 200" : "SELECT u.id,u.display_name,u.avatar_url,u.bio FROM follows f JOIN users u ON u.id=f.followed_id WHERE f.follower_id=? ORDER BY f.created_at DESC LIMIT 200"; const r=await db.execute({sql,args:[id]}); res.json({users:r.rows,type}); } catch { res.status(500).json({error:"フォロー関係を読み込めませんでした。"}); }
});

api.get("/users/:id", requireAuth, async(req,res)=>{
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"ユーザーIDが不正です。"});
  try {
    const u=await db.execute({sql:"SELECT id,display_name,avatar_url,cover_url,bio,website,created_at FROM users WHERE id=?",args:[id]});
    if(!u.rows.length)return res.status(404).json({error:"ユーザーが見つかりません。"});
    const me = req.user!.id;
    const [posts,followers,following]=await Promise.all([
      db.execute({sql:`${postSelect} WHERE p.user_id=? AND ${VISIBLE_TO_SQL} ORDER BY p.created_at DESC LIMIT 80`,args:[me,id,...visibleArgs(me)]}),
      db.execute({sql:"SELECT COUNT(*) n FROM follows WHERE followed_id=?",args:[id]}),
      db.execute({sql:"SELECT COUNT(*) n FROM follows WHERE follower_id=?",args:[id]})
    ]);
    const followed=await db.execute({sql:"SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?",args:[me,id]});
    const isFollowing=followed.rows.length>0;
    res.json({user:u.rows[0],posts:await attachPostExtras(posts.rows,me),followers:Number(followers.rows[0]?.n||0),following:Number(following.rows[0]?.n||0),isFollowing});
  } catch {
    res.status(500).json({error:"プロフィールを読み込めませんでした。"});
  }
});

// Likes can be toggled by one person on one post at most once every LIKE_MIN_GAP_MS,
// and at most LIKE_WINDOW_MAX times in LIKE_WINDOW_MS. Requests over the limit are refused before touching the database.
// Kept in process memory, like the other limiters in index.ts.
const LIKE_MIN_GAP_MS = 3_000;
const LIKE_WINDOW_MS = 10 * 60_000;
const LIKE_WINDOW_MAX = 20;
const likeToggles = new Map<string, number[]>();

function likeAllowed(userId: string, postId: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  const key = `${userId}:${postId}`;
  const recent = (likeToggles.get(key) ?? []).filter(at => now - at < LIKE_WINDOW_MS);
  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < LIKE_MIN_GAP_MS) {
    likeToggles.set(key, recent);
    return { ok: false, retryAfterMs: LIKE_MIN_GAP_MS - (now - last) };
  }
  if (recent.length >= LIKE_WINDOW_MAX) {
    likeToggles.set(key, recent);
    return { ok: false, retryAfterMs: LIKE_WINDOW_MS - (now - recent[0]) };
  }
  recent.push(now);
  likeToggles.set(key, recent);
  if (likeToggles.size > 20_000) {
    for (const [k, times] of likeToggles) if (!times.length || now - times[times.length - 1] > LIKE_WINDOW_MS) likeToggles.delete(k);
  }
  return { ok: true };
}

api.post("/posts/:id/like",requireAuth,async(req,res)=>{
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  const limit = likeAllowed(req.user!.id, id);
  if (!limit.ok) {
    res.setHeader("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
    return res.status(429).json({error:"いいねの連打は制限されています。少し待ってからお試しください。", retryAfterMs: limit.retryAfterMs});
  }
  try {
    if (!(await visiblePost(req.user!.id, id))) return res.status(404).json({error:"投稿が見つかりません。"});
    const p=await db.execute({sql:"SELECT user_id FROM posts WHERE id=?",args:[id]});
    const owner=String(p.rows[0].user_id);
    const ex=await db.execute({sql:"SELECT 1 FROM likes WHERE user_id=? AND post_id=?",args:[req.user!.id,id]});
    if(ex.rows.length){
      await db.execute({sql:"DELETE FROM likes WHERE user_id=? AND post_id=?",args:[req.user!.id,id]});
      res.json({liked:false});
    }else{
      await db.execute({sql:"INSERT INTO likes(user_id,post_id,created_at) VALUES(?,?,?)",args:[req.user!.id,id,new Date().toISOString()]});
      if(owner!==req.user!.id&&(await settingsFor(owner)).notify_likes)await db.execute({sql:"INSERT INTO notifications(id,user_id,actor_id,kind,post_id,created_at) VALUES(?,?,?,?,?,?)",args:[crypto.randomUUID(),owner,req.user!.id,"like",id,new Date().toISOString()]});
      res.json({liked:true});
    }
  }catch{
    res.status(500).json({error:"いいねを処理できませんでした。"});
  }
});

// Poll vote. One vote per person; voting again moves it to another option.
const voteSchema = z.object({ optionId: z.string().min(1).max(64) });
api.post("/posts/:id/vote", requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  const parsed = voteSchema.safeParse(req.body);
  if (!id || !parsed.success) return res.status(400).json({ error: "投票の内容を確認してください。" });
  const me = req.user!.id;
  try {
    if (!(await visiblePost(me, id))) return res.status(404).json({ error: "投稿が見つかりません。" });
    const option = await db.execute({ sql: "SELECT id FROM poll_options WHERE id=? AND post_id=?", args: [parsed.data.optionId, id] });
    if (!option.rows.length) return res.status(400).json({ error: "選択肢が正しくありません。" });
    await db.execute({
      sql: `INSERT INTO poll_votes(post_id,user_id,option_id,created_at) VALUES(?,?,?,?)
            ON CONFLICT(post_id,user_id) DO UPDATE SET option_id=excluded.option_id, created_at=excluded.created_at`,
      args: [id, me, parsed.data.optionId, new Date().toISOString()]
    });
    const [post] = await attachPostExtras([{ id }], me);
    res.json({ poll: post.poll });
  } catch {
    res.status(500).json({ error: "投票できませんでした。" });
  }
});

api.post("/users/:id/follow",requireAuth,async(req,res)=>{
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"ユーザーIDが不正です。"});
  if(id===req.user!.id)return res.status(400).json({error:"自分自身はフォローできません。"});
  try{
    const t=await db.execute({sql:"SELECT id FROM users WHERE id=?",args:[id]});
    if(!t.rows.length)return res.status(404).json({error:"ユーザーが見つかりません。"});
    const ex=await db.execute({sql:"SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?",args:[req.user!.id,id]});
    if(ex.rows.length){
      // Unfollowing also removes them from the owner's close friends, so they lose close-friend posts.
      await db.batch([
        {sql:"DELETE FROM follows WHERE follower_id=? AND followed_id=?",args:[req.user!.id,id]},
        {sql:"DELETE FROM close_friends WHERE owner_id=? AND friend_id=?",args:[id,req.user!.id]}
      ],"write");
      return res.json({following:false});
    }
    await db.execute({sql:"INSERT INTO follows(follower_id,followed_id,created_at) VALUES(?,?,?)",args:[req.user!.id,id,new Date().toISOString()]});
    if((await settingsFor(id)).notify_follows)await db.execute({sql:"INSERT INTO notifications(id,user_id,actor_id,kind,created_at) VALUES(?,?,?,?,?)",args:[crypto.randomUUID(),id,req.user!.id,"follow",new Date().toISOString()]});
    res.json({following:true});
  }catch{
    res.status(500).json({error:"フォローを処理できませんでした。"});
  }
});

api.get("/notifications/unread-count",requireAuth,async(req,res)=>{try{const r=await db.execute({sql:"SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL",args:[req.user!.id]});res.json({count:Number(r.rows[0]?.n||0)});}catch{res.status(500).json({error:"通知件数を読み込めませんでした。"});}});

api.get("/notifications",requireAuth,async(req,res)=>{try{const r=await db.execute({sql:`SELECT n.id,n.kind,n.post_id,n.created_at,n.read_at,u.id actor_id,u.display_name,u.avatar_url,p.caption post_caption,p.media_type post_media_type,p.media_url post_media_url FROM notifications n JOIN users u ON u.id=n.actor_id LEFT JOIN posts p ON p.id=n.post_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100`,args:[req.user!.id]});res.json({notifications:r.rows});}catch{res.status(500).json({error:"通知を読み込めませんでした。"});}});

api.post("/notifications/read",requireAuth,async(req,res)=>{await db.execute({sql:"UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",args:[new Date().toISOString(),req.user!.id]});res.json({ok:true});});

// Recommended posts (popular in the last 14 days, visible to the viewer, not their own) and people the viewer does not follow yet.
api.get("/recommendations",requireAuth,async(req,res)=>{
  const me=req.user!.id; const since=new Date(Date.now()-14*24*60*60*1000).toISOString();
  try{
    const [posts,users]=await Promise.all([
      db.execute({sql:`${postSelect} WHERE p.user_id<>? AND p.created_at>=? AND ${VISIBLE_TO_SQL} ORDER BY ((SELECT COUNT(*) FROM likes l2 WHERE l2.post_id=p.id)+2*(SELECT COUNT(*) FROM comments c2 WHERE c2.post_id=p.id)) DESC, p.created_at DESC LIMIT 5`,args:[me,me,since,...visibleArgs(me)]}),
      db.execute({sql:"SELECT u.id,u.display_name,u.avatar_url,u.bio,(SELECT COUNT(*) FROM follows f WHERE f.followed_id=u.id) followers FROM users u WHERE u.id<>? AND NOT EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id=? AND f2.followed_id=u.id) ORDER BY followers DESC, u.created_at DESC LIMIT 5",args:[me,me]})
    ]);
    res.json({posts:await attachPostExtras(posts.rows,me),users:users.rows});
  }catch{res.status(500).json({error:"おすすめを読み込めませんでした。"});}
});

api.delete("/posts/:id",requireAuth,async(req,res)=>{
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  const owned=await db.execute({sql:"SELECT id, media_type, media_url FROM posts WHERE id=? AND user_id=?",args:[id,req.user!.id]});
  if(!owned.rows.length)return res.status(404).json({error:"投稿が見つからないか、削除権限がありません。"});
  // Remove dependents explicitly so deletion does not rely on foreign-key cascades being enabled.
  await db.batch([
    ...postCleanupStatements(id),
    {sql:"DELETE FROM posts WHERE id=? AND user_id=?",args:[id,req.user!.id]}
  ], "write");
  if (owned.rows[0].media_type === "video") await deleteVideoForPost(owned.rows[0].media_url === null ? null : String(owned.rows[0].media_url)).catch(() => undefined);
  res.json({ok:true});
});
