import "dotenv/config";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";

const url = process.env.VIDEO_TURSO_DATABASE_URL;
const authToken = process.env.VIDEO_TURSO_AUTH_TOKEN;
let videoDb: Client | null = null;
let initialized = false;

export function isVideoDatabaseReady() {
  return initialized && videoDb !== null;
}

export function getVideoDatabase() {
  if (!isVideoDatabaseReady() || !videoDb) {
    throw new Error("動画専用Tursoデータベースを利用できません。VIDEO_TURSO_DATABASE_URL と VIDEO_TURSO_AUTH_TOKEN を確認してください。");
  }
  return videoDb;
}

export async function initializeVideoDatabase() {
  if (!url || !authToken) {
    console.warn("Video storage is disabled: set VIDEO_TURSO_DATABASE_URL and VIDEO_TURSO_AUTH_TOKEN to enable it.");
    return;
  }

  try {
    const client = createClient({ url, authToken });
    await client.batch([
      `CREATE TABLE IF NOT EXISTS video_chunks (
        video_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY(video_id, chunk_index)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_video_chunks_id ON video_chunks(video_id, chunk_index)`
    ], "write");
    videoDb = client;
    initialized = true;
  } catch (error) {
    console.error("Video storage is disabled because its Turso database could not be initialized:", error);
  }
}
