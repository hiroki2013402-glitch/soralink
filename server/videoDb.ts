import "dotenv/config";
import { createClient } from "@libsql/client";

const url = process.env.VIDEO_TURSO_DATABASE_URL;
const authToken = process.env.VIDEO_TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  throw new Error("動画専用Tursoの VIDEO_TURSO_DATABASE_URL と VIDEO_TURSO_AUTH_TOKEN を設定してください。");
}
export const videoDb = createClient({ url, authToken });

export async function initializeVideoDatabase() {
  await videoDb.batch([
    `CREATE TABLE IF NOT EXISTS video_chunks (
      video_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY(video_id, chunk_index)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_video_chunks_id ON video_chunks(video_id, chunk_index)`
  ], "write");
}
