# SoraLink

SoraLink is a responsive social photo/video sharing app built with React + TypeScript + Vite, Express, and Turso/libSQL. The app includes an OAuth login flow for Sennin Account, a home feed, 24-hour stories, user search, profile pages, profile editing, follows, likes, and notifications.

## Features

- Sennin Account OAuth login/logout (no local password database)
- Responsive blue/white UI with a mobile bottom navigation
- Image/video posts with captions and delete-own-post permission
- Stories that expire 24 hours after publication (expired rows are hidden automatically)
- Profile page with avatar, cover image, bio, website, posts, follower/following counts
- User search, follow/unfollow, like/unlike
- Notifications for new likes and follows
- Turso schema initialization and backward-compatible profile-column migrations
- Production static serving from the same Express process

## Requirements

- Node.js 20+
- A Turso database and auth token
- An OAuth application registered in Sennin Account
- Public HTTPS URLs for uploaded media and profile images. This version stores image/video URLs, not the file bytes themselves.

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill in all required values below.
3. Install dependencies: `npm install`
4. Build: `npm run build`
5. Start production mode: `npm start`

For development with Vite hot reload, use `npm run dev`. Vite proxies `/api` requests to `http://localhost:3000`.

## Required environment variables

| Variable | Purpose |
|---|---|
| `COOKIE_SECRET` | Random secret, at least 32 characters |
| `TURSO_DATABASE_URL` | Turso database URL (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `SENNIN_CLIENT_ID` | OAuth client ID from Sennin Account |
| `SENNIN_REDIRECT_URI` | Exact callback URL, usually `https://YOUR-SERVICE.onrender.com/api/auth/callback` |

Configure `APP_ORIGIN` to the public origin of the frontend/service. For a single Render web service, use the same Render URL, e.g. `https://YOUR-SERVICE.onrender.com`. The optional OAuth endpoints and client secret are documented in `.env.example`.

## Render deployment

Deploy this folder as a Node web service:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Health check path:** `/api/health`

The server serves the built frontend from `dist` when it is present; this does not depend on `NODE_ENV`.

Add the environment variables in Render's Environment settings. Set `SENNIN_REDIRECT_URI` to the exact deployed callback URL and register that same URI in the Sennin Account OAuth app. Do not commit `.env` or database tokens.

## Media URLs

Posts, stories, avatar and cover image fields accept public HTTPS URLs. For images/videos, use a direct URL that the browser can load (for example a public object-storage URL). URLs behind login pages or temporary/private links will not display. Direct file upload/storage is not included in this build; connect an object-storage service if you need upload buttons and stored file binaries.

## Database behavior

On startup, the server creates missing tables and indexes. Existing `users` tables are migrated to add `cover_url`, `bio`, and `website` if those columns do not exist. Stories are hidden when `expires_at` is in the past; the database rows are retained for now and can be cleaned up by a scheduled task later.

## Troubleshooting

- `TURSO_DATABASE_URL と TURSO_AUTH_TOKEN を設定してください`: set both Render environment variables.
- OAuth callback error: verify client ID, redirect URI exact match, authorization/token/userinfo endpoints, and `APP_ORIGIN`.
- Images not appearing: check that the URL is direct, public, and HTTPS.
- `npm start` cannot find `dist-server/index.js`: run the build command successfully before starting.
