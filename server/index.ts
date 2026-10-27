import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { initializeDatabase } from "./db.js";
import { registerOAuthRoutes } from "./oauth.js";
import { api } from "./routes.js";
import { admin } from "./admin.js";
import { dm } from "./dm.js";
import { push } from "./push.js";
import { settingsRouter } from "./settings.js";
import { videos } from "./videos.js";
import { initializeVideoDatabase, isVideoDatabaseReady } from "./videoDb.js";

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

app.set("trust proxy", 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'", "https://script.google.com"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: config.nodeEnv === "production" ? [] : null
    }
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(cors({ origin: config.appOrigin, credentials: true }));
// Gzip/deflate for JSON, HTML and JS. Images are already compressed and are skipped by the default filter.
app.use(compression());
app.use(express.json({ limit: "32kb", strict: true }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Small per-process limiter. Use a shared store (for example Redis) for multi-instance production.
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(limit: number, windowMs: number, scope?: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const key = `${req.ip}:${scope ?? (req.path.startsWith("/api/auth/") ? "auth" : req.method === "GET" ? "read" : "write")}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + windowMs }; buckets.set(key, bucket); }
    bucket.count += 1;
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: "リクエストが多すぎます。少し待ってから再試行してください。" });
    }
    if (buckets.size > 10000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    next();
  };
}
app.use("/api/auth", rateLimit(30, 60_000));
// Image and icon bytes are fetched once per picture by the browser, and a feed can show many of them.
// They are not counted against the per-minute read budget, or a busy feed would lose its own pictures.
const BINARY_READ = /^\/(media\/[0-9a-f-]{36}|dm\/messages\/[0-9a-f-]{36}\/image|dm\/conversations\/[0-9a-f-]{36}\/icon)(\?|$)/i;
app.use("/api", (req, res, next) => {
  if (req.method === "PUT" && /^\/media\/video\/[0-9a-f-]{36}\/chunk\/\d+$/i.test(req.path)) return rateLimit(1200, 60_000)(req, res, next);
  if (req.method === "GET" && BINARY_READ.test(req.path)) return next();
  // Presence heartbeats arrive every few seconds per open tab. They have their own budget, so they never crowd out real actions.
  if (req.method === "POST" && /^\/dm\/presence(\/leave)?$/.test(req.path)) return rateLimit(240, 60_000, "presence")(req, res, next);
  return req.method === "GET" ? rateLimit(300, 60_000)(req, res, next) : rateLimit(60, 60_000)(req, res, next);
});
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  name: "SoraLink",
  version: "2.0.0",
  videoStorage: isVideoDatabaseReady() ? "ready" : "unavailable"
}));
registerOAuthRoutes(app);
app.use("/api", admin);
app.use("/api", dm);
app.use("/api", push);
app.use("/api", settingsRouter);
app.use("/api", videos);
app.use("/api", api);

const clientBuildDir = path.join(projectRoot, "dist");
const clientIndex = path.join(clientBuildDir, "index.html");
if (existsSync(clientIndex)) {
  // Vite names bundles with a content hash, so they can be cached for a year.
  app.use("/assets", express.static(path.join(clientBuildDir, "assets"), { immutable: true, maxAge: "365d" }));
  app.use(express.static(clientBuildDir, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.sendFile(clientIndex);
  });
}

await initializeDatabase();
await initializeVideoDatabase();
app.listen(config.port, "0.0.0.0", () => {
  console.log(`SoraLink API listening on ${config.port}`);
});