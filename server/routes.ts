import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { db } from "./db.js";
import { requireAuth } from "./auth.js";

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
api.get("/media/:id", async (req, res) => { try { const id = routeId(req.params.id) || ""; const r = await db.execute({ sql: "SELECT mime_type,size_bytes FROM media_assets WHERE id=?", args: [id] }); if (!r.rows.length) return res.status(404).end(); const row = r.rows[0]; const chunks = await db.execute({ sql: "SELECT data FROM media_chunks WHERE media_id=? ORDER BY chunk_index", args: [id] }); const body = Buffer.concat(chunks.rows.map(chunk => { if (!(chunk.data instanceof ArrayBuffer)) throw new TypeError("Invalid media chunk data"); return Buffer.from(chunk.data); })); res.setHeader("Content-Type", String(row.mime_type)); res.setHeader("Content-Length", String(row.size_bytes)); res.setHeader("Cache-Control", "public, max-age=86400, immutable"); res.setHeader("X-Content-Type-Options", "nosniff"); res.end(body); } catch { res.status(500).end(); }
});
const mediaUrl = z.string().url().max(2048).refine((s) => { try { return new URL(s).protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(new URL(s).hostname) && !new URL(s).hostname.endsWith(".local") && !new URL(s).hostname.endsWith(".internal") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(new URL(s).hostname) && !new URL(s).hostname.includes("@"); } catch { return false; } }, "HTTPSのメディアURLを入力してください。");
const storedMedia = z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i, "アップロード済みのメディアを指定してください。");
// A post needs text, media, or both. Media is optional so text-only posts work.
const postSchema = z.object({
  mediaType: z.enum(["image", "video"]).nullish(),
  mediaUrl: storedMedia.nullish(),
  caption: z.string().trim().max(500).default("")
}).superRefine((value, ctx) => {
  if (Boolean(value.mediaUrl) !== Boolean(value.mediaType)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "メディアの指定が不正です。" });
  if (!value.mediaUrl && !value.caption) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "テキストか画像・動画を入力してください。" });
});
const commentSchema = z.object({ body: z.string().trim().min(1, "コメントを入力してください。").max(500, "コメントは500文字以内で入力してください。") });
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(80), bio: z.string().max(300).default(""), website: z.string().max(2048).optional().default(""), avatarUrl: z.union([z.literal(""), mediaUrl, storedMedia]).optional().default(""), coverUrl: z.union([z.literal(""), mediaUrl, storedMedia]).optional().default("") });

// Shared post projection. `?` is the viewer's user id, used for the `liked` flag.
const postSelect = `SELECT p.id,p.user_id,p.media_type,p.media_url,p.caption,p.created_at,u.display_name,u.avatar_url,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) likes_count,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comments_count,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) liked
  FROM posts p JOIN users u ON u.id=p.user_id`;

api.get("/me", requireAuth, async (req, res) => {
  const r = await db.execute({sql:"SELECT id, display_name, email, avatar_url, cover_url, bio, website, created_at FROM users WHERE id = ?", args:[req.user!.id]});
  res.json({ user: r.rows[0] ?? req.user });
});
api.get("/feed", async (_req, res) => {
  try {
    const r = await db.execute(`SELECT p.id,p.user_id,p.media_type,p.media_url,p.caption,p.created_at,u.display_name,u.avatar_url,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) likes_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comments_count
      FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 80`);
    res.json({posts:r.rows});
  } catch { res.status(500).json({error:"タイムラインを読み込めませんでした。"}); }
});
api.get("/likes/mine", requireAuth, async(req,res)=>{ try { const r=await db.execute({sql:"SELECT post_id FROM likes WHERE user_id=?",args:[req.user!.id]}); res.json({ids:r.rows.map(x=>String(x.post_id))}); } catch { res.status(500).json({error:"いいね状態を読み込めませんでした。"}); } });
api.post("/posts", requireAuth, async (req,res) => {
  const p=postSchema.safeParse(req.body); if(!p.success) return res.status(400).json({error:p.error.issues[0]?.message||"入力を確認してください。"});
  if (p.data.mediaUrl) { const owned=await db.execute({sql:"SELECT id FROM media_assets WHERE id=? AND user_id=?",args:[p.data.mediaUrl.slice("/api/media/".length),req.user!.id]}); if(!owned.rows.length)return res.status(403).json({error:"自分がアップロードしたメディアのみ投稿できます。"}); }
  try { const id=crypto.randomUUID(), created=new Date().toISOString();
    await db.execute({sql:"INSERT INTO posts(id,user_id,media_type,media_url,caption,created_at) VALUES(?,?,?,?,?,?)",args:[id,req.user!.id,p.data.mediaType??null,p.data.mediaUrl??null,p.data.caption,created]});
    res.status(201).json({ok:true,id});
  } catch { res.status(500).json({error:"保存できませんでした。データベース設定を確認してください。"}); }
});
api.get("/posts/:id", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  try {
    const r=await db.execute({sql:`${postSelect} WHERE p.id=?`,args:[req.user!.id,id]});
    if(!r.rows.length) return res.status(404).json({error:"投稿が見つかりません。"});
    res.json({post:r.rows[0]});
  } catch { res.status(500).json({error:"投稿を読み込めませんでした。"}); }
});
api.get("/posts/:id/comments", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  try {
    const r=await db.execute({sql:"SELECT c.id,c.user_id,c.body,c.created_at,u.display_name,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at ASC LIMIT 200",args:[id]});
    res.json({comments:r.rows});
  } catch { res.status(500).json({error:"コメントを読み込めませんでした。"}); }
});
api.post("/posts/:id/comments", requireAuth, async (req,res) => {
  const id = routeId(req.params.id);
  if (!id) return res.status(400).json({error:"投稿IDが不正です。"});
  const c=commentSchema.safeParse(req.body); if(!c.success) return res.status(400).json({error:c.error.issues[0]?.message||"入力を確認してください。"});
  try {
    const p=await db.execute({sql:"SELECT id FROM posts WHERE id=?",args:[id]});
    if(!p.rows.length) return res.status(404).json({error:"投稿が見つかりません。"});
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
  const q=String(req.query.q||"").trim().slice(0,50); if(!q)return res.json({users:[]});
  const r=await db.execute({sql:"SELECT id,display_name,avatar_url,bio FROM users WHERE display_name LIKE ? AND id<>? LIMIT 30",args:[`%${q}%`,req.user!.id]});
  res.json({users:r.rows});
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
    const [posts,followers,following]=await Promise.all([
      db.execute({sql:`${postSelect} WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 80`,args:[req.user!.id,id]}),
      db.execute({sql:"SELECT COUNT(*) n FROM follows WHERE followed_id=?",args:[id]}),
      db.execute({sql:"SELECT COUNT(*) n FROM follows WHERE follower_id=?",args:[id]})
    ]);
    const followed=await db.execute({sql:"SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?",args:[req.user!.id,id]});
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
    const p=await db.execute({sql:"SELECT user_id FROM posts WHERE id=?",args:[id]});
    if(!p.rows.length)return res.status(404).json({error:"投稿が見つかりません。"});
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
      await db.execute({sql:"DELETE FROM follows WHERE follower_id=? AND followed_id=?",args:[req.user!.id,id]});
      return res.json({following:false});
    }
    await db.execute({sql:"INSERT INTO follows(follower_id,followed_id,created_at) VALUES(?,?,?)",args:[req.user!.id,id,new Date().toISOString()]});
    await db.execute({sql:"INSERT INTO notifications(id,user_id,actor_id,kind,created_at) VALUES(?,?,?,?,?)",args:[crypto.randomUUID(),id,req.user!.id,"follow",new Date().toISOString()]});
    res.json({following:true});
  }catch{
    res.status(500).json({error:"フォローを処理できませんでした。"});
  }
});
api.get("/notifications",requireAuth,async(req,res)=>{try{const r=await db.execute({sql:`SELECT n.id,n.kind,n.post_id,n.created_at,n.read_at,u.id actor_id,u.display_name,u.avatar_url FROM notifications n JOIN users u ON u.id=n.actor_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100`,args:[req.user!.id]});res.json({notifications:r.rows});}catch{res.status(500).json({error:"通知を読み込めませんでした。"});}});
api.post("/notifications/read",requireAuth,async(req,res)=>{await db.execute({sql:"UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",args:[new Date().toISOString(),req.user!.id]});res.json({ok:true});});
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
