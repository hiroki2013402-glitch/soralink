import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ArrowLeft, ImagePlus, LoaderCircle, LogOut } from "lucide-react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";
import { onDmEvent } from "../../lib/dmRealtime";
import { errorMessage } from "../../lib/errors";
import { optimizeImage } from "../../lib/images";
import type { DmMember, DmMessage, User } from "../../types";

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
};

const imageUrl = (messageId: string) => `/api/dm/messages/${messageId}/image`;
const clock = (value: string) => new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

// One conversation: image bubbles, realtime updates, and image sending (text is not supported).
export default function ConversationPage({ user, conversationId, onBack, onCountsChanged, onNotice }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
    const incoming = event.message;
    const current = detailRef.current;
    if (current && !current.conversation.members.some(m => m.id === incoming.sender_id)) {
      void load();
    } else {
      setDetail(prev => prev && !prev.messages.some(m => m.id === incoming.id)
        ? {
          ...prev,
          messages: [...prev.messages, { id: incoming.id, sender_id: incoming.sender_id, created_at: incoming.created_at, image_url: imageUrl(incoming.id) }]
        }
        : prev);
    }
    if (incoming.sender_id !== user.id) markRead();
  }), [conversationId, load, markRead, user.id]);

  const lastId = detail?.messages[detail.messages.length - 1]?.id;
  useEffect(() => { scrollBottom(); }, [lastId, scrollBottom]);

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

  const sendImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return onNotice("画像ファイルを選択してください。");
    setSending(true);
    try {
      const body = new FormData();
      body.append("file", await optimizeImage(file, 1920));
      const r = await api<{ message: DmMessage }>(`/dm/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body });
      setDetail(prev => prev && !prev.messages.some(m => m.id === r.message.id)
        ? { ...prev, messages: [...prev.messages, r.message] }
        : prev);
    } catch (err) {
      onNotice(errorMessage(err, "画像を送信できませんでした"));
    } finally {
      setSending(false);
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

  if (!detail) {
    return (
      <section className="page-panel">
        {loading
          ? <div className="loading-state"><LoaderCircle className="spin" /><span>読み込み中…</span></div>
          : <div className="empty-state"><h3>会話を開けませんでした</h3><button className="primary-button" onClick={onBack}>メッセージに戻る</button></div>}
      </section>
    );
  }

  const { conversation, messages, hasMore } = detail;
  const people = new Map<string, DmMember>(conversation.members.map(m => [m.id, m] as [string, DmMember]));
  const others = conversation.members.filter(m => m.id !== user.id);
  const title = conversation.title || others.map(m => m.display_name).join("、") || "自分だけのチャット";

  return (
    <section className="dm-chat">
      <header className="dm-chat-head">
        <button className="icon-button" onClick={onBack} aria-label="メッセージ一覧に戻る"><ArrowLeft size={18} /></button>
        <div className="dm-chat-title">
          <strong>{title}</strong>
          <small>{conversation.is_group ? `${conversation.members.length}人のグループ` : "チャット"}</small>
        </div>
        {conversation.is_group && (
          <button className="icon-button" onClick={() => void leave()} aria-label="グループから退出"><LogOut size={17} /></button>
        )}
      </header>

      <div className="dm-messages" ref={listRef}>
        {hasMore && (
          <button className="outline-small dm-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? "読み込み中…" : "前のメッセージを読む"}
          </button>
        )}
        {messages.length === 0 && <p className="empty-inline">写真を送って会話を始めましょう。</p>}
        {messages.map(m => {
          const mine = m.sender_id === user.id;
          const sender = people.get(m.sender_id);
          return (
            <div key={m.id} className={`dm-bubble-row ${mine ? "mine" : ""}`}>
              {!mine && (
                <span className="dm-sender-avatar">
                  <Avatar url={sender?.avatar_url ?? null} name={sender?.display_name ?? ""} size="small" />
                </span>
              )}
              <div className="dm-bubble-col">
                {!mine && conversation.is_group && <small className="dm-sender-name">{sender?.display_name ?? "退会したユーザー"}</small>}
                <a className="dm-image" href={m.image_url} target="_blank" rel="noopener noreferrer" aria-label="画像を開く">
                  <img src={m.image_url} alt="送信された画像" loading="lazy" onLoad={() => { if (m.id === lastId) scrollBottom(); }} />
                </a>
                <time dateTime={m.created_at}>{clock(m.created_at)}</time>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="dm-composer">
        <button className="icon-button" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="画像を送信">
          {sending ? <LoaderCircle size={18} className="spin" /> : <ImagePlus size={19} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="visually-hidden"
          onChange={e => void sendImage(e)}
        />
        <p>画像を選ぶと送信されます</p>
      </footer>
    </section>
  );
}
