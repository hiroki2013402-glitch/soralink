import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { initializeDatabase } from "./db.js";
import { registerOAuthRoutes } from "./oauth.js";
import { api } from "./routes.js";

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));
app.use(cors({ origin: config.appOrigin, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "SoraLink", version: "2.0.0" }));
registerOAuthRoutes(app);
app.use("/api", api);

const clientBuildDir = path.join(projectRoot, "dist");
const clientIndex = path.join(clientBuildDir, "index.html");
if (existsSync(clientIndex)) {
  app.use(express.static(clientBuildDir, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.sendFile(clientIndex);
  });
}

await initializeDatabase();
app.listen(config.port, "0.0.0.0", () => {
  console.log(`SoraLink API listening on ${config.port}`);
});