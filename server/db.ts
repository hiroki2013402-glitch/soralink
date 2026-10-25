import { createClient } from "@libsql/client";
import "dotenv/config";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("TURSO_DATABASE_URL と TURSO_AUTH_TOKEN を設定してください。");
}

export const db = createClient({ url, authToken });

export async function initializeDatabase() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      cover_url TEXT,
      bio TEXT NOT NULL DEFAULT '',
      website TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),
      media_url TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS likes (
      user_id TEXT NOT NULL REFERENCES users(id),
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, post_id)
    )`,
    `CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id),
      followed_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(follower_id, followed_id),
      CHECK(follower_id <> followed_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),
      media_url TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK(kind IN ('like','follow')), post_id TEXT, created_at TEXT NOT NULL, read_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_stories_expiry ON stories(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`
  ], "write");
  const columns = await db.execute("PRAGMA table_info(users)");
  const names = new Set(columns.rows.map((r) => String(r.name)));
  if (!names.has("cover_url")) await db.execute("ALTER TABLE users ADD COLUMN cover_url TEXT");
  if (!names.has("bio")) await db.execute("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  if (!names.has("website")) await db.execute("ALTER TABLE users ADD COLUMN website TEXT");
}