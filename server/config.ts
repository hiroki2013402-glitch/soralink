import "dotenv/config";

const required = ["COOKIE_SECRET", "SENNIN_CLIENT_ID", "SENNIN_REDIRECT_URI"] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} が設定されていません。`);
}
if ((process.env.COOKIE_SECRET || "").length < 32) {
  throw new Error("COOKIE_SECRET は32文字以上にしてください。");
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  appOrigin: process.env.APP_ORIGIN || "http://localhost:5173",
  cookieSecret: process.env.COOKIE_SECRET!,
  clientId: process.env.SENNIN_CLIENT_ID!,
  clientSecret: process.env.SENNIN_CLIENT_SECRET || "",
  redirectUri: process.env.SENNIN_REDIRECT_URI!,
  authorizationUrl: process.env.SENNIN_AUTHORIZATION_URL || "https://script.google.com/macros/s/AKfycbzSlcCC1kI2TE63DqkhNACg9Bw8gVFs0Ca7loctMU_iiHThX8fnYC2FL_W4Vx70WESG/exec",
  tokenUrl: process.env.SENNIN_TOKEN_URL || "https://sennin-account-api.xianrendesu.workers.dev/oauth/token",
  userinfoUrl: process.env.SENNIN_USERINFO_URL || "https://sennin-account-api.xianrendesu.workers.dev/oauth/userinfo",
  meUrl: process.env.SENNIN_ME_URL || "https://sennin-account-api.xianrendesu.workers.dev/api/v1/me",
  scope: process.env.SENNIN_SCOPE || "profile email",
  // Admin area (/admin). ADMIN_PASSWORD enables it. ADMIN_SENNIN_ID (optional, the raw Sennin user id) limits admin rights to one account.
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminSenninId: process.env.ADMIN_SENNIN_ID || ""
};