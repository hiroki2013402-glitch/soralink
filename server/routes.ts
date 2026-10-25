import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { db } from "./db.js";
import { requireAuth } from "./auth.js";
import { canSeePost, resolveViewer, VISIBILITIES, VISIBLE_TO_SQL, visibleArgs } from "./visibility.js";

export const api = Router();
const routeId = (value: string | string[] | undefined): string | undefined => typeof value === "string" ? value : undefined;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 }, fileFilter: (_req, file, cb) => { const ok = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"].includes(file.mimetype); if (ok) cb(null, true); else cb(new Error("JPG、PNG、WebP、GIF、MP4、WebM形式に対応しています。")); } });
api.post("/media/upload", requireAuth, (req, res, next) => upload.single("file")(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "ファイルは20MB以下にしてください。" });
  return res.status(400).json({ error: err instanceof multer.MulterError ? "ファイルをアップロードできませんでした。" : err instanceof Error ? err.message : "ファイルをアップロードできませんでした。" });
}), async (req, res) => {
  const file = req.file; if (!file) return res.status(400).json({ error: "画像または動画を選択してください。" });
  const b = file.buffer; const starts = (...bytes:number[]) => bytes.every((v,i)=>b[i]===v);
  const signatureOk = file.mimetype === "image/jpeg" ? starts(0xff,0xd8,0xff) : file.mimetype === "image/png" ? starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a) : file.mimetype === "image/gif" ? (b.subarray(0,6).toString("ascii")==="GIF87a"||b.subarray(0,6).toString("ascii")==="GIF89a") : file.mimetype === "image/webp" ? (b.subarray(0,4).toString("ascii")==="RIFF"&&b.subarray(8,12).toString("ascii")==="WEBP") : file.mimetype === "video/mp4" || file.mimetype === "video/quicktime" ? b.subarray(4,8).toString("ascii")==="ftyp" : file.mimetype === "video/webm" ? starts(0x1a,0x45,0xdf,0xa3) : false;
  if (!signatureOk) return res.status(400).json({ error: "ファイルの内容と形式が一致しません。対応形式の画像・動画を選択してください。" });
  if (file.size > MAX_FILE_BYTES) return res.status(413).json({ error: "ファイルは20MB以下にしてください。" });
  try { const id = crypto.randomUUID(); await db.execute({ sql: "INSERT INTO media_assets(id,user_id,mime_type,file_name,size_bytes,created_at) VALUES(?,?,?,?,?,?)", args: [id, req.user!.id, file.mimetype, file.originalname.slice(0, 180), file.size, new Date().toISOString()] }); const chunkSize = 256 * 1024; const statements = []; for (let offset = 0, index = 0; offset < file.buffer.length; offset += chunkSize, index++) statements.push({ sql: "INSERT INTO media_chunks(media_id,chunk_index,data) VALUES(?,?,?)", args: [id, index, new Uint8Array(file.buffer.subarray(offset, Math.min(offset + chunkSize, file.buffer.length)))] }); if (statements.length) await db.batch(statements, "write"); res.status(201).json({ id, url: `/api/media/${id}`, mimeType: file.mimetype, size: file.size }); } catch { res.status(500).json({ error: "メディアをTursoに保存できませんでした。データベースの容量・プランを確認してください。" }); }
});

// Media that belongs to a post follows that post's visibility. Avatars, covers and unattached files stay public.
api.get("/media/:id", async (req, res) => {
  try {
    const id = routeId(req.params.id) || "";
    const r = await db.execute({ sql: "SELECT mime_type,size_bytes FROM media_assets WHERE id=?", args: [id] });
    if (!r.rows.length) return res.status(404).end();
    const row = r.rows[0];
    const attached = await db.execute({ sql: "SELECT p.user_id,p.visibility FROM posts p WHERE p.media_url=? LIMIT 1", args: [`/api/media/${id}`] });
    const restricted = attached.rows.length > 0 && attached.rows[0].visibility !== "public";
    if (attached.rows.length && !(await canSeePost(await resolveViewer(req), String(attached.rows[0].user_id), String(attached.rows[0].visibility)))) return res.status(404).end();
    const chunks = await db.execute({ sql: "SELECT data FROM media_chunks WHERE media_id=? ORDER BY chunk_index", args: [id] });
    const body = Buffer.concat(chunks.rows.map(({ data }) => {
      if (!(data instanceof ArrayBuffer)) throw new TypeError("Stored media chunk is not binary data.");
      return Buffer.from(data);
    }));
    res.setHeader("Content-Type", String(row.mime_type));
    res.setHeader("Content-Length", String(row.size_bytes));
    res.setHeader("Cache-Control", restricted ? "private, max-age=3600" : "public, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(body);
  } catch { res.status(500).end(); }
});

const mediaUrl = z.string().url().max(2048).refine((s) => { try { return new URL(s).protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(new URL(s).hostname) && !new URL(s).hostname.endsWith(".local") && !new URL(s).hostname.endsWith(".internal") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(new URL(s).hostname) && !new URL(s).hostname.includes("@"); } catch { return false; } }, "HTTPSのメディアURLを入力してください。");
const storedMedia = z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i, "アップロード済みのメディアを指定してください。");
const visibilitySchema = z.enum(VISIBILITIES, { errorMap: () => ({ message: "公開範囲の指定が不正です。" }) });
// A post needs text, media, or both. Media is optional so text-only posts work.
const postSchema = z.object({
  mediaType: z.enum(["image", "video"]).nullish(),
  mediaUrl: storedMedia.nullish(),
  caption: z.string().trim().max(500).default(""),
  visibility: visibilitySchema.default("public")
}).superRefine((value, ctx) => {
  if (Boolean(value.mediaUrl) !== Boolean(value.mediaType)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "メディアの指定が不正です。" });
  if (!value.mediaUrl && !value.caption) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "テキストか画像・動画を入力してください。" });
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
    res.json({posts:r.rows});
  } catch { res.status(500).json({error:"タイムラインを読み込めませんでした。"}); }
});

api.get("/likes/mine", requireAuth, async(req,res)=>{ try { const r=await db.execute({sql:"SELECT post_id FROM likes WHERE user_id=?",args:[req.user!.id]}); res.json({ids:r.rows.map(x=>String(x.post_id))}); } catch { res.status(500).json({error:"いいね状態を読み込めませんでした。"}); } });

api.post("/posts", requireAuth, async (req,res) => {
  const p=postSchema.safeParse(req.body); if(!p.success) return res.status(400).json({error:p.error.issues[0]?.message||"入力を確認してください。"});
  if (p.data.mediaUrl) { const owned=await db.execute({sql:"SELECT id FROM media_assets WHERE id=? AND user_id=?",args:[p.data.mediaUrl.slice("/api/media/".length),req.user!.id]}); if(!owned.rows.length)return res.status(403).json({error:"自分がアップロードしたメディアのみ投稿できます。"}); }
  try { const id=crypto.randomUUID(), created=new Date().toISOString();
    await db.execute({sql:"INSERT INTO posts(id,user_id,media_type,media_url,caption,visibility,created_at) VALUES(?,?,?,?,?,?,?)",args:[id,req.user!.id,p.data.mediaType??null,p.data.mediaUrl??null,p.data.caption,p.data.visibility,created]});
    res.status(201).json({ok:true,id});
  } catch { res.status(500).json({error:"保存できませんでした。データベース設定を確認してください。"}); }
});

api.get("/posts/:id", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  try {
    const r=await db.execute({sql:`${postSelect} WHERE p.id=? AND ${VISIBLE_TO_SQL}`,args:[req.user!.id,id,...visibleArgs(req.user!.id)]});
    if(!r.rows.length) return res.status(404).json({error:"投稿が見つかりません。"});
    res.json({post:r.rows[0]});
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

api.patch("/me/profile", requireAuth, async(req,res)=>{
  const p=profileSchema.safeParse(req.body);
  if(!p.success) return res.status(400).json({error:p.error.issues[0]?.message||"入力を確認してください。"});
  try {
    for (const value of [p.data.avatarUrl,p.data.coverUrl]) { if (value.startsWith("/api/media/")) { const owned=await db.execute({sql:"SELECT id FROM media_assets WHERE id=? AND user_id=?",args:[value.slice("/api/media/".length),req.user!.id]}); if(!owned.rows.length)return res.status(403).json({error:"自分がアップロードした画像のみ設定できます。"}); } }
    const website=p.data.website.trim();
    if(website && !/^https:\/\//i.test(website)) return res.status(400).json({error:"リンクはhttps://から入力してください。"});
    await db.execute({sql:"UPDATE users SET display_name=?,bio=?,website=?,avatar_url=?,cover_url=? WHERE id=?",args:[p.data.displayName,p.data.bio,website||null,p.data.avatarUrl||null,p.data.coverUrl||null,req.user!.id]});
    const r=await db.execute({sql:"SELECT id,display_name,email,avatar_url,cover_url,bio,website,created_at FROM users WHERE id=?",args:[req.user!.id]});
    res.json({user:r.rows[0]});
  } catch { res.status(500).json({error:"プロフィールを保存できませんでした。"}); }
});

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
  const pattern = `%${likeEscape(q)}%`;
  try {
    const [users, posts] = await Promise.all([
      db.execute({ sql: "SELECT id,display_name,avatar_url,bio FROM users WHERE display_name LIKE ? ESCAPE '\\' AND id<>? ORDER BY display_name COLLATE NOCASE LIMIT 30", args: [pattern, me] }),
      db.execute({ sql: `${postSelect} WHERE ${VISIBLE_TO_SQL} AND p.caption LIKE ? ESCAPE '\\' ORDER BY p.created_at DESC LIMIT 30`, args: [me, ...visibleArgs(me), pattern] })
    ]);
    res.json({ users: users.rows, posts: posts.rows });
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
    res.json({user:u.rows[0],posts:posts.rows,followers:Number(followers.rows[0]?.n||0),following:Number(following.rows[0]?.n||0),isFollowing});
  } catch {
    res.status(500).json({error:"プロフィールを読み込めませんでした。"});
  }
});

api.post("/posts/:id/like",requireAuth,async(req,res)=>{
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
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
      if(owner!==req.user!.id)await db.execute({sql:"INSERT INTO notifications(id,user_id,actor_id,kind,post_id,created_at) VALUES(?,?,?,?,?,?)",args:[crypto.randomUUID(),owner,req.user!.id,"like",id,new Date().toISOString()]});
      res.json({liked:true});
    }
  }catch{
    res.status(500).json({error:"いいねを処理できませんでした。"});
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
    await db.execute({sql:"INSERT INTO notifications(id,user_id,actor_id,kind,created_at) VALUES(?,?,?,?,?)",args:[crypto.randomUUID(),id,req.user!.id,"follow",new Date().toISOString()]});
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
    res.json({posts:posts.rows,users:users.rows});
  }catch{res.status(500).json({error:"おすすめを読み込めませんでした。"});}
});

api.delete("/posts/:id",requireAuth,async(req,res)=>{
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  const owned=await db.execute({sql:"SELECT id FROM posts WHERE id=? AND user_id=?",args:[id,req.user!.id]});
  if(!owned.rows.length)return res.status(404).json({error:"投稿が見つからないか、削除権限がありません。"});
  // Remove dependents explicitly so deletion does not rely on foreign-key cascades being enabled.
  await db.batch([
    {sql:"DELETE FROM comments WHERE post_id=?",args:[id]},
    {sql:"DELETE FROM likes WHERE post_id=?",args:[id]},
    {sql:"DELETE FROM posts WHERE id=? AND user_id=?",args:[id,req.user!.id]}
  ], "write");
  res.json({ok:true});
});
