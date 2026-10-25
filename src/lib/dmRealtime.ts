import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { api } from "./api";

export type DmRow = { id: string; conversation_id: string; sender_id: string; created_at: string; kind?: string | null; body?: string | null };
export type DmEvent =
  | { type: "message"; conversationId: string; message: DmRow }
  | { type: "membership"; conversationId: string };

type Listener = (event: DmEvent) => void;
type RealtimeConfig = { url: string; anonKey: string; token: string; expiresIn: number };

const listeners = new Set<Listener>();
let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let refreshTimer: number | undefined;
// Bumped on every start/stop so a slow start cannot attach a stale channel after a newer start or a stop.
let generation = 0;

export function onDmEvent(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(event: DmEvent) {
  listeners.forEach(listener => listener(event));
}

export function stopDmRealtime() {
  generation += 1;
  window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
  if (client && channel) void client.removeChannel(channel);
  client = null;
  channel = null;
}

// Subscribes to INSERTs on dm_messages and dm_members. RLS limits events to the signed-in user's conversations.
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
      .subscribe();
    scheduleRefresh(current, config.expiresIn);
  } catch {
    // Realtime is an enhancement. Counts still refresh by polling in the app shell.
  }
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
