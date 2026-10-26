import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { Person } from "../../types";

const MAX_OTHERS = 19; // a group holds at most 20 people including the creator
const MAX_MEMBERS = 20;

type Props = {
  onClose: () => void;
  // New chat: the id of the created conversation. Add mode: the id of the group the people were added to.
  onCreated: (id: string) => void;
  onNotice: (text: string) => void;
  // When set, the sheet adds people to this existing group instead of starting a chat.
  addTo?: { conversationId: string; existingIds: string[] };
};

// "New message" sheet: search people, pick one (direct chat) or several (group chat), then start.
// In add mode it lists people who are not yet in the group and adds the picked ones as members.
export default function NewMessageSheet({ onClose, onCreated, onNotice, addTo }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Person[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const capacity = addTo ? Math.max(0, MAX_MEMBERS - addTo.existingIds.length) : MAX_OTHERS;
  const visible = addTo ? results.filter(p => !addTo.existingIds.includes(p.id)) : results;

  // Escape closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live search, lightly debounced.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api<{ users: Person[] }>(`/users/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) setResults(r.users);
      } catch (e) {
        if (!cancelled) onNotice(errorMessage(e, "検索できませんでした"));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, onNotice]);

  const toggle = (person: Person) => {
    if (picked.some(p => p.id === person.id)) {
      setPicked(picked.filter(p => p.id !== person.id));
      return;
    }
    if (picked.length >= capacity) {
      onNotice(addTo ? `このグループは最大${MAX_MEMBERS}人までです。` : `一度に選べるのは${MAX_OTHERS}人までです。`);
      return;
    }
    setPicked([...picked, person]);
  };

  const create = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      if (addTo) {
        await api(`/dm/conversations/${encodeURIComponent(addTo.conversationId)}/members`, {
          method: "POST",
          body: JSON.stringify({ userIds: picked.map(p => p.id) })
        });
        onCreated(addTo.conversationId);
        return;
      }
      const r = await api<{ id: string }>("/dm/conversations", {
        method: "POST",
        body: JSON.stringify({ userIds: picked.map(p => p.id), title: picked.length > 1 ? title : "" })
      });
      onCreated(r.id);
    } catch (e) {
      onNotice(errorMessage(e, addTo ? "メンバーを追加できませんでした" : "会話を作成できませんでした"));
      setBusy(false);
    }
  };

  const actionLabel = addTo ? "追加" : "チャット";
  const busyLabel = addTo ? "追加中…" : "作成中…";

  return (
    <div className="dm-backdrop" onClick={onClose}>
      <section className="dm-sheet dm-new-sheet" role="dialog" aria-modal="true" aria-label={addTo ? "メンバーを追加" : "新規メッセージ"} onClick={e => e.stopPropagation()}>
        <header className="dm-sheet-head">
          <button type="button" className="dm-icon-btn" onClick={onClose} aria-label="閉じる"><X size={22} /></button>
          <strong>{addTo ? "メンバーを追加" : "新規メッセージ"}</strong>
          <button type="button" className="dm-text-btn" onClick={() => void create()} disabled={!picked.length || busy}>
            {busy ? busyLabel : actionLabel}
          </button>
        </header>

        <div className="dm-to">
          <span>{addTo ? "追加:" : "宛先:"}</span>
          <div className="dm-to-field">
            {picked.map(p => (
              <button key={p.id} type="button" className="dm-chip" onClick={() => toggle(p)}>
                {p.display_name}<X size={12} />
              </button>
            ))}
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={picked.length ? "" : "検索"}
              aria-label={addTo ? "追加するメンバーを検索" : "宛先を検索"}
              autoFocus
            />
          </div>
        </div>

        {!addTo && picked.length > 1 && (
          <input className="dm-group-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="グループ名（任意）" aria-label="グループ名" />
        )}

        <div className="dm-people">
          {searching && <div className="dm-state"><LoaderCircle className="spin" size={20} /></div>}
          {!searching && query.trim() && visible.length === 0 && <p className="dm-state-text">見つかりませんでした</p>}
          {!query.trim() && <p className="dm-state-text">名前で検索して相手を選びましょう</p>}
          {visible.map(p => {
            const selected = picked.some(x => x.id === p.id);
            return (
              <button key={p.id} type="button" className={`dm-person ${selected ? "is-selected" : ""}`} onClick={() => toggle(p)} aria-pressed={selected}>
                <Avatar url={p.avatar_url} name={p.display_name} />
                <span className="dm-person-text">
                  <strong>{p.display_name}</strong>
                  <small>{p.bio || "SoraLink"}</small>
                </span>
                <span className={`dm-radio ${selected ? "on" : ""}`} aria-hidden="true">{selected && <Check size={13} strokeWidth={3} />}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
