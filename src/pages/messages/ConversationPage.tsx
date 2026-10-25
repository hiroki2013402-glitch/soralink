import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ChevronLeft, ImagePlus, LoaderCircle, LogOut, MessageCircle } from "lucide-react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";
import { onDmEvent } from "../../lib/dmRealtime";
import { errorMessage } from "../../lib/errors";
import { optimizeImage } from "../../lib/images";
import type { DmMember, DmMessage, User } from "../../types";
import { chatStamp, GROUP_GAP_MS, STAMP_GAP_MS } from "./dmFormat";

type Detail = {
  conversation: { id: string; is_group: boolean; title: string | null; members: DmMember[] };
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
};

type Row =
  | { kind: "stamp"; key: string; at: string }
  | { kind: "message"; key: string; message: DmMessage; first: boolean; last: boolean };

const MAX_TEXT_LENGTH = 1000;

// Realtime rows and API rows share this shape. Anything that is not kind "text" is a photo.
function fromRow(row: { id: string; sender_id: string; created_at: string; kind?: string | null; body?: string | null }): DmMessage {
  const isText = row.kind === "text";
  return {
    id: row.id,
    sender_id: row.sender_id,
    created_at: row.created_at,
    kind: isText ? "text" : "image",
    body: isText ? (row.body ?? "") : null,
    image_url: isText ? null : `/api/dm/messages/${row.id}/image`
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

// One conversation: Instagram-style bubbles, text and photo messages, realtime updates.
export default function ConversationPage({ user, conversationId, onBack, onCountsChanged, onNotice, onOpenProfile }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const detailRef = useRef<Detail | null>(null);

  useEffect(() => { detailRef.current = detail; }, [detail]);

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

  const markRead = useCallback(() => {
    api(`/dm/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" })
      .then(() => onCountsChanged())
      .catch(() => undefined);
  }, [conversationId, onCountsChanged]);

  useEffect(() => {
    setLoading(true);
    void load().then(markRead);
  }, [load, markRead]);

  // Realtime: append messages from this conversation. Reload if the sender is not yet in the member list.
  useEffect(() => onDmEvent(event => {
    if (event.type !== "message" || event.conversationId !== conversationId) return;
    const incoming = fromRow(event.message);
    const current = detailRef.current;
    if (current && !current.conversation.members.some(m => m.id === incoming.sender_id)) {
      void load();
    } else {
      setDetail(prev => prev && !prev.messages.some(m => m.id === incoming.id)
        ? { ...prev, messages: [...prev.messages, incoming] }
        : prev);
    }
    if (incoming.sender_id !== user.id) markRead();
  }), [conversationId, load, markRead, user.id]);

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

  const appendMessage = (message: DmMessage) => {
    setDetail(prev => prev && !prev.messages.some(m => m.id === message.id)
      ? { ...prev, messages: [...prev.messages, message] }
      : prev);
  };

  const sendText = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api<{ message: DmMessage }>(`/dm/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body })
      });
      setDraft("");
      appendMessage(r.message);
    } catch (e) {
      onNotice(errorMessage(e, "メッセージを送信できませんでした"));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Enter sends; Shift+Enter starts a new line. IME composition keeps its own Enter.
  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    setSendingPhoto(true);
    try {
      const body = new FormData();
      body.append("file", await optimizeImage(file, 1920));
      const r = await api<{ message: DmMessage }>(`/dm/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body });
      appendMessage(r.message);
    } catch (err) {
      onNotice(errorMessage(err, "画像を送信できませんでした"));
    } finally {
      setSendingPhoto(false);
    }
  };

  const leave = async () => {
    if (!confirm("このグループから退出しますか？")) return;
    try {
      await api(`/dm/conversations/${encodeURIComponent(conversationId)}/leave`, { method: "POST" });
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

  return (
    <section className="dm-pane">
      <header className="dm-chat-head">
        <button type="button" className="dm-icon-btn dm-back" onClick={onBack} aria-label="メッセージ一覧に戻る"><ChevronLeft size={26} /></button>
        <button
          type="button"
          className="dm-head-person"
          onClick={() => partner && onOpenProfile(partner.id)}
          disabled={!partner}
          aria-label={partner ? `${partner.display_name}のプロフィールを開く` : undefined}
        >
          <Avatar url={partner?.avatar_url ?? null} name={title} size="small" />
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
            <Avatar url={partner?.avatar_url ?? null} name={title} size="large" />
            <strong>{title}</strong>
            <small>{conversation.is_group ? subtitle : `${title} · SoraLink`}</small>
            {partner && (
              <button type="button" className="dm-outline-btn" onClick={() => onOpenProfile(partner.id)}>プロフィールを見る</button>
            )}
          </div>
        )}

        {rows.map(row => {
          if (row.kind === "stamp") {
            return <time key={row.key} className="dm-stamp" dateTime={row.at}>{chatStamp(row.at)}</time>;
          }
          const { message, first, last } = row;
          const mine = message.sender_id === user.id;
          const sender = people.get(message.sender_id);
          const isPhoto = message.kind === "image" && message.image_url;
          return (
            <div key={row.key} className={`dm-msg ${mine ? "mine" : "theirs"} ${first ? "first" : ""} ${last ? "last" : ""}`}>
              {!mine && (
                <span className="dm-msg-avatar" aria-hidden={!last}>
                  {last && <Avatar url={sender?.avatar_url ?? null} name={sender?.display_name ?? ""} size="small" />}
                </span>
              )}
              <div className="dm-msg-col">
                {!mine && conversation.is_group && first && (
                  <small className="dm-msg-name">{sender?.display_name ?? "退会したユーザー"}</small>
                )}
                {isPhoto ? (
                  <a className="dm-photo" href={message.image_url!} target="_blank" rel="noopener noreferrer" aria-label="画像を開く">
                    <img
                      src={message.image_url!}
                      alt="送信された画像"
                      loading="lazy"
                      onLoad={() => { if (message.id === lastId) scrollBottom(); }}
                    />
                  </a>
                ) : (
                  <p className="dm-bubble">{message.body}</p>
                )}
              </div>
            </div>
          );
        })}

        {messages.length === 0 && (
          <div className="dm-first-hint"><MessageCircle size={18} /><span>最初のメッセージを送ってみましょう</span></div>
        )}
      </div>

      <footer className="dm-composer">
        <button
          type="button"
          className="dm-icon-btn dm-photo-btn"
          onClick={() => fileRef.current?.click()}
          disabled={sendingPhoto}
          aria-label="写真を送信"
          title="写真を送信"
        >
          {sendingPhoto ? <LoaderCircle size={20} className="spin" /> : <ImagePlus size={22} />}
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
            placeholder="メッセージを入力…"
            aria-label="メッセージ"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onInputKey}
          />
          {draft.trim() && (
            <button type="button" className="dm-send-text" onClick={() => void sendText()} disabled={sending}>
              {sending ? <LoaderCircle size={15} className="spin" /> : "送信"}
            </button>
          )}
        </div>
      </footer>
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
