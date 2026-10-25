import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { db } from "./db.js";
import { requireAuth } from "./auth.js";

export const api = Router();
const routeId = (value: string | string[] | undefined): string | undefined => typeof value === "string" ? value : undefined;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => { const ok = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"].includes(file.mimetype); cb(ok ? null : new Error("JPG、PNG、WebP、GIF、MP4、WebM形式に対応しています。"), ok); } });
api.post("/media/upload", requireAuth, (req, res, next) => upload.single("file")(req, res, (err) => { if (err) return res.status(400).json({ error: err instanceof Error ? err.message : "ファイルをアップロードできませんでした。" }); next(); }), async (req, res) => {
  const file = req.file; if (!file) return res.status(400).json({ error: "画像または動画を選択してください。" });
  const b = file.buffer; const starts = (...bytes:number[]) => bytes.every((v,i)=>b[i]===v);
  const signatureOk = file.mimetype === "image/jpeg" ? starts(0xff,0xd8,0xff) : file.mimetype === "image/png" ? starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a) : file.mimetype === "image/gif" ? (b.subarray(0,6).toString("ascii")==="GIF87a"||b.subarray(0,6).toString("ascii")==="GIF89a") : file.mimetype === "image/webp" ? (b.subarray(0,4).toString("ascii")==="RIFF"&&b.subarray(8,12).toString("ascii")==="WEBP") : file.mimetype === "video/mp4" || file.mimetype === "video/quicktime" ? b.subarray(4,8).toString("ascii")==="ftyp" : file.mimetype === "video/webm" ? starts(0x1a,0x45,0xdf,0xa3) : false;
  if (!signatureOk) return res.status(400).json({ error: "ファイルの内容と形式が一致しません。対応形式の画像・動画を選択してください。" });
  if (file.size > 20 * 1024 * 1024) return res.status(413).json({ error: "ファイルは20MB以下にしてください。" });
  try { const id = crypto.randomUUID(); await db.execute({ sql: "INSERT INTO media_assets(id,user_id,mime_type,file_name,size_bytes,created_at) VALUES(?,?,?,?,?,?)", args: [id, req.user!.id, file.mimetype, file.originalname.slice(0, 180), file.size, new Date().toISOString()] }); const chunkSize = 256 * 1024; const statements = []; for (let offset = 0, index = 0; offset < file.buffer.length; offset += chunkSize, index++) statements.push({ sql: "INSERT INTO media_chunks(media_id,chunk_index,data) VALUES(?,?,?)", args: [id, index, new Uint8Array(file.buffer.subarray(offset, Math.min(offset + chunkSize, file.buffer.length)))] }); if (statements.length) await db.batch(statements, "write"); res.status(201).json({ id, url: `/api/media/${id}`, mimeType: file.mimetype, size: file.size }); } catch { res.status(500).json({ error: "メディアをTursoに保存できませんでした。データベースの容量・プランを確認してください。" }); }
});
api.get("/media/:id", async (req, res) => { try { const id = routeId(req.params.id) || ""; const r = await db.execute({ sql: "SELECT mime_type,size_bytes FROM media_assets WHERE id=?", args: [id] }); if (!r.rows.length) return res.status(404).end(); const row = r.rows[0]; const chunks = await db.execute({ sql: "SELECT data FROM media_chunks WHERE media_id=? ORDER BY chunk_index", args: [id] }); const body = Buffer.concat(chunks.rows.map(chunk => Buffer.from(chunk.data as Uint8Array))); res.setHeader("Content-Type", String(row.mime_type)); res.setHeader("Content-Length", String(row.size_bytes)); res.setHeader("Cache-Control", "public, max-age=86400, immutable"); res.setHeader("X-Content-Type-Options", "nosniff"); res.end(body); } catch { res.status(500).end(); }
});
const mediaUrl = z.string().url().max(2048).refine((s) => { try { return new URL(s).protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(new URL(s).hostname) && !new URL(s).hostname.endsWith(".local") && !new URL(s).hostname.endsWith(".internal") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(new URL(s).hostname) && !new URL(s).hostname.includes("@"); } catch { return false; } }, "HTTPSのメディアURLを入力してください。");
const storedMedia = z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i, "アップロード済みのメディアを指定してください。");
const postSchema = z.object({ mediaType: z.enum(["image", "video"]), mediaUrl: storedMedia, caption: z.string().max(500).optional().default(""), kind: z.enum(["post", "story"]).optional().default("post") });
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(80), bio: z.string().max(300).default(""), website: z.string().max(2048).optional().default(""), avatarUrl: z.union([z.literal(""), mediaUrl, storedMedia]).optional().default(""), coverUrl: z.union([z.literal(""), mediaUrl, storedMedia]).optional().default("") });

api.get("/me", requireAuth, async (req, res) => {
  const r = await db.execute({sql:"SELECT id, display_name, email, avatar_url, cover_url, bio, website, created_at FROM users WHERE id = ?", args:[req.user!.id]});
  res.json({ user: r.rows[0] ?? req.user });
});
api.get("/feed", async (_req, res) => {
  try {
    const r = await db.execute(`SELECT p.id,p.user_id,p.media_type,p.media_url,p.caption,p.created_at,u.display_name,u.avatar_url,COUNT(DISTINCT l.user_id) likes_count FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN likes l ON l.post_id=p.id GROUP BY p.id ORDER BY p.created_at DESC LIMIT 80`);
    res.json({posts:r.rows});
  } catch { res.status(500).json({error:"タイムラインを読み込めませんでした。"}); }
});
api.get("/likes/mine", requireAuth, async(req,res)=>{ try { const r=await db.execute({sql:"SELECT post_id FROM likes WHERE user_id=?",args:[req.user!.id]}); res.json({ids:r.rows.map(x=>String(x.post_id))}); } catch { res.status(500).json({error:"いいね状態を読み込めませんでした。"}); } });
api.get("/stories", async (_req,res) => {
  try { const now=new Date().toISOString(); await db.execute({sql:"DELETE FROM stories WHERE expires_at <= ?",args:[now]}); const r=await db.execute({sql:`SELECT s.id,s.user_id,s.media_type,s.media_url,s.caption,s.created_at,s.expires_at,u.display_name,u.avatar_url FROM stories s JOIN users u ON u.id=s.user_id WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 60`, args:[now]}); res.json({stories:r.rows}); }
  catch { res.status(500).json({error:"ストーリーを読み込めませんでした。"}); }
});
api.post("/posts", requireAuth, async (req,res) => {
  const p=postSchema.safeParse(req.body); if(!p.success) return res.status(400).json({error:p.error.issues[0]?.message||"入力を確認してください。"});
  if (p.data.mediaUrl.startsWith("/api/media/")) { const owned=await db.execute({sql:"SELECT id FROM media_assets WHERE id=? AND user_id=?",args:[p.data.mediaUrl.slice("/api/media/".length),req.user!.id]}); if(!owned.rows.length)return res.status(403).json({error:"自分がアップロードしたメディアのみ投稿できます。"}); }
  try { const id=crypto.randomUUID(), now=new Date(), created=now.toISOString();
    if(p.data.kind==="story") { const expires=new Date(now.getTime()+24*60*60*1000).toISOString(); await db.execute({sql:"INSERT INTO stories(id,user_id,media_type,media_url,caption,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",args:[id,req.user!.id,p.data.mediaType,p.data.mediaUrl,p.data.caption,created,expires]}); }
    else { await db.execute({sql:"INSERT INTO posts(id,user_id,media_type,media_url,caption,created_at) VALUES(?,?,?,?,?,?)",args:[id,req.user!.id,p.data.mediaType,p.data.mediaUrl,p.data.caption,created]}); }
    res.status(201).json({ok:true,id,kind:p.data.kind});
  } catch { res.status(500).json({error:"保存できませんでした。データベース設定を確認してください。"}); }
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
      db.execute({sql:"SELECT p.id,p.user_id,p.media_type,p.media_url,p.caption,p.created_at,u.display_name,u.avatar_url,(SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) likes_count FROM posts p JOIN users u ON u.id=p.user_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 80",args:[id]}),
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
  const r=await db.execute({sql:"DELETE FROM posts WHERE id=? AND user_id=?",args:[id,req.user!.id]});
  if(!r.rowsAffected)return res.status(404).json({error:"投稿が見つからないか、削除権限がありません。"});
  res.json({ok:true});
});
