import { Search, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import Avatar from "../../components/Avatar";
import PostCard from "../../components/PostCard";
import type { PostCardHandlers } from "../../components/PostCard";
import type { SearchResults } from "../../types";

type Tab = "all" | "users" | "posts";
const TABS: [Tab, string][] = [["all", "すべて"], ["users", "ユーザー"], ["posts", "投稿"]];

type Props = {
  search: string;
  results: SearchResults | null;   // null until a search has been submitted
  liked: Record<string, boolean>;
  cardProps: PostCardHandlers;
  onSearchChange: (value: string) => void;
  onSubmit: (e?: FormEvent) => void;
  onOpenProfile: (id: string) => void;
};

// Search tab: people and posts, loaded only when the user submits a search.
export default function SearchPage({ search, results, liked, cardProps, onSearchChange, onSubmit, onOpenProfile }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const users = results?.users ?? [];
  const posts = results?.posts ?? [];
  const showUsers = tab === "all" || tab === "users";
  const showPosts = tab === "all" || tab === "posts";
  const nothing = results !== null && users.length === 0 && posts.length === 0;

  return (
    <section className="x-page srch-page">
      <header className="x-page-head"><h1>検索</h1></header>

      <div className="srch-body">
        <div className="srch-field">
          <form className="srch-input" onSubmit={e => { onSubmit(e); }}>
            <Search size={18} />
            <input
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="ユーザーや投稿を検索"
              aria-label="ユーザーや投稿を検索"
              autoComplete="off"
              autoFocus
            />
            {search && (
              <button type="button" className="srch-clear" onClick={() => onSearchChange("")} aria-label="検索語を消す"><X size={15} /></button>
            )}
            <button className="srch-submit" type="submit">検索</button>
          </form>
        </div>

        {results && (
          <div className="srch-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label}
                {id !== "all" && <em>{id === "users" ? users.length : posts.length}</em>}
              </button>
            ))}
          </div>
        )}

        {results === null ? (
          <div className="srch-empty">
            <span className="srch-empty-icon"><Sparkles size={24} /></span>
            <h3>気になるユーザーや投稿を探しましょう</h3>
            <p>名前や投稿の言葉で検索できます。検索語を入力して検索できます。</p>
          </div>
        ) : nothing ? (
          <div className="srch-empty">
            <span className="srch-empty-icon"><Search size={24} /></span>
            <h3>「{search.trim()}」に一致するものはありません</h3>
            <p>別の言葉で試すか、ひらがなや表記を変えてみてください。</p>
          </div>
        ) : (
          <>
            {showUsers && users.length > 0 && (
              <div className="srch-group">
                {tab === "all" && <h2 className="srch-group-title">ユーザー</h2>}
                <div className="srch-users">
                  {users.map(p => (
                    <div className="srch-user" key={p.id}>
                      <button className="srch-user-avatar" onClick={() => onOpenProfile(p.id)} aria-label={`${p.display_name}のプロフィール`}>
                        <Avatar url={p.avatar_url} name={p.display_name} />
                      </button>
                      <button className="srch-user-info" onClick={() => onOpenProfile(p.id)}>
                        <strong>{p.display_name}</strong>
                        <span>{p.bio || "SoraLinkを利用しています"}</span>
                      </button>
                      <button className="srch-follow" onClick={() => onOpenProfile(p.id)}>プロフィール</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showPosts && posts.length > 0 && (
              <div className="srch-group">
                {tab === "all" && <h2 className="srch-group-title">投稿</h2>}
                <div className="post-list">
                  {posts.map(p => <PostCard key={p.id} post={p} liked={!!liked[p.id]} {...cardProps} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
