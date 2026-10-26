import { LoaderCircle, X } from "lucide-react";
import Avatar from "./Avatar";
import type { Person } from "../types";

type Props = {
  type: "followers" | "following";
  users: Person[];
  loading: boolean;
  onClose: () => void;
  onOpenProfile: (id: string) => void;
};

// Overlay listing a user's followers or following. Picking someone closes it and opens their profile.
export default function RelationsModal({ type, users, loading, onClose, onOpenProfile }: Props) {
  const open = (id: string) => { onClose(); onOpenProfile(id); };
  return (
    <div className="relation-overlay" onClick={onClose}>
      <section className="relation-modal" onClick={e => e.stopPropagation()}>
        <header>
          <div><h2>{type === "followers" ? "フォロワー" : "フォロー中"}</h2><span>{users.length}人</span></div>
          <button onClick={onClose} aria-label="閉じる"><X /></button>
        </header>
        {loading ? (
          <div className="loading-state"><LoaderCircle className="spin" />読み込み中…</div>
        ) : users.length ? (
          <div className="relation-list">
            {users.map(person => (
              <div className="person-row" key={person.id}>
                <button className="plain-avatar" onClick={() => open(person.id)}><Avatar url={person.avatar_url} name={person.display_name} /></button>
                <button className="person-info" onClick={() => open(person.id)}><strong>{person.display_name}</strong><span>{person.bio || "SoraLinkを利用しています"}</span></button>
                <button className="outline-small" onClick={() => open(person.id)}>プロフィール</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state"><p>まだ{type === "followers" ? "フォロワー" : "フォロー中のユーザー"}はいません。</p></div>
        )}
      </section>
    </div>
  );
}
