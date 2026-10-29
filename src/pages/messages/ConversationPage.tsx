import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, CornerUpLeft, ImagePlus, LoaderCircle, LogOut, MessageCircle, Pencil, X } from "lucide-react";
import Avatar from "../../components/Avatar";
import RichText from "../../components/RichText";
import { api, withTimeout } from "../../lib/api";
import { onDmEvent, prepareDmPeers, retractLiveDm, sendLiveDm, sendToPeers } from "../../lib/dmRealtime";
import type { DmRow } from "../../lib/dmRealtime";
import { errorMessage } from "../../lib/errors";
import { optimizeImage } from "../../lib/images";
import type { DmDetailConversation, DmMember, DmMessage, DmReaction, User } from "../../types";
import GroupInfoSheet from "./GroupInfoSheet";
import NewMessageSheet from "./NewMessageSheet";
import MessageMenu from "./MessageMenu";
import { chatStamp, GROUP_GAP_MS, STAMP_GAP_MS } from "./dmFormat";
import "./dm-actions.css";
import "./dm-motion.css";

type Detail = {
  conversation: DmDetailConversation;
  messages: DmMessage[];
  hasMore: boolean;
};

type Props = {
  user: User;
  conversationId: string;
  onBack: () => void;
  onCountsChanged: () => void;
  onNotice: (text: string) => void;
  onOpenProfile: (userId: string) => void;
  // A note quoted from the messages list. Put into the composer, ready to send.
  quote?: { text: string } | null;
};

type Row =
  | { kind: "stamp"; key: string; at: string }
  | { kind: "message"; key: string; message: DmMessage; first: boolean; last: boolean };

const MAX_TEXT_LENGTH = 1000;
// Holding a message this long opens its action sheet.
const LONG_PRESS_MS = 450;
// While the chat is open, it re-reads the newest page this often, as a safety net for missed realtime events.
const RESYNC_EVERY_MS = 10_000;
// A resync that has not finished by then is abandoned, so a stalled request cannot freeze later updates.
const RESYNC_DEADLINE_MS = 8_000;


// Realtime rows and API rows share this shape. Anything that is not kind "text" is a photo.
function fromRow(row: DmRow): DmMessage {
  const isText = row.kind === "text";
  return {
    id: row.id,
    sender_id: row.sender_id,
    created_at: row.created_at,
    kind: isText ? "text" : "image",
    body: isText ? (row.body ?? "") : null,
    image_url: isText ? null : `/api/dm/messages/${row.id}/image`,
    reply_to: row.reply_to ?? null,
    edited_at: null,
    reactions: []
  };
}

// Adds time separators and marks where a run of messages from one sender starts and ends.
function buildRows(messages: DmMessage[]): Row[] {
  const gaps = messages.map((m, i) => (i === 0 ? Infinity : Date.parse(m.created_at) - Date.parse(messages[i - 1].created_at)));
  const breaksBefore = (i: number) => gaps[i] > STAMP_GAP_MS;
  const joins = (i: number) => i > 0 && !breaksBefore(i) && messages[i - 1].sender_id === messages[i].sender_id && gaps[i] <= GROUP_GAP_MS;

  const rows: Row[] = [];
  messages.forEach((message, i) => {
    if (breaksBefore(i)) rows.push({ kind: "stamp", key: `stamp-${message.id}`, at: message.created_at });
    rows.push({ kind: "message", key: message.id, message, first: !joins(i), last: !(i + 1 < messages.length && joins(i + 1)) });
  });
  return rows;
}

// How many other members had read this message. A member counts only if they were in the chat when it was sent.
function readCount(message: DmMessage, members: DmMember[]) {
  const sentAt = Date.parse(message.created_at);
  return members.filter(p =>
    p.id !== message.sender_id
    && p.last_read_at
    && Date.parse(p.last_read_at) >= sentAt
    && (!p.joined_at || Date.parse(p.joined_at) <= sentAt)
  ).length;
}

const isLater = (at: string, than: string | null | undefined) => !than || Date.parse(at) > Date.parse(than);

// The short text shown for a message in a reply quote or the composer bar.
const quoteText = (m: DmMessage) => (m.kind === "image" ? "写真" : (m.body ?? "").slice(0, 40));

// Reactions grouped by emoji, with how many people chose each and whether the viewer is one of them.
function reactionGroups(reactions: DmReaction[] | undefined, myId: string) {
  const groups = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of reactions ?? []) {
    const group = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    group.count += 1;
    if (r.user_id === myId) group.mine = true;
    groups.set(r.emoji, group);
  }
  return [...groups.values()];
}

// Brings the open chat up to date with the server: new and edited messages, reactions, and removed (unsent) ones.
// Only the newest page is compared, so older pages already on screen are kept as they are.
// Messages still being sent (keepIds) are kept until the server confirms them.
function mergeDetail(prev: Detail, fresh: Detail, keepIds: Set<string>): Detail {
  const windowOldest = fresh.messages[0]?.created_at;
  const oldest = windowOldest ? Date.parse(windowOldest) : -Infinity;
  const freshIds = new Set(fresh.messages.map(m => m.id));
  const kept = prev.messages.filter(m => {
    if (freshIds.has(m.id)) return false;
    if (keepIds.has(m.id)) return true;
    return Date.parse(m.created_at) < oldest;
  });
  const olderLoaded = prev.messages.some(m => Date.parse(m.created_at) < oldest);
  const messages = [...kept, ...fresh.messages].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return { conversation: fresh.conversation, messages, hasMore: olderLoaded ? prev.hasMore : fresh.hasMore };
}

// One conversation: Instagram-style bubbles, text and photo messages, replies, edits, reactions, unsend, realtime updates, read receipts and group settings.
export default function ConversationPage({ user, conversationId, onBack, onCountsChanged, onNotice, onOpenProfile, quote }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null);
  const [editing, setEditing] = useState<DmMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<DmMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const detailRef = useRef<Detail | null>(null);
  const onlineRef = useRef<string[]>([]);
  // Ids of messages this browser is still sending. A resync must not drop them before the server confirms.
  const pendingRef = useRef<Set<string>>(new Set());
  // The text the user had typed before starting an edit, put back when the edit is cancelled.
  const stashRef = useRef("");
  const pressRef = useRef<{ x: number; y: number; timer?: number }>({ x: 0, y: 0 });
  // Set when a long press opens the sheet, so the click that follows the release does not open the photo.
  const suppressClickRef = useRef(false);
  const resyncingRef = useRef(false);
  const resyncStartedRef = useRef(0);
  // Ids of messages that arrived or were sent while the chat was open. They animate in once.
  const freshIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { detailRef.current = detail; }, [detail]);
  useEffect(() => { onlineRef.current = onlineIds; }, [onlineIds]);

  // A quoted note is added to the composer so the person can add a line and send it.
  useEffect(() => {
    if (!quote) return;
    setDraft(v => (v.trim() ? `${v}\n${quote.text}` : quote.text));
    inputRef.current?.focus();
  }, [quote]);

  const scrollBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const load = useCallback(async () => {
    try {
      setDetail(await api<Detail>(`/dm/conversations/${encodeURIComponent(conversationId)}`));
    } catch (e) {
      onNotice(errorMessage(e, "会話を開けませんでした"));
    } finally {
      setLoading(false);
    }
  }, [conversationId, onNotice]);

  // Refreshes the header data (name, icon, members, roles) and keeps the messages already on screen.
  const refreshConversation = useCallback(async () => {
    try {
      const fresh = await api<Detail>(`/dm/conversations/${encodeURIComponent(conversationId)}`);
      setDetail(prev => (prev ? { ...prev, conversation: fresh.conversation } : fresh));
    } catch (e) {
      onNotice(errorMessage(e, "会話情報を読み込めませんでした"));
    }
  }, [conversationId, onNotice]);

  // Reloads the newest page and merges it in. Catches anything the realtime connection missed.
  const resync = useCallback(async () => {
    // A resync still running past its deadline is treated as lost, so a stalled request cannot block the next one.
    if (resyncingRef.current && Date.now() - resyncStartedRef.current < RESYNC_DEADLINE_MS) return;
    resyncingRef.current = true;
    resyncStartedRef.current = Date.now();
    try {
      const fresh = await withTimeout(
        api<Detail>(`/dm/conversations/${encodeURIComponent(conversationId)}`),
        RESYNC_DEADLINE_MS
      );
      const keep = pendingRef.current;
      setDetail(prev => (prev ? mergeDetail(prev, fresh, keep) : prev));
    } catch {
      // Keep what is on screen. The next resync tries again.
    } finally {
      resyncingRef.current = false;
    }
  }, [conversationId]);

  // Coming back to this chat (focus, or the app returning to the front) refreshes it straight away.
  useEffect(() => {
    const onBack = () => { if (document.visibilityState === "visible") void resync(); };
    window.addEventListener("focus", onBack);
    window.addEventListener("pageshow", onBack);
    return () => {
      window.removeEventListener("focus", onBack);
      window.removeEventListener("pageshow", onBack);
    };
  }, [resync]);

  // Lets the other members know the group changed, so their open chat and inbox reload.
  const notifyGroup = useCallback(() => {
    const others = (detailRef.current?.conversation.members ?? []).filter(m => m.id !== user.id).map(m => m.id);
    if (others.length) void sendToPeers(others, "group", { conversationId });
  }, [conversationId, user.id]);

  const handleGroupChanged = useCallback(() => {
    void refreshConversation();
    notifyGroup();
  }, [refreshConversation, notifyGroup]);

  // Tells online members about a change to one message (edit, reaction, unsend), so their open chat updates at once.
  const notifyPeers = useCallback((event: string, payload: object) => {
    const peers = (detailRef.current?.conversation.members ?? [])
      .filter(m => m.id !== user.id && onlineRef.current.includes(m.id))
      .map(m => m.id);
    if (peers.length) void sendToPeers(peers, event, { conversationId, ...payload });
  }, [conversationId, user.id]);

  // Marks the chat read and tells online members when it happened, so their "既読" label updates at once.
  const markRead = useCallback(() => {
    api<{ last_read_at?: string }>(`/dm/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" })
      .then(r => {
        onCountsChanged();
        if (!r.last_read_at) return;
        const peers = (detailRef.current?.conversation.members ?? [])
          .filter(m => m.id !== user.id && onlineRef.current.includes(m.id))
          .map(m => m.id);
        if (peers.length) void sendToPeers(peers, "read", { conversationId, userId: user.id, readAt: r.last_read_at });
      })
      .catch(() => undefined);
  }, [conversationId, onCountsChanged, user.id]);

  const appendMessage = useCallback((message: DmMessage) => {
    freshIdsRef.current.add(message.id);
    setDetail(prev => prev && !prev.messages.some(m => m.id === message.id)
      ? { ...prev, messages: [...prev.messages, message] }
      : prev);
  }, []);

  const removeMessage = useCallback((messageId: string) => {
    setDetail(prev => prev && prev.messages.some(m => m.id === messageId)
      ? { ...prev, messages: prev.messages.filter(m => m.id !== messageId) }
      : prev);
  }, []);

  const patchMessage = useCallback((messageId: string, patch: Partial<DmMessage>) => {
    setDetail(prev => (prev
      ? { ...prev, messages: prev.messages.map(m => (m.id === messageId ? { ...m, ...patch } : m)) }
      : prev));
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().then(markRead);
  }, [load, markRead]);

  // Realtime: append and remove messages, apply edits, reactions and read receipts, reload the header on group changes,
  // and resync whenever the connection comes back or the app returns to the foreground.
  useEffect(() => onDmEvent(event => {
    if (event.type === "resync") {
      void resync();
      return;
    }
    if (event.type === "read") {
      if (event.conversationId !== conversationId) return;
      setDetail(prev => prev ? {
        ...prev,
        conversation: {
          ...prev.conversation,
          members: prev.conversation.members.map(m =>
            m.id === event.userId && isLater(event.readAt, m.last_read_at) ? { ...m, last_read_at: event.readAt } : m
          )
        }
      } : prev);
      return;
    }
    if (event.type === "group") {
      if (event.conversationId === conversationId) void refreshConversation();
      return;
    }
    if (event.conversationId !== conversationId) return;
    if (event.type === "unsend") {
      removeMessage(event.messageId);
      return;
    }
    if (event.type === "edit") {
      patchMessage(event.messageId, { body: event.body, edited_at: event.editedAt });
      return;
    }
    if (event.type === "react") {
      patchMessage(event.messageId, { reactions: event.reactions });
      return;
    }
    if (event.type !== "message") return;
    const incoming = fromRow(event.message);
    freshIdsRef.current.add(incoming.id);
    const current = detailRef.current;
    if (current && !current.conversation.members.some(m => m.id === incoming.sender_id)) {
      void load();
    } else {
      appendMessage(incoming);
    }
    if (incoming.sender_id !== user.id) markRead();
  }), [conversationId, load, markRead, refreshConversation, resync, appendMessage, removeMessage, patchMessage, user.id]);

  // Safety net: the open chat re-reads its newest page on a timer while the app is visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void resync();
    }, RESYNC_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [resync]);

  // Who is online in this conversation. Refreshed every 20 seconds; a send uses the latest answer.
  const onlineKey = onlineIds.join(",");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      api<{ online: string[] }>(`/dm/conversations/${encodeURIComponent(conversationId)}/presence`)
        .then(r => { if (alive) setOnlineIds(r.online.filter(id => id !== user.id)); })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 20_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [conversationId, user.id]);

  // Join the recipients' live channels ahead of the first send.
  useEffect(() => {
    if (onlineKey) prepareDmPeers(onlineKey.split(","));
  }, [onlineKey]);

  const messages = detail?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => { scrollBottom(); }, [lastId, scrollBottom]);

  // The input grows with its text, up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  const rows = useMemo(() => buildRows(messages), [messages]);
  const messageById = useMemo(() => new Map(messages.map(m => [m.id, m] as [string, DmMessage])), [messages]);

  // Swaps the message that was shown while sending for the copy the server saved. A realtime copy of the same message is not shown twice.
  const replaceMessage = useCallback((oldId: string, saved: DmMessage) => {
    setDetail(prev => {
      if (!prev) return prev;
      if (!prev.messages.some(m => m.id === oldId)) {
        return prev.messages.some(m => m.id === saved.id) ? prev : { ...prev, messages: [...prev.messages, saved] };
      }
      const messages = prev.messages
        .filter(m => m.id === oldId || m.id !== saved.id)
        .map(m => (m.id === oldId ? saved : m));
      return { ...prev, messages };
    });
  }, []);

  // Takes a message that did not send back into the composer, so typed text is never lost. Photos are dropped and the person picks again.
  const restoreFailed = (message: DmMessage) => {
    pendingRef.current.delete(message.id);
    removeMessage(message.id);
    if (message.kind === "image") {
      if (message.image_url?.startsWith("blob:")) URL.revokeObjectURL(message.image_url);
      onNotice("写真を送信できませんでした。もう一度選んでください。");
      return;
    }
    const text = message.body ?? "";
    setDraft(v => (v.trim() ? `${v}\n${text}` : text));
    inputRef.current?.focus();
  };

  // The message appears at once with a "sending" mark. Online recipients get it over the socket, and the save confirms it.
  // A message that fails stays on screen as "not sent" until the person puts it back in the composer.
  const sendText = async () => {
    if (editing) return void saveEdit();
    const body = draft.trim();
    if (!body) return;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const replyId = replyTo?.id ?? null;
    const recipients = (detail?.conversation.members ?? [])
      .filter(m => m.id !== user.id && onlineIds.includes(m.id))
      .map(m => m.id);

    pendingRef.current.add(id);
    appendMessage({ id, sender_id: user.id, created_at: createdAt, kind: "text", body, image_url: null, reply_to: replyId, edited_at: null, reactions: [], status: "sending" });
    setDraft("");
    setReplyTo(null);

    const live = recipients.length > 0
      ? sendLiveDm(conversationId, { id, conversation_id: conversationId, sender_id: user.id, created_at: createdAt, kind: "text", body, reply_to: replyId }, recipients).catch(() => false)
      : Promise.resolve(false);
    try {
      const r = await api<{ message: DmMessage }>(`/dm/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ id, body, replyTo: replyId })
      });
      replaceMessage(id, r.message);
      pendingRef.current.delete(id);
    } catch (e) {
      patchMessage(id, { status: "failed" });
      onNotice(errorMessage(e, "メッセージを送信できませんでした"));
      // Members who already saw it over the socket are told to drop it, so nobody keeps a copy the database does not have.
      void live.then(shown => { if (shown) void retractLiveDm(conversationId, id, recipients); });
    } finally {
      inputRef.current?.focus();
    }
  };

  // Saves an edited text message. Members who are online see the change at once.
  const saveEdit = async () => {
    const target = editing;
    const body = draft.trim();
    if (!target || !body || sending) return;
    if (body === target.body) {
      cancelEdit();
      return;
    }
    setSending(true);
    try {
      const r = await api<{ message: { id: string; body: string; edited_at: string } }>(
        `/dm/messages/${encodeURIComponent(target.id)}`,
        { method: "PATCH", body: JSON.stringify({ body }) }
      );
      patchMessage(target.id, { body: r.message.body, edited_at: r.message.edited_at });
      notifyPeers("edit", { messageId: target.id, body: r.message.body, editedAt: r.message.edited_at });
      setEditing(null);
      setDraft(stashRef.current);
      stashRef.current = "";
    } catch (e) {
      onNotice(errorMessage(e, "編集できませんでした"));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft(stashRef.current);
    stashRef.current = "";
  };

  const startEdit = (message: DmMessage) => {
    if (!editing) stashRef.current = draft;
    setReplyTo(null);
    setEditing(message);
    setDraft(message.body ?? "");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const startReply = (message: DmMessage) => {
    if (editing) cancelEdit();
    setReplyTo(message);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const toggleReaction = async (message: DmMessage, emoji: string) => {
    try {
      const r = await api<{ reactions: DmReaction[] }>(
        `/dm/messages/${encodeURIComponent(message.id)}/reactions`,
        { method: "POST", body: JSON.stringify({ emoji }) }
      );
      patchMessage(message.id, { reactions: r.reactions });
      notifyPeers("react", { messageId: message.id, reactions: r.reactions });
    } catch (e) {
      onNotice(errorMessage(e, "リアクションできませんでした"));
    }
  };

  const unsend = async (message: DmMessage) => {
    if (!confirm("このメッセージの送信を取り消しますか？")) return;
    try {
      await api(`/dm/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
      removeMessage(message.id);
      notifyPeers("unsend", { messageId: message.id });
      onCountsChanged();
    } catch (e) {
      onNotice(errorMessage(e, "送信を取り消せませんでした"));
    }
  };

  const copyMessage = async (message: DmMessage) => {
    const text = message.body ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API is unavailable on some non-HTTPS or older browsers; fall back to a selected textarea.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (!copied) {
        onNotice("コピーできませんでした。");
        return;
      }
    }
    onNotice("コピーしました。");
  };

  // Scrolls to the message a reply quote points at and briefly highlights it.
  const jumpTo = (messageId: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("is-flash");
    window.setTimeout(() => el.classList.remove("is-flash"), 1000);
  };

  // iOS keeps the page scrolled up while the keyboard is open. When it closes, that leaves an empty strip under the composer.
  const resetViewportAfterKeyboard = () => {
    window.setTimeout(() => {
      window.scrollTo(0, 0);
      document.scrollingElement?.scrollTo(0, 0);
    }, 50);
  };

  // Long press (touch or mouse) on a message opens its action sheet. Moving the finger cancels it, so scrolling still works.
  const cancelPress = () => {
    window.clearTimeout(pressRef.current.timer);
    pressRef.current.timer = undefined;
  };
  const startPress = (message: DmMessage, e: ReactPointerEvent) => {
    cancelPress();
    // A message that is still sending has no saved copy yet, so it has no actions.
    if (message.status) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    suppressClickRef.current = false;
    pressRef.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        pressRef.current.timer = undefined;
        suppressClickRef.current = true;
        setMenuMessage(message);
      }, LONG_PRESS_MS)
    };
  };
  const movePress = (e: ReactPointerEvent) => {
    const p = pressRef.current;
    if (p.timer !== undefined && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
  };

  // Enter sends; Shift+Enter starts a new line. IME composition keeps its own Enter. Escape leaves reply or edit mode.
  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (editing) cancelEdit();
      else if (replyTo) setReplyTo(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void sendText();
    }
  };

  const sendPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return onNotice("画像ファイルを選択してください。");
    const replyId = replyTo?.id ?? null;
    const tempId = crypto.randomUUID();
    // The photo appears straight away from the local file, and is swapped for the saved one when the upload finishes.
    const previewUrl = URL.createObjectURL(file);
    pendingRef.current.add(tempId);
    appendMessage({ id: tempId, sender_id: user.id, created_at: new Date().toISOString(), kind: "image", body: null, image_url: previewUrl, reply_to: replyId, edited_at: null, reactions: [], status: "sending" });
    setReplyTo(v => (v?.id === replyId ? null : v));
    try {
      const body = new FormData();
      body.append("file", await optimizeImage(file, 1920));
      if (replyId) body.append("replyTo", replyId);
      const r = await api<{ message: DmMessage }>(`/dm/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body });
      replaceMessage(tempId, r.message);
      pendingRef.current.delete(tempId);
      URL.revokeObjectURL(previewUrl);
    } catch (err) {
      patchMessage(tempId, { status: "failed" });
      onNotice(errorMessage(err, "画像を送信できませんでした"));
    }
  };

  const leave = async () => {
    if (!confirm("このグループから退出しますか？")) return;
    try {
      await api(`/dm/conversations/${encodeURIComponent(conversationId)}/leave`, { method: "POST" });
      notifyGroup();
      onCountsChanged();
      onBack();
    } catch (e) {
      onNotice(errorMessage(e, "退出できませんでした"));
    }
  };

  const loadOlder = async () => {
    if (!detail?.messages.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const oldest = detail.messages[0].created_at;
      const r = await api<Detail>(`/dm/conversations/${encodeURIComponent(conversationId)}?before=${encodeURIComponent(oldest)}`);
      setDetail(prev => prev ? { ...prev, messages: [...r.messages, ...prev.messages], hasMore: r.hasMore } : prev);
    } catch (e) {
      onNotice(errorMessage(e, "古いメッセージを読み込めませんでした"));
    } finally {
      setLoadingOlder(false);
    }
  };

  if (!detail) {
    return (
      <section className="dm-pane dm-pane-empty">
        {loading
          ? <div className="dm-state"><LoaderCircle className="spin" size={22} /></div>
          : (
            <>
              <h3>会話を開けませんでした</h3>
              <button type="button" className="dm-primary-btn" onClick={onBack}>メッセージに戻る</button>
            </>
          )}
      </section>
    );
  }

  const { conversation, hasMore } = detail;
  const people = new Map<string, DmMember>(conversation.members.map(m => [m.id, m] as [string, DmMember]));
  const others = conversation.members.filter(m => m.id !== user.id);
  const title = conversation.title || others.map(m => m.display_name).join("、") || "自分だけのチャット";
  const subtitle = conversation.is_group ? `${conversation.members.length}人のグループ` : "SoraLink";
  const partner = !conversation.is_group ? others[0] : undefined;
  const avatarUrl = conversation.is_group ? (conversation.icon_url ?? null) : (partner?.avatar_url ?? null);
  // Only the newest message I sent shows a read receipt, as in Instagram.
  const lastMine = [...messages].reverse().find(m => m.sender_id === user.id);
  const replyName = (m: DmMessage) => people.get(m.sender_id)?.display_name ?? "退会したユーザー";

  return (
    <section className="dm-pane">
      <header className="dm-chat-head">
        <button type="button" className="dm-icon-btn dm-back" onClick={onBack} aria-label="メッセージ一覧に戻る"><ChevronLeft size={26} /></button>
        <button
          type="button"
          className="dm-head-person"
          onClick={() => (conversation.is_group ? setInfoOpen(true) : partner && onOpenProfile(partner.id))}
          disabled={!conversation.is_group && !partner}
          aria-label={conversation.is_group ? "グループ情報を開く" : partner ? `${partner.display_name}のプロフィールを開く` : undefined}
        >
          <Avatar url={avatarUrl} name={title} size="small" />
          <span className="dm-head-text">
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
        </button>
        {conversation.is_group && (
          <button type="button" className="dm-icon-btn" onClick={() => void leave()} aria-label="グループから退出" title="グループから退出"><LogOut size={19} /></button>
        )}
      </header>

      <div className="dm-messages" ref={listRef}>
        {hasMore && (
          <button type="button" className="dm-text-btn dm-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? "読み込み中…" : "前のメッセージを読む"}
          </button>
        )}

        {!hasMore && (
          <div className="dm-intro">
            <Avatar url={avatarUrl} name={title} size="large" />
            <strong>{title}</strong>
            <small>{conversation.is_group ? subtitle : `${title} · SoraLink`}</small>
            {conversation.is_group && conversation.description && <p className="dm-intro-desc">{conversation.description}</p>}
            {partner && (
              <button type="button" className="dm-outline-btn" onClick={() => onOpenProfile(partner.id)}>プロフィールを見る</button>
            )}
            {conversation.is_group && (
              <button type="button" className="dm-outline-btn" onClick={() => setInfoOpen(true)}>グループ情報</button>
            )}
          </div>
        )}

        {rows.map(row => {
          if (row.kind === "stamp") {
            return <time key={row.key} className="dm-stamp" dateTime={row.at}>{chatStamp(row.at)}</time>;
          }
          const { message, first, last } = row;
          const mine = message.sender_id === user.id;
          const isNew = freshIdsRef.current.has(message.id);
          const sender = people.get(message.sender_id);
          const isPhoto = message.kind === "image" && message.image_url;
          const isReceiptTarget = mine && lastMine?.id === message.id && !message.status;
          const readers = isReceiptTarget ? readCount(message, conversation.members) : 0;
          const quoted = message.reply_to ? messageById.get(message.reply_to) : undefined;
          const groups = reactionGroups(message.reactions, user.id);
          return (
            <div key={row.key} data-mid={message.id} className={`dm-msg ${mine ? "mine" : "theirs"} ${first ? "first" : ""} ${last ? "last" : ""} ${isNew ? "is-new" : ""} ${message.status ? `is-${message.status}` : ""}`}>
              {!mine && (
                <span className="dm-msg-avatar" aria-hidden={!last}>
                  {last && <Avatar url={sender?.avatar_url ?? null} name={sender?.display_name ?? ""} size="small" />}
                </span>
              )}
              <div className="dm-msg-col">
                {!mine && conversation.is_group && first && (
                  <small className="dm-msg-name">{sender?.display_name ?? "退会したユーザー"}</small>
                )}
                {message.reply_to && (
                  <button type="button" className="dm-quote" onClick={() => jumpTo(message.reply_to!)}>
                    <strong>{quoted ? replyName(quoted) : "返信"}</strong>
                    <span>{quoted ? quoteText(quoted) : "返信元のメッセージ"}</span>
                  </button>
                )}
                {isPhoto ? (
                  <a
                    className="dm-photo"
                    href={message.image_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="画像を開く"
                    onClick={e => { if (suppressClickRef.current) { e.preventDefault(); suppressClickRef.current = false; } }}
                    onPointerDown={e => startPress(message, e)}
                    onPointerMove={movePress}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={e => { e.preventDefault(); if (!message.status) setMenuMessage(message); }}
                  >
                    <img
                      src={message.image_url!}
                      alt="送信された画像"
                      loading="lazy"
                      decoding="async"
                      onLoad={() => { if (message.id === lastId) scrollBottom(); }}
                    />
                  </a>
                ) : (
                  <p
                    className="dm-bubble"
                    onPointerDown={e => startPress(message, e)}
                    onPointerMove={movePress}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={e => { e.preventDefault(); if (!message.status) setMenuMessage(message); }}
                  >
                    <span
                      onClickCapture={e => {
                        // A long press that opened the action sheet must not also open a link under the finger.
                        if (suppressClickRef.current) { e.preventDefault(); e.stopPropagation(); suppressClickRef.current = false; }
                      }}
                    >
                      <RichText text={message.body ?? ""} />
                    </span>
                  </p>
                )}
                {groups.length > 0 && (
                  <div className={`dm-reactions ${mine ? "mine" : ""}`}>
                    {groups.map(g => (
                      <button
                        key={g.emoji}
                        type="button"
                        className={`dm-reaction ${g.mine ? "is-mine" : ""}`}
                        onClick={() => void toggleReaction(message, g.emoji)}
                        aria-label={`${g.emoji} ${g.count}件`}
                      >
                        {g.emoji}{g.count > 1 && <span>{g.count}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {message.edited_at && <small className="dm-edited">編集済み</small>}
                {message.status === "sending" && <small className="dm-status">送信中…</small>}
                {message.status === "failed" && (
                  <button type="button" className="dm-status dm-status-failed" onClick={() => restoreFailed(message)}>
                    送信できませんでした。タップして入力に戻す
                  </button>
                )}
                {isReceiptTarget && (
                  <small
                    className={`dm-receipt ${readers > 0 ? "is-read" : ""}`}
                    title={conversation.is_group && readers > 0 ? `${readers}人が既読` : undefined}
                  >
                    {readers === 0 ? "送信済み" : conversation.is_group ? `既読 ${readers}` : "既読"}
                  </small>
                )}
              </div>
            </div>
          );
        })}

        {messages.length === 0 && (
          <div className="dm-first-hint"><MessageCircle size={18} /><span>最初のメッセージを送ってみましょう</span></div>
        )}
      </div>

      <div className="dm-compose-wrap">
        {(replyTo || editing) && (
          <div className="dm-composer-mode">
            {editing ? <Pencil size={15} /> : <CornerUpLeft size={15} />}
            <div className="dm-composer-mode-text">
              <strong>{editing ? "メッセージを編集" : `${replyName(replyTo!)}に返信`}</strong>
              <span>{editing ? (editing.body ?? "") : quoteText(replyTo!)}</span>
            </div>
            <button
              type="button"
              className="dm-icon-btn"
              onClick={editing ? cancelEdit : () => setReplyTo(null)}
              aria-label={editing ? "編集を取り消す" : "返信を取り消す"}
            >
              <X size={16} />
            </button>
          </div>
        )}

        <footer className="dm-composer">
          <button
            type="button"
            className="dm-icon-btn dm-photo-btn"
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(editing)}
            aria-label="写真を送信"
            title="写真を送信"
          >
            <ImagePlus size={22} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="visually-hidden"
            onChange={e => void sendPhoto(e)}
          />
          <div className="dm-input-pill">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_TEXT_LENGTH}
              placeholder={editing ? "メッセージを編集…" : "メッセージを入力…"}
              aria-label="メッセージ"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onInputKey}
              onBlur={resetViewportAfterKeyboard}
            />
            {draft.trim() && (
              <button type="button" className="dm-send-text" onClick={() => void sendText()} disabled={sending}>
                {sending ? <LoaderCircle size={15} className="spin" /> : editing ? "保存" : "送信"}
              </button>
            )}
          </div>
        </footer>
      </div>

      {menuMessage && createPortal(
        <MessageMenu
          message={menuMessage}
          mine={menuMessage.sender_id === user.id}
          onClose={() => setMenuMessage(null)}
          onReact={emoji => void toggleReaction(menuMessage, emoji)}
          onReply={() => startReply(menuMessage)}
          onCopy={() => void copyMessage(menuMessage)}
          onEdit={() => startEdit(menuMessage)}
          onUnsend={() => void unsend(menuMessage)}
        />,
        document.body
      )}

      {infoOpen && conversation.is_group && (
        <GroupInfoSheet
          meId={user.id}
          conversation={conversation}
          onClose={() => setInfoOpen(false)}
          onChanged={handleGroupChanged}
          onAddMembers={() => setAdding(true)}
          onLeave={() => void leave()}
          onNotice={onNotice}
        />
      )}

      {adding && conversation.is_group && (
        <NewMessageSheet
          addTo={{ conversationId, existingIds: conversation.members.map(m => m.id) }}
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); handleGroupChanged(); }}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}

// Shown on desktop when no conversation is open.
export function DmEmptyPane() {
  return (
    <section className="dm-pane dm-pane-empty">
      <span className="dm-empty-icon"><MessageCircle size={56} strokeWidth={1.2} /></span>
      <h3>あなたのメッセージ</h3>
      <p>友達やグループとメッセージや写真を送り合えます。</p>
    </section>
  );
}
