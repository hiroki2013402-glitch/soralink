import { useEffect, useState } from "react";
import Avatar from "../Avatar";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { Person, Post, User } from "../../types";

type Props = {
  user: User;
  onOpenPost: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onNotice: (text: string) => void;
};

type Recommendations = { posts: Post[]; users: Person[] };

const excerpt = (text: string) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

// Desktop right column: recommended posts and people to follow.
export default function RightRail({ user, onOpenPost, onOpenProfile, onNotice }: Props) {
  const [data, setData] = useState<Recommendations>({ posts: [], users: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<Recommendations>("/recommendations")
      .then(r => { if (alive) setData(r); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user.id]);

  const follow = async (id: string) => {
    try {
      await api(`/users/${id}/follow`, { method: "POST" });
      setData(v => ({ ...v, users: v.users.filter(u => u.id !== id) }));
      onNotice("フォローしました。");
    } catch (e) {
      onNotice(errorMessage(e, "フォローできませんでした"));
    }
  };

  return (
    <aside className="right-rail">
      <section className="rec-card">
        <h3>おすすめ</h3>
        {loading ? (
          <p className="rec-empty">読み込み中…</p>
        ) : data.posts.length ? (
          data.posts.map(p => (
            <button key={p.id} className="rec-post" onClick={() => onOpenPost(p.id)}>
              <Avatar url={p.avatar_url} name={p.display_name} size="small" />
              <span>
                <strong>{p.display_name}</strong>
                <small>{p.caption ? excerpt(p.caption) : p.media_type === "video" ? "動画を投稿しました" : p.media_type === "image" ? "画像を投稿しました" : "投稿を見る"}</small>
                <em>♥ {Number(p.likes_count) || 0}</em>
              </span>
            </button>
          ))
        ) : (
          <p className="rec-empty">いまおすすめの投稿はありません。</p>
        )}
      </section>

      <section className="rec-card">
        <h3>おすすめのユーザー</h3>
        {loading ? (
          <p className="rec-empty">読み込み中…</p>
        ) : data.users.length ? (
          data.users.map(u => (
            <div key={u.id} className="rec-user">
              <button className="plain-avatar" onClick={() => onOpenProfile(u.id)} aria-label={`${u.display_name}のプロフィール`}>
                <Avatar url={u.avatar_url} name={u.display_name} />
              </button>
              <button className="rec-user-info" onClick={() => onOpenProfile(u.id)}>
                <strong>{u.display_name}</strong>
                <small>{u.bio || "SoraLinkを利用しています"}</small>
              </button>
              <button className="outline-small" onClick={() => void follow(u.id)}>フォロー</button>
            </div>
          ))
        ) : (
          <p className="rec-empty">おすすめのユーザーはいません。</p>
        )}
      </section>

      <div className="rail-footer">SoraLink · 安心してつながる場所<br />利用規約　プライバシー</div>
    </aside>
  );
}
