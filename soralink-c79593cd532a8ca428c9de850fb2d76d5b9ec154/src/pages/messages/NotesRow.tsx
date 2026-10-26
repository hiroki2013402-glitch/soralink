import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { DmNote, User } from "../../types";

export const NOTE_MAX_LENGTH = 60;

type Props = {
  user: User;
  mine: DmNote | null;
  notes: DmNote[];
  onOpenChat: (userId: string) => void;
  onChanged: () => void;
  onNotice: (text: string) => void;
};

// Instagram-style notes: a row of short statuses above the message list. Your own is first and editable;
// tapping someone else's note opens a chat with them.
export default function NotesRow({ user, mine, notes, onOpenChat, onChanged, onNotice }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="dm-notes" role="list" aria-label="ノート">
        <NoteItem
          name={user.display_name}
          avatar={user.avatar_url}
          text={mine?.body ?? null}
          isMine
          onClick={() => setEditing(true)}
        />
        {notes.map(note => (
          <NoteItem
            key={note.user_id}
            name={note.display_name}
            avatar={note.avatar_url}
            text={note.body}
            onClick={() => onOpenChat(note.user_id)}
          />
        ))}
      </div>

      {editing && (
        <NoteEditor
          current={mine?.body ?? ""}
          hasNote={Boolean(mine)}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

function NoteItem({ name, avatar, text, isMine = false, onClick }: {
  name: string;
  avatar: string | null;
  text: string | null;
  isMine?: boolean;
  onClick: () => void;
}) {
  const label = isMine ? (text ? `自分のノート：${text}` : "ノートを書く") : `${name}のノート：${text ?? ""}`;
  return (
    <button type="button" className="dm-note" role="listitem" onClick={onClick} aria-label={label}>
      <span className={`dm-note-bubble ${text ? "" : "is-placeholder"}`}>
        {text ?? (isMine ? "ノートを書く…" : "")}
      </span>
      <span className="dm-note-avatar">
        <Avatar url={avatar} name={name} />
        {isMine && !text && <span className="dm-note-plus"><Plus size={11} strokeWidth={3} /></span>}
      </span>
      <span className="dm-note-name">{isMine ? "あなた" : name}</span>
    </button>
  );
}

// Write, replace or delete your note. Notes last 24 hours.
function NoteEditor({ current, hasNote, onClose, onSaved, onNotice }: {
  current: string;
  hasNote: boolean;
  onClose: () => void;
  onSaved: () => void;
  onNotice: (text: string) => void;
}) {
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState(false);

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await api("/dm/notes/me", { method: "PUT", body: JSON.stringify({ body }) });
      onSaved();
    } catch (e) {
      onNotice(errorMessage(e, "ノートを保存できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/dm/notes/me", { method: "DELETE" });
      onSaved();
    } catch (e) {
      onNotice(errorMessage(e, "ノートを削除できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dm-backdrop" onClick={onClose}>
      <form className="dm-sheet dm-note-sheet" onClick={e => e.stopPropagation()} onSubmit={save} role="dialog" aria-modal="true" aria-label="ノートを書く">
        <header className="dm-sheet-head">
          <span className="dm-sheet-spacer" />
          <strong>ノート</strong>
          <button type="button" className="dm-icon-btn" onClick={onClose} aria-label="閉じる"><X size={20} /></button>
        </header>
        <p className="dm-note-hint">ノートは24時間表示されます。フォロー中の人とフォロワーに見えます。</p>
        <div className="dm-note-field">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            placeholder="ノートを書く…"
            autoFocus
            aria-label="ノートの内容"
          />
          <small className={NOTE_MAX_LENGTH - text.length <= 10 ? "warn" : ""}>{NOTE_MAX_LENGTH - text.length}</small>
        </div>
        <div className="dm-note-actions">
          {hasNote && <button type="button" className="dm-text-btn danger" onClick={() => void remove()} disabled={busy}>削除</button>}
          <button type="submit" className="dm-primary-btn" disabled={!text.trim() || busy}>シェア</button>
        </div>
      </form>
    </div>
  );
}
