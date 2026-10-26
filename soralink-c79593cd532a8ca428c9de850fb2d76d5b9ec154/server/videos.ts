import crypto from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { db } from "./db.js";
import { getVideoDatabase, isVideoDatabaseReady } from "./videoDb.js";
import { canSeePost, resolveViewer, VISIBILITIES } from "./visibility.js";

// Video bytes are stored as BLOB chunks in a dedicated Turso database. R2 is not used.
export const videos = Router();
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const VIDEO_CHUNK_BYTES = 256 * 1024;
const VIDEO_EXTENSIONS = new Map([["video/mp4", "mp4"], ["video/webm", "webm"], ["video/quicktime", "mov"]]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = (v: unknown) => typeof v === "string" && UUID.test(v) ? v : "";
const apiPathFor = (id: string) => `/api/media/video/${id}`;
function requireVideoDatabase(_req: Request, res: Response, next: () => void) {
  if (!isVideoDatabaseReady()) {
    return res.status(503).json({error:"動画機能を利用できません。動画専用Tursoの設定と接続を確認してください。"});
  }
  next();
}
const presignSchema = z.object({
  mimeType: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
  size: z.number().int().positive().max(MAX_VIDEO_BYTES, "動画は200MB以下にしてください。"),
  fileName: z.string().trim().max(180).optional().default("video"),
  visibility: z.enum(VISIBILITIES).optional().default("followers")
});
function matchesVideoSignature(bytes: Buffer, mime: string) {
  if (mime === "video/webm") return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return bytes.subarray(4, 8).toString("ascii") === "ftyp";
}
function bufferFromDatabaseValue(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.alloc(0);
}
export function videoIdFromMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/api\/media\/video\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}
export async function mediaUrlForVideo(userId: string, videoId: string, _visibility: string): Promise<{url:string}|{error:string}|null> {
  const r = await db.execute({sql:"SELECT id FROM media_videos WHERE id=? AND user_id=? AND status='ready'",args:[videoId,userId]});
  return r.rows.length ? {url:apiPathFor(videoId)} : null;
}
export async function deleteVideoForPost(mediaUrl: string | null | undefined) {
  const id = videoIdFromMediaUrl(mediaUrl); if (!id) return;
  if (isVideoDatabaseReady()) await getVideoDatabase().execute({sql:"DELETE FROM video_chunks WHERE video_id=?",args:[id]}).catch(()=>undefined);
  await db.execute({sql:"DELETE FROM media_videos WHERE id=?",args:[id]});
}
async function discard(id: string) {
  await getVideoDatabase().execute({sql:"DELETE FROM video_chunks WHERE video_id=?",args:[id]}).catch(()=>undefined);
  await db.execute({sql:"DELETE FROM media_videos WHERE id=?",args:[id]}).catch(()=>undefined);
}

// Reserve a video record. Video chunks are then PUT directly to this server and persisted in VIDEO Turso.
videos.post("/media/video/presign", requireAuth, requireVideoDatabase, async (req,res) => {
  const parsed = presignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:parsed.error.issues[0]?.message || "動画の形式を確認してください。"});
  const {mimeType,size,fileName} = parsed.data;
  const id = crypto.randomUUID();
  try {
    await db.execute({sql:"INSERT INTO media_videos(id,user_id,video_key,poster_key,mime_type,file_name,size_bytes,storage,status,created_at) VALUES(?,?,?,NULL,?,?,?,'private','pending',?)",args:[id,req.user!.id,`turso:${id}`,mimeType,fileName.slice(0,180),size,new Date().toISOString()]});
    res.status(201).json({id, chunkSize:VIDEO_CHUNK_BYTES, chunkCount:Math.ceil(size/VIDEO_CHUNK_BYTES)});
  } catch { res.status(500).json({error:"動画の保存準備に失敗しました。動画専用Tursoの設定と容量を確認してください。"}); }
});

// Each request stores one bounded binary chunk in the separate video database.
videos.put("/media/video/:id/chunk/:index", requireAuth, requireVideoDatabase, express.raw({type:"application/octet-stream",limit:"270kb"}), async (req,res) => {
  const id=idParam(req.params.id), index=Number(req.params.index);
  if (!id || !Number.isSafeInteger(index) || index<0 || !Buffer.isBuffer(req.body) || req.body.length<1 || req.body.length>VIDEO_CHUNK_BYTES) return res.status(400).json({error:"動画チャンクが不正です。"});
  try {
    const r=await db.execute({sql:"SELECT size_bytes,status FROM media_videos WHERE id=? AND user_id=?",args:[id,req.user!.id]});
    if (!r.rows.length) return res.status(404).json({error:"動画が見つかりません。"});
    if (r.rows[0].status === "ready") return res.status(409).json({error:"アップロード済みの動画です。"});
    const total=Number(r.rows[0].size_bytes), count=Math.ceil(total/VIDEO_CHUNK_BYTES);
    if (index>=count || req.body.length !== (index===count-1 ? total-index*VIDEO_CHUNK_BYTES : VIDEO_CHUNK_BYTES)) return res.status(400).json({error:"動画チャンクのサイズが一致しません。"});
    await getVideoDatabase().execute({sql:"INSERT INTO video_chunks(video_id,chunk_index,data) VALUES(?,?,?) ON CONFLICT(video_id,chunk_index) DO UPDATE SET data=excluded.data",args:[id,index,new Uint8Array(req.body)]});
    res.json({ok:true,index});
  } catch { res.status(500).json({error:"動画を動画専用Tursoへ保存できませんでした。プランの容量・書き込み制限を確認してください。"}); }
});

videos.post("/media/video/complete", requireAuth, requireVideoDatabase, async (req,res) => {
  const id=idParam(req.body?.id); if (!id) return res.status(400).json({error:"動画IDが不正です。"});
  try {
    const r=await db.execute({sql:"SELECT * FROM media_videos WHERE id=? AND user_id=?",args:[id,req.user!.id]});
    if (!r.rows.length) return res.status(404).json({error:"動画が見つかりません。"});
    if (r.rows[0].status === "ready") return res.json({ok:true,id});
    const size=Number(r.rows[0].size_bytes), count=Math.ceil(size/VIDEO_CHUNK_BYTES);
    const check=await getVideoDatabase().execute({sql:"SELECT chunk_index,length(data) AS bytes FROM video_chunks WHERE video_id=? ORDER BY chunk_index",args:[id]});
    if (check.rows.length!==count || check.rows.some((row,i)=>Number(row.chunk_index)!==i || Number(row.bytes)!==(i===count-1?size-i*VIDEO_CHUNK_BYTES:VIDEO_CHUNK_BYTES))) return res.status(400).json({error:"動画の一部が未送信です。アップロードを再試行してください。"});
    const first=await getVideoDatabase().execute({sql:"SELECT data FROM video_chunks WHERE video_id=? AND chunk_index=0",args:[id]});
    const header=bufferFromDatabaseValue(first.rows[0]?.data);
    if (!matchesVideoSignature(header,String(r.rows[0].mime_type))) { await discard(id); return res.status(400).json({error:"動画の内容と形式が一致しません。"}); }
    await db.execute({sql:"UPDATE media_videos SET status='ready' WHERE id=?",args:[id]});
    res.json({ok:true,id});
  } catch { res.status(500).json({error:"動画を確認できませんでした。動画専用Tursoの容量・制限を確認してください。"}); }
});

async function servePlayable(req:Request,res:Response) {
  const id=idParam(req.params.id); if(!id) return res.status(404).end();
  try {
    const r=await db.execute({sql:"SELECT user_id,mime_type,size_bytes,status FROM media_videos WHERE id=?",args:[id]});
    const row=r.rows[0]; if(!row || row.status!=="ready") return res.status(404).end();
    const attached=await db.execute({sql:"SELECT user_id,visibility FROM posts WHERE media_url=? LIMIT 1",args:[apiPathFor(id)]});
    if(!attached.rows.length) return res.status(404).end();
    const post=attached.rows[0];
    if(!(await canSeePost(await resolveViewer(req),String(post.user_id),String(post.visibility)))) return res.status(404).end();
    const size=Number(row.size_bytes); let start=0,end=size-1;
    const range=req.headers.range;
    if(range){ const m=/^bytes=(\d*)-(\d*)$/.exec(range); if(!m) return res.status(416).setHeader("Content-Range",`bytes */${size}`).end(); if(m[1]===""){const suffix=Number(m[2]);start=Math.max(0,size-suffix);}else{start=Number(m[1]);if(m[2])end=Number(m[2]);} if(start>=size||end<start){return res.status(416).setHeader("Content-Range",`bytes */${size}`).end();} end=Math.min(end,size-1); }
    const first=Math.floor(start/VIDEO_CHUNK_BYTES), last=Math.floor(end/VIDEO_CHUNK_BYTES);
    const chunks=await getVideoDatabase().execute({sql:"SELECT chunk_index,data FROM video_chunks WHERE video_id=? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index",args:[id,first,last]});
    if(chunks.rows.length!==last-first+1) return res.status(500).end();
    const parts=chunks.rows.map(x=>bufferFromDatabaseValue(x.data));
    const combined=Buffer.concat(parts); const body=combined.subarray(start-first*VIDEO_CHUNK_BYTES,end-first*VIDEO_CHUNK_BYTES+1);
    res.status(range?206:200);res.setHeader("Content-Type",String(row.mime_type));res.setHeader("Accept-Ranges","bytes");res.setHeader("Content-Length",String(body.length));res.setHeader("Cache-Control",String(post.visibility)==="public"?"public, max-age=3600":"private, no-store");res.setHeader("X-Content-Type-Options","nosniff");if(range)res.setHeader("Content-Range",`bytes ${start}-${end}/${size}`);res.end(body);
  } catch { if(!res.headersSent)res.status(500).end(); else res.end(); }
}
videos.get("/media/video/:id", requireVideoDatabase, (req,res)=>{void servePlayable(req,res);});
videos.get("/media/video/:id/poster", (_req,res)=>res.status(404).end());
