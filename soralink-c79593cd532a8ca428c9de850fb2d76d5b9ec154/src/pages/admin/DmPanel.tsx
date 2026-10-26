import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, LoaderCircle, Search } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { AdminDmConversation, AdminDmDetail, AdminDmMember } from "../../types";
import { formatAdminDate } from "./adminFormat";

type Props = { initialUserId: string; onNotice: (text: string) => void };

const namesOf = (members: AdminDmMember[]) => members.map(m => m.display_name).join("・") || "会話";

// DM tab: every conversation on the site (or only one user's, when filtered). Each open is recorded in the audit log.
export default function DmPanel({ initialUserId, onNotice }: Props) {
  const [input, setInput] = useState(initialUserId);
  const [userFilter, setUserFilter] = useState(initialUserId);
  const [conversations, setConversations] = useState<AdminDmConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const r = await api<{ conversations: AdminDmConversation[] }>(`/admin/dm/conversations${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);
      setConversations(r.conversations);
    } catch (e) {
      onNotice(errorMessage(e, "DMを読み込めませんでした。"));
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    if (!openId) void load(userFilter);
  }, [userFilter, openId, load]);

  if (openId) return <DmThread conversationId={openId} onBack={() => setOpenId(null)} onNotice={onNotice} />;

  return (
    <section className="admin-card">
      <p className="admin-muted small">DMの閲覧はすべて操作ログに記録されます。</p>
      <form className="admin-search" onSubmit={(e: FormEvent) => { e.preventDefault(); setUserFilter(input.trim()); }}>
        <Search size={16} />
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="ユーザーIDで絞り込み（空欄で全件）" aria-label="ユーザーIDで絞り込み" />
        <button type="submit" className="outline-small">絞り込む</button>
      </form>
      {loading ? (
        <div className="admin-loading"><LoaderCircle className="spin" size={16} />読み込み中…</div>
      ) : conversations.length ? (
        <ul className="admin-list">
          {conversations.map(c => (
            <li key={c.id}>
              <button type="button" className="admin-row" onClick={() => setOpenId(c.id)}>
                <span className="admin-row-main">
                  <strong>{c.title || namesOf(c.members)}</strong>
                  <small className="admin-muted">{c.last_sender_name ? `${c.last_sender_name}: ` : ""}{c.last_preview ?? "（メッセージなし）"}</small>
                </span>
                <small className="admin-muted">{formatAdminDate(c.last_message_at)}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-muted">会話はありません。</p>
      )}
    </section>
  );
}

// One conversation, read-only. Older messages load on request.
function DmThread({ conversationId, onBack, onNotice }: { conversationId: string; onBack: () => void; onNotice: (text: string) => void }) {
  const [detail, setDetail] = useState<AdminDmDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const path = `/admin/dm/conversations/${encodeURIComponent(conversationId)}`;

  useEffect(() => {
    setLoading(true);
    api<AdminDmDetail>(path)
      .then(setDetail)
      .catch(e => onNotice(errorMessage(e, "会話を読み込めませんでした。")))
      .finally(() => setLoading(false));
  }, [path, onNotice]);

  const loadOlder = async () => {
    if (!detail?.messages.length) return;
    setLoadingMore(true);
    try {
      const before = detail.messages[0].created_at;
      const r = await api<AdminDmDetail>(`${path}?before=${encodeURIComponent(before)}`);
      setDetail(current => current ? { ...current, messages: [...r.messages, ...current.messages], hasMore: r.hasMore } : current);
    } catch (e) {
      onNotice(errorMessage(e, "過去のメッセージを読み込めませんでした。"));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="admin-card">
      <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={16} />会話一覧に戻る</button>
      {loading || !detail ? (
        <div className="admin-loading"><LoaderCircle className="spin" size={16} />読み込み中…</div>
      ) : (
        <>
          <header className="admin-thread-head">
            <h3>{detail.conversation.title || namesOf(detail.conversation.members)}</h3>
            <p className="admin-muted small">
              {detail.conversation.is_group ? "グループ" : "1対1"} ・ 参加者: {namesOf(detail.conversation.members)}
            </p>
          </header>
          {detail.hasMore && (
            <div className="admin-actions-row">
              <button type="button" className="outline-small" onClick={() => void loadOlder()} disabled={loadingMore}>
                {loadingMore ? "読み込み中…" : "過去のメッセージを読み込む"}
              </button>
            </div>
          )}
          <div className="admin-thread">
            {detail.messages.length ? detail.messages.map(m => (
              <div key={m.id} className="admin-bubble-row">
                <div className="admin-bubble-meta">
                  <strong>{m.sender_name}</strong>
                  <small>{formatAdminDate(m.created_at)}</small>
                </div>
                {m.kind === "image" && m.image_url
                  ? <img className="admin-dm-image" src={m.image_url} alt="送信された画像" loading="lazy" />
                  : <p className="admin-bubble">{m.body}</p>}
              </div>
            )) : <p className="admin-muted">メッセージはありません。</p>}
          </div>
        </>
      )}
    </section>
  );
}
