import { Search } from "lucide-react";
import type { FormEvent } from "react";
import Avatar from "../../components/Avatar";
import type { Person } from "../../types";

type Props = {
  search: string;
  people: Person[];
  onSearchChange: (value: string) => void;
  onSubmit: (e?: FormEvent) => void;
  onOpenProfile: (id: string) => void;
};

// Search tab: find users by name and open their profiles.
export default function SearchPage({ search, people, onSearchChange, onSubmit, onOpenProfile }: Props) {
  return (
    <section className="page-panel">
      <div className="page-heading"><span className="eyebrow">DISCOVER</span><h1>ユーザーを検索</h1><p>気になる人を見つけて、つながろう。</p></div>
      <form className="large-search" onSubmit={onSubmit}>
        <Search size={20} />
        <input value={search} onChange={e => onSearchChange(e.target.value)} placeholder="ユーザー名で検索" autoFocus />
        <button className="primary-button">検索</button>
      </form>
      <div className="people-list">
        {people.map(p => (
          <div className="person-row" key={p.id}>
            <button className="plain-avatar" onClick={() => onOpenProfile(p.id)}><Avatar url={p.avatar_url} name={p.display_name} /></button>
            <button className="person-info" onClick={() => onOpenProfile(p.id)}><strong>{p.display_name}</strong><span>{p.bio || "SoraLinkを利用しています"}</span></button>
            <button className="outline-small" onClick={() => onOpenProfile(p.id)}>プロフィール</button>
          </div>
        ))}
      </div>
      {search.trim() && !people.length && <p className="empty-inline">検索結果はここに表示されます。検索語を入力して検索してください。</p>}
    </section>
  );
}
