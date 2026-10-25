import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle, MessageCircle, Search, Users, X } from "lucide-react";
import Avatar from "../../components/Avatar";
import CountBadge from "../../components/layout/CountBadge";
import { api } from "../../lib/api";
import { onDmEvent } from "../../lib/dmRealtime";
import { errorMessage } from "../../lib/errors";
import { timeAgo } from "../../lib/format";
import type { DmConversation, Person, User } from "../../types";

type Props = {
  user: User;
  counts: Record<string, number>;
  onOpenConversation: (id: string) => void;
  onNotice: (text: string) => void;
};

const MAX_OTHERS = 19; // a group holds at most 20 people including the creator

// Name shown for a conversation: the group title, or the other members' names.
const titleOf = (c: DmConversation, me: string) => {
  if (c.title) return c.title;
  const others = c.members.filter(m => m.id !== me);
  return others.map(m => m.display_name).join("、") || "自分だけのチャット";
};

// Direct and group chats, newest first, with unread counts per conversation.
export default function MessagesPage({ user, counts, onOpenConversation, onNotice }: Props) {
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ conversations: DmConversation[] }>("/dm/conversations");
      setConversations(r.conversations);
    } catch (e) {
      onNotice(errorMessage(e, "会話を読み込めませんでした"));
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { void load(); }, [load]);

  // New messages change previews and ordering; new memberships add conversations. Reload, lightly debounced.
  useEffect(() => {
    let timer: number | undefined;
    const off = onDmEvent(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 300);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [load]);

  return (
    <section className="page-panel dm-panel">
      <div className="dm-head">
        <div className="page-heading">
          <span className="eyebrow">MESSAGES</span>
          <h1>メッセージ</h1>
          <p>写真を送って、友達やグループとつながろう。</p>
        </div>
        <button className="primary-button" onClick={() => setComposing(v => !v)}>{composing ? "閉じる" : "新規作成"}</button>
      </div>

      {composing && (
        <NewConversation
          onCreated={id => { setComposing(false); onOpenConversation(id); }}
          onNotice={onNotice}
        />
      )}

      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" /><span>読み込み中…</span></div>
      ) : conversations.length ? (
        <div className="dm-list">
          {conversations.map(c => {
            const others = c.members.filter(m => m.id !== user.id);
            const unread = counts[c.id] ?? 0;
            return (
              <button key={c.id} className={`dm-row ${unread ? "unread" : ""}`} onClick={() => onOpenConversation(c.id)}>
                <span className="dm-avatar">
                  {c.is_group
                    ? <span className="dm-group-icon"><Users size={18} /></span>
                    : <Avatar url={others[0]?.avatar_url ?? null} name={others[0]?.display_name ?? ""} />}
                </span>
                <span className="dm-row-copy">
                  <strong>{titleOf(c, user.id)}</strong>
                  <small>{c.is_group ? `${c.members.length}人のグループ · ` : ""}{timeAgo(c.last_message_at)}</small>
                </span>
                <CountBadge count={unread} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-art"><MessageCircle size={26} /></div>
          <h3>まだメッセージはありません</h3>
          <p>「新規作成」から友達にメッセージを送りましょう。</p>
        </div>
      )}
    </section>
  );
}

// Pick one person for a 1:1 chat, or several (with an optional name) for a group.
function NewConversation({ onCreated, onNotice }: { onCreated: (id: string) => void; onNotice: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return setResults([]);
    try {
      const r = await api<{ users: Person[] }>(`/users/search?q=${encodeURIComponent(q)}`);
      setResults(r.users);
    } catch (err) {
      onNotice(errorMessage(err, "検索できませんでした"));
    }
  };

  const toggle = (person: Person) => {
    if (picked.some(p => p.id === person.id)) {
      setPicked(picked.filter(p => p.id !== person.id));
      return;
    }
    if (picked.length >= MAX_OTHERS) {
      onNotice(`一度に選べるのは${MAX_OTHERS}人までです。`);
      return;
    }
    setPicked([...picked, person]);
  };

  const create = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/dm/conversations", {
        method: "POST",
        body: JSON.stringify({ userIds: picked.map(p => p.id), title: picked.length > 1 ? title : "" })
      });
      onCreated(r.id);
    } catch (e) {
      onNotice(errorMessage(e, "会話を作成できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dm-compose">
      <form className="large-search" onSubmit={search}>
        <Search size={18} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ユーザー名で検索" />
        <button className="outline-small" type="submit">検索</button>
      </form>

      {picked.length > 0 && (
        <div className="dm-picked">
          {picked.map(p => (
            <button key={p.id} className="dm-chip" onClick={() => toggle(p)}>{p.display_name}<X size={13} /></button>
          ))}
        </div>
      )}

      <div className="people-list">
        {results.map(p => {
          const selected = picked.some(x => x.id === p.id);
          return (
            <div className="person-row" key={p.id}>
              <span className="plain-avatar"><Avatar url={p.avatar_url} name={p.display_name} /></span>
              <span className="person-info"><strong>{p.display_name}</strong><span>{p.bio || "SoraLinkを利用しています"}</span></span>
              <button className={selected ? "primary-button" : "outline-small"} onClick={() => toggle(p)}>{selected ? "選択中" : "追加"}</button>
            </div>
          );
        })}
      </div>

      {picked.length > 1 && (
        <input className="dm-title-input" value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="グループ名（任意）" />
      )}

      <button className="primary-button" disabled={!picked.length || busy} onClick={() => void create()}>
        {picked.length > 1 ? "グループを作成" : "チャットを始める"}
      </button>
    </div>
  );
}
