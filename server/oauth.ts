import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { db } from "./db.js";
import { encrypt, hashToken, pkceChallenge, randomToken, signCookie, verifyCookie } from "./security.js";

const cookieOptions = {
  httpOnly: true,
  secure: config.nodeEnv === "production",
  sameSite: "lax" as const,
  path: "/"
};

function readUser(payload: any) {
  const data = payload?.user ?? payload?.data ?? payload;
  const id = data?.id ?? data?.sub ?? data?.user_id;
  if (!id) throw new Error("Sennin Account のユーザーIDがレスポンスにありません。");
  const displayName = String(data?.name ?? data?.display_name ?? data?.username ?? data?.email ?? "Senninユーザー").slice(0, 80);
  const email = typeof data?.email === "string" ? data.email.slice(0, 254) : null;
  const avatar = typeof (data?.avatar_url ?? data?.picture) === "string" ? String(data.avatar_url ?? data.picture).slice(0, 2048) : null;
  return { id: `sennin:${String(id)}`, displayName, email, avatar };
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/auth/login", (req: Request, res: Response) => {
    const state = randomToken(32);
    const verifier = randomToken(48);
    const challenge = pkceChallenge(verifier);
    res.cookie("soralink_oauth_state", signCookie(state), { ...cookieOptions, maxAge: 10 * 60 * 1000 });
    res.cookie("soralink_oauth_verifier", signCookie(verifier), { ...cookieOptions, maxAge: 10 * 60 * 1000 });
    const url = new URL(config.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("scope", config.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    res.redirect(url.toString());
  });

  app.get("/api/auth/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const returnedState = typeof req.query.state === "string" ? req.query.state : "";
    const state = verifyCookie(req.cookies?.soralink_oauth_state);
    const verifier = verifyCookie(req.cookies?.soralink_oauth_verifier);
    res.clearCookie("soralink_oauth_state", { ...cookieOptions, maxAge: undefined });
    res.clearCookie("soralink_oauth_verifier", { ...cookieOptions, maxAge: undefined });
    if (!code || !state || !verifier || state !== returnedState) {
      return res.redirect(`${config.appOrigin}/?auth_error=${encodeURIComponent("認証情報を確認できませんでした。もう一度お試しください。")}`);
    }
    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: verifier
      });
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
      if (config.clientSecret) {
        headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
      }
      const tokenResponse = await fetch(config.tokenUrl, { method: "POST", headers, body });
      const tokenData: any = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || typeof tokenData.access_token !== "string") {
        throw new Error(String(tokenData.error_description ?? tokenData.error ?? "トークンを取得できませんでした。"));
      }
      const accessToken = tokenData.access_token as string;
      const userResponse = await fetch(config.userinfoUrl, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
      let userData: any = await userResponse.json().catch(() => ({}));
      if (!userResponse.ok || !(userData?.id || userData?.sub || userData?.user?.id || userData?.data?.id)) {
        const meResponse = await fetch(config.meUrl, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
        userData = await meResponse.json().catch(() => ({}));
        if (!meResponse.ok) throw new Error("Sennin Accountからユーザー情報を取得できませんでした。");
      }
      const user = readUser(userData);
      const now = new Date().toISOString();
      await db.execute({
        sql: `INSERT INTO users(id, display_name, email, avatar_url, created_at)
              VALUES(?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email, avatar_url=excluded.avatar_url`,
        args: [user.id, user.displayName, user.email, user.avatar, now]
      });
      const sessionToken = randomToken(48);
      const refreshToken = typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : "";
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      await db.execute({
        sql: `INSERT INTO sessions(id_hash, user_id, access_token_enc, refresh_token_enc, expires_at, created_at)
              VALUES(?, ?, ?, ?, ?, ?)`,
        args: [hashToken(sessionToken), user.id, encrypt(accessToken), refreshToken ? encrypt(refreshToken) : "", expiresAt, now]
      });
      res.cookie("soralink_session", signCookie(sessionToken), { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });
      res.redirect(`${config.appOrigin}/`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sennin Accountへの接続に失敗しました。";
      res.redirect(`${config.appOrigin}/?auth_error=${encodeURIComponent(message.slice(0, 180))}`);
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const raw = verifyCookie(req.cookies?.soralink_session);
    if (raw) await db.execute({ sql: "DELETE FROM sessions WHERE id_hash = ?", args: [hashToken(raw)] });
    res.clearCookie("soralink_session", { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });
}