import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Search, SquarePen } from "lucide-react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";
import { onDmEvent } from "../../lib/dmRealtime";
import { errorMessage } from "../../lib/errors";
import type { DmConversation, DmNote, User } from "../../types";
import NewMessageSheet from "./NewMessageSheet";
import NotesRow from "./NotesRow";
import { shortAgo } from "./dmFormat";

type Props = {
  user: User;
  counts: Record<string, number>;
  selectedId?: string;
  onOpenConversation: (id: string) => void;
  onNotice: (text: string) => void;
};

// Name shown for a conversation: the group title, or the other members' names.
const titleOf = (c: DmConversation, me: string) => {
  if (c.title) return c.title;
  const others = c.members.filter(m => m.id !== me);
  return others.map(m => m.display_name).join("、") || "自分だけのチャット";
};

// Instagram-style inbox: header, search, notes, and the thread list with unread dots.
export default function MessagesPage({ user, counts, selectedId, onOpenConversation, onNotice }: Props) {
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState("");
  const [notes, setNotes] = useState<{ mine: DmNote | null; notes: DmNote[] }>({ mine: null, notes: [] });

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

  // Notes are a nice-to-have: a failure here should not hide the inbox.
  const loadNotes = useCallback(async () => {
    try {
      setNotes(await api<{ mine: DmNote | null; notes: DmNote[] }>("/dm/notes"));
    } catch {
      // Keep whatever was shown last.
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void loadNotes();
    const timer = window.setInterval(() => void loadNotes(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotes]);

  // New messages change previews and ordering; new memberships add conversations. Reload, lightly debounced.
  useEffect(() => {
    let timer: number | undefined;
    const off = onDmEvent(event => {
      // Read receipts do not change the inbox.
      if (event.type === "read") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 300);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [load]);

  // Opens (or reuses) a 1:1 chat with someone whose note was tapped.
  const startChat = async (userId: string) => {
    try {
      const r = await api<{ id: string }>("/dm/conversations", {
        method: "POST",
        body: JSON.stringify({ userIds: [userId], title: "" })
      });
      onOpenConversation(r.id);
    } catch (e) {
      onNotice(errorMessage(e, "会話を開けませんでした"));
    }
  };

  const query = filter.trim();
  const visible = query ? conversations.filter(c => titleOf(c, user.id).includes(query)) : conversations;

  return (
    <aside className="dm-inbox" aria-label="メッセージ一覧">
      <header className="dm-inbox-head">
        <h2>{user.display_name}</h2>
        <button type="button" className="dm-icon-btn" onClick={() => setComposing(true)} aria-label="新規メッセージ" title="新規メッセージ">
          <SquarePen size={23} />
        </button>
      </header>

      <label className="dm-search">
        <Search size={15} />
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="検索" aria-label="メッセージを検索" />
      </label>

      <NotesRow
        user={user}
        mine={notes.mine}
        notes={notes.notes}
        onOpenChat={id => void startChat(id)}
        onChanged={() => void loadNotes()}
        onNotice={onNotice}
      />

      <div className="dm-inbox-title"><strong>メッセージ</strong></div>

      {loading ? (
        <div className="dm-state"><LoaderCircle className="spin" size={20} /></div>
      ) : conversations.length === 0 ? (
        <div className="dm-welcome">
          <h3>メッセージを送信しましょう</h3>
          <p>友達やグループとメッセージや写真をやり取りできます。</p>
          <button type="button" className="dm-primary-btn" onClick={() => setComposing(true)}>メッセージを送信</button>
        </div>
      ) : visible.length === 0 ? (
        <p className="dm-state-text">一致する会話がありません</p>
      ) : (
        <ul className="dm-thread-list">
          {visible.map(c => (
            <li key={c.id}>
              <ThreadRow
                conversation={c}
                me={user.id}
                unread={counts[c.id] ?? 0}
                active={c.id === selectedId}
                onOpen={() => onOpenConversation(c.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {composing && (
        <NewMessageSheet
          onClose={() => setComposing(false)}
          onCreated={id => { setComposing(false); onOpenConversation(id); }}
          onNotice={onNotice}
        />
      )}
    </aside>
  );
}

function ThreadRow({ conversation: c, me, unread, active, onOpen }: {
  conversation: DmConversation;
  me: string;
  unread: number;
  active: boolean;
  onOpen: () => void;
}) {
  const others = c.members.filter(m => m.id !== me);
  const sender = c.members.find(m => m.id === c.last_sender_id);
  const who = !c.last_preview ? "" : c.last_sender_id === me ? "あなた: " : c.is_group && sender ? `${sender.display_name}: ` : "";
  const isUnread = unread > 0;

  return (
    <button type="button" className={`dm-thread ${isUnread ? "is-unread" : ""} ${active ? "is-active" : ""}`} onClick={onOpen}>
      <span className="dm-thread-avatar">
        {c.is_group && c.icon_url ? (
          <Avatar url={c.icon_url} name={titleOf(c, me)} />
        ) : c.is_group ? (
          <span className="dm-group-avatar">
            <Avatar url={others[0]?.avatar_url ?? null} name={others[0]?.display_name ?? ""} />
            <Avatar url={others[1]?.avatar_url ?? null} name={others[1]?.display_name ?? ""} />
          </span>
        ) : (
          <Avatar url={others[0]?.avatar_url ?? null} name={others[0]?.display_name ?? ""} />
        )}
      </span>
      <span className="dm-thread-body">
        <span className="dm-thread-name">{titleOf(c, me)}</span>
        <span className="dm-thread-preview">{c.last_preview ? `${who}${c.last_preview}` : "チャットを始めましょう"}</span>
      </span>
      <span className="dm-thread-side">
        <time dateTime={c.last_message_at}>{shortAgo(c.last_message_at)}</time>
        {isUnread && <span className="dm-unread-dot" aria-label={`未読${unread}件`} />}
      </span>
    </button>
  );
}
