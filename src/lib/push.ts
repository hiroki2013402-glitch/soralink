import { api } from "./api";

type PublicKeyResponse = { enabled: boolean; publicKey: string | null };

// Gives up waiting for the service worker after this long, so a missing worker cannot hang the app.
const READY_TIMEOUT_MS = 3000;

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iOS only delivers web push to an app added to the home screen. True when the user is on iOS in a normal browser tab.
export function needsHomeScreen() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  return new Promise(resolve => {
    const timer = window.setTimeout(() => resolve(null), READY_TIMEOUT_MS);
    navigator.serviceWorker.ready.then(reg => {
      window.clearTimeout(timer);
      resolve(reg);
    }, () => {
      window.clearTimeout(timer);
      resolve(null);
    });
  });
}

// The VAPID public key is URL-safe base64; the browser needs raw bytes.
function keyBytes(base64url: string) {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription() {
  const reg = await readyRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveSubscription(sub: PushSubscription) {
  const keys = sub.toJSON().keys ?? {};
  await api("/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint, keys }) });
}

// Creates the browser subscription (reusing an existing one) and stores it on the server. Returns false if push is unavailable.
async function subscribeNow(): Promise<boolean> {
  const { enabled, publicKey } = await api<PublicKeyResponse>("/push/public-key");
  if (!enabled || !publicKey) return false;
  const reg = await readyRegistration();
  if (!reg) return false;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await saveSubscription(sub);
  return true;
}

// Asks for permission (on iOS this must come from a tap), then subscribes. Used by the "通知をオン" button.
export async function enablePush(): Promise<"enabled" | "denied" | "unavailable"> {
  if (!pushSupported()) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  return (await subscribeNow()) ? "enabled" : "unavailable";
}

// Runs on app load. Only refreshes when permission was already granted, so it never shows a prompt by itself.
// Returns true when this browser is subscribed.
export async function refreshPush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const sub = await currentSubscription();
  if (sub) {
    await saveSubscription(sub);
    return true;
  }
  return subscribeNow();
}

// Removes this browser's subscription from the server and the browser. Called on sign-out. Never throws.
export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await api("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // Notifications are best-effort; sign-out must still succeed.
  }
}
