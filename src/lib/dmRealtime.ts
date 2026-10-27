import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { api } from "./api";

export type DmRow = { id: string; conversation_id: string; sender_id: string; created_at: string; kind?: string | null; body?: string | null; reply_to?: string | null };
export type DmReactionEntry = { emoji: string; user_id: string };
export type DmEvent =
  | { type: "message"; conversationId: string; message: DmRow }
  | { type: "membership"; conversationId: string }
  | { type: "unsend"; conversationId: string; messageId: string }
  | { type: "edit"; conversationId: string; messageId: string; body: string; editedAt: string }
  | { type: "react"; conversationId: string; messageId: string; reactions: DmReactionEntry[] }
  | { type: "read"; conversationId: string; userId: string; readAt: string }
  | { type: "group"; conversationId: string }
  // Sent when the connection comes back after a drop, and when the app returns to the foreground.
  // Events sent while disconnected are not replayed, so screens reload what they may have missed.
  | { type: "resync" };

type Listener = (event: DmEvent) => void;
type RealtimeConfig = { url: string; anonKey: string; token: string; expiresIn: number };

// How long a live send waits for the socket to confirm before the message is saved anyway.
const LIVE_ACK_TIMEOUT_MS = 1500;
// How long to wait for a recipient's channel to join before treating that person as unreachable.
const JOIN_TIMEOUT_MS = 3000;
// Resync signals that arrive close together (a reconnect, then the tab coming back) produce one reload.
const RESYNC_DEBOUNCE_MS = 400;

const listeners = new Set<Listener>();
let client: SupabaseClient | null = null;
// Saved rows (Postgres Changes). Works for anyone the RLS policies allow.
let channel: RealtimeChannel | null = null;
// This user's private topic. Other members send live messages here.
let ownChannel: RealtimeChannel | null = null;
// Private topics of people we send to, joined on demand and reused.
let peerChannels = new Map<string, Promise<RealtimeChannel | null>>();
let refreshTimer: number | undefined;
let resyncTimer: number | undefined;
// Bumped on every start/stop so a slow start cannot attach a stale channel after a newer start or a stop.
let generation = 0;
// True from the moment a channel reports a failure until it is subscribed again.
let linkDown = false;

const topicFor = (userId: string) => `dm:user:${userId}`;
const channelOptions = { config: { private: true, broadcast: { self: false } } };

export function onDmEvent(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(event: DmEvent) {
  listeners.forEach(listener => listener(event));
}

// Coalesces bursts of resync signals into one trailing event.
function requestResync() {
  if (resyncTimer !== undefined) return;
  resyncTimer = window.setTimeout(() => {
    resyncTimer = undefined;
    emit({ type: "resync" });
  }, RESYNC_DEBOUNCE_MS);
}

// Tracks a channel's state. Coming back up after a failure asks every screen to resync.
function watchStatus(status: string) {
  if (status === "SUBSCRIBED") {
    if (linkDown) {
      linkDown = false;
      requestResync();
    }
  } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    linkDown = true;
  }
}

// Phones suspend sockets while the app is in the background. Coming back to the foreground resyncs at once.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && client) requestResync();
  });
  window.addEventListener("online", () => {
    if (client) requestResync();
  });
}

export function stopDmRealtime() {
  generation += 1;
  window.clearTimeout(refreshTimer);
  window.clearTimeout(resyncTimer);
  refreshTimer = undefined;
  resyncTimer = undefined;
  linkDown = false;
  const old = client;
  if (old) {
    if (channel) void old.removeChannel(channel);
    if (ownChannel) void old.removeChannel(ownChannel);
    for (const pending of peerChannels.values()) {
      void pending.then(ch => { if (ch) void old.removeChannel(ch); });
    }
  }
  client = null;
  channel = null;
  ownChannel = null;
  peerChannels = new Map();
}

// Subscribes to INSERTs on dm_messages and dm_members, and to live messages on this user's private topic.
export async function startDmRealtime(userId: string) {
  stopDmRealtime();
  const current = generation;
  try {
    const config = await api<RealtimeConfig>("/dm/realtime-token");
    if (current !== generation) return;

    const supabase = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    supabase.realtime.setAuth(config.token);
    client = supabase;
    channel = supabase
      .channel(`dm-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, payload => {
        const row = payload.new as DmRow;
        emit({ type: "message", conversationId: row.conversation_id, message: row });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_members" }, payload => {
        emit({ type: "membership", conversationId: String(payload.new.conversation_id) });
      })
      .subscribe(status => watchStatus(String(status)));
    ownChannel = supabase
      .channel(topicFor(userId), channelOptions)
      .on("broadcast", { event: "message" }, ({ payload }) => {
        const p = payload as { conversationId: string; message: DmRow };
        emit({ type: "message", conversationId: p.conversationId, message: p.message });
      })
      .on("broadcast", { event: "unsend" }, ({ payload }) => {
        const p = payload as { conversationId: string; messageId: string };
        emit({ type: "unsend", conversationId: p.conversationId, messageId: p.messageId });
      })
      .on("broadcast", { event: "edit" }, ({ payload }) => {
        const p = payload as { conversationId: string; messageId: string; body: string; editedAt: string };
        emit({ type: "edit", conversationId: p.conversationId, messageId: p.messageId, body: p.body, editedAt: p.editedAt });
      })
      .on("broadcast", { event: "react" }, ({ payload }) => {
        const p = payload as { conversationId: string; messageId: string; reactions: DmReactionEntry[] };
        emit({ type: "react", conversationId: p.conversationId, messageId: p.messageId, reactions: p.reactions });
      })
      .on("broadcast", { event: "read" }, ({ payload }) => {
        const p = payload as { conversationId: string; userId: string; readAt: string };
        emit({ type: "read", conversationId: p.conversationId, userId: p.userId, readAt: p.readAt });
      })
      .on("broadcast", { event: "group" }, ({ payload }) => {
        const p = payload as { conversationId: string };
        emit({ type: "group", conversationId: p.conversationId });
      })
      .subscribe(status => watchStatus(String(status)));
    scheduleRefresh(current, config.expiresIn);
  } catch {
    // Realtime is an enhancement. Counts still refresh by polling in the app shell, and open chats resync on their own timer.
  }
}

// Joins a recipient's private topic once and reuses it. Resolves null when the person cannot be reached.
function peerChannel(userId: string): Promise<RealtimeChannel | null> {
  const existing = peerChannels.get(userId);
  if (existing) return existing;
  const supabase = client;
  if (!supabase) return Promise.resolve(null);

  const pending = new Promise<RealtimeChannel | null>(resolve => {
    const ch = supabase.channel(topicFor(userId), channelOptions);
    let settled = false;
    const drop = () => {
      if (peerChannels.get(userId) === pending) peerChannels.delete(userId);
      void supabase.removeChannel(ch);
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      drop();
      resolve(null);
    }, JOIN_TIMEOUT_MS);
    ch.subscribe(status => {
      const state = String(status);
      if (state === "SUBSCRIBED") {
        if (!settled) { settled = true; window.clearTimeout(timer); resolve(ch); }
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        window.clearTimeout(timer);
        if (!settled) { settled = true; resolve(null); }
        // A channel that closes after joining is dropped, so the next send joins a fresh one.
        drop();
      }
    });
  });
  peerChannels.set(userId, pending);
  return pending;
}

// Joins the topics of people the viewer may message, ahead of the first send.
export function prepareDmPeers(userIds: string[]) {
  for (const id of userIds) void peerChannel(id);
}

async function sendTo(userId: string, event: string, payload: object): Promise<boolean> {
  const ch = await peerChannel(userId);
  if (!ch) return false;
  const status = await Promise.race([
    ch.send({ type: "broadcast", event, payload }),
    new Promise<string>(resolve => window.setTimeout(() => resolve("timeout"), LIVE_ACK_TIMEOUT_MS))
  ]);
  return status === "ok";
}

// Sends a new message to recipients who are online, before it is saved. True when at least one of them got it.
export async function sendLiveDm(conversationId: string, message: DmRow, recipientIds: string[]) {
  const sent = await Promise.all(recipientIds.map(id => sendTo(id, "message", { conversationId, message })));
  return sent.some(Boolean);
}

// Tells recipients to drop a message that failed to save, so nobody keeps a copy the database does not have.
export async function retractLiveDm(conversationId: string, messageId: string, recipientIds: string[]) {
  await Promise.all(recipientIds.map(id => sendTo(id, "unsend", { conversationId, messageId })));
}

// Tells other members about a read receipt, an edit, a reaction, an unsend or a group change.
// Members who are offline catch up on their next resync.
export function sendToPeers(recipientIds: string[], event: string, payload: object) {
  return Promise.all(recipientIds.map(id => sendTo(id, event, payload)));
}

function scheduleRefresh(current: number, expiresIn: number) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(async () => {
    if (current !== generation || !client) return;
    try {
      const config = await api<RealtimeConfig>("/dm/realtime-token");
      if (current !== generation || !client) return;
      client.realtime.setAuth(config.token);
      scheduleRefresh(current, config.expiresIn);
    } catch {
      scheduleRefresh(current, 60);
    }
  }, Math.max(60, expiresIn - 300) * 1000);
}
