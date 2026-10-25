import { createClient } from "@libsql/client";
import "dotenv/config";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("TURSO_DATABASE_URL と TURSO_AUTH_TOKEN を設定してください。");
}

export const db = createClient({ url, authToken });

// media_type / media_url are nullable so a post can be text-only (like X).
// visibility: 'public' | 'followers' | 'close_friends'.
const postsTableSql = (name: string, ifNotExists = true) => `CREATE TABLE ${ifNotExists ? "IF NOT EXISTS " : ""}${name} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      media_type TEXT CHECK(media_type IS NULL OR media_type IN ('image','video')),
      media_url TEXT,
      caption TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','followers','close_friends')),
      created_at TEXT NOT NULL
    )`;

const postIndexes = [
  `CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id, created_at DESC)`
];

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
    `CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS media_chunks (media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(media_id, chunk_index))`,
    `CREATE INDEX IF NOT EXISTS idx_media_user ON media_assets(user_id, created_at DESC)`,
    // Videos are stored in Cloudflare R2; this table holds their keys and upload state.
    `CREATE TABLE IF NOT EXISTS media_videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      video_key TEXT NOT NULL,
      poster_key TEXT,
      mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage TEXT NOT NULL DEFAULT 'private' CHECK(storage IN ('public','private')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_media_videos_user ON media_videos(user_id, created_at DESC)`,
    postsTableSql("posts"),
    `CREATE TABLE IF NOT EXISTS likes (
      user_id TEXT NOT NULL REFERENCES users(id),
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, post_id)
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id),
      followed_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(follower_id, followed_id),
      CHECK(follower_id <> followed_id)
    )`,
    // Close friends: chosen by the owner from among their followers (owner_id = the person who chose).
    `CREATE TABLE IF NOT EXISTS close_friends (
      owner_id TEXT NOT NULL REFERENCES users(id),
      friend_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(owner_id, friend_id),
      CHECK(owner_id <> friend_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`,
    ...postIndexes,
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK(kind IN ('like','follow')), post_id TEXT, created_at TEXT NOT NULL, read_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`
  ], "write");

  await db.batch([
    "CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id)",
    "CREATE INDEX IF NOT EXISTS idx_follows_followed_created ON follows(followed_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at)"
  ], "write");

  await migratePostsToOptionalMedia();

  const userColumns = await db.execute("PRAGMA table_info(users)");
  const userNames = new Set(userColumns.rows.map((r) => String(r.name)));
  if (!userNames.has("cover_url")) await db.execute("ALTER TABLE users ADD COLUMN cover_url TEXT");
  if (!userNames.has("bio")) await db.execute("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  if (!userNames.has("website")) await db.execute("ALTER TABLE users ADD COLUMN website TEXT");

  // Databases created before post visibility existed get the column here; older rows become public.
  const postColumns = await db.execute("PRAGMA table_info(posts)");
  if (!postColumns.rows.some((r) => r.name === "visibility")) {
    await db.execute("ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','followers','close_friends'))");
  }
  await db.execute("CREATE INDEX IF NOT EXISTS idx_posts_visibility_created ON posts(visibility, created_at DESC)");
}

// Older databases created posts.media_type / media_url as NOT NULL. SQLite cannot drop NOT NULL in
// place, so the table is rebuilt once. likes are copied aside first because dropping a parent table
// can cascade-delete child rows when foreign keys are enforced; they are restored in the same transaction.
async function migratePostsToOptionalMedia() {
  const columns = await db.execute("PRAGMA table_info(posts)");
  const mediaType = columns.rows.find((r) => r.name === "media_type");
  if (!mediaType || Number(mediaType.notnull) === 0) return;

  await db.batch([
    "DROP TABLE IF EXISTS likes_backup",
    "CREATE TABLE likes_backup AS SELECT user_id, post_id, created_at FROM likes",
    postsTableSql("posts_next", false),
    "INSERT INTO posts_next (id, user_id, media_type, media_url, caption, created_at) SELECT id, user_id, media_type, media_url, caption, created_at FROM posts",
    "DROP TABLE posts",
    "ALTER TABLE posts_next RENAME TO posts",
    ...postIndexes,
    "DELETE FROM likes",
    "INSERT INTO likes (user_id, post_id, created_at) SELECT user_id, post_id, created_at FROM likes_backup",
    "DROP TABLE likes_backup"
  ], "write");
}
