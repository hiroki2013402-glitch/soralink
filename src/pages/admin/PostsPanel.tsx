import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle, Pencil, Search, Trash2 } from "lucide-react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { AdminPost, Visibility } from "../../types";
import { formatAdminDate, visibilityLabel } from "./adminFormat";

type Props = { onNotice: (text: string) => void };

// Posts tab: every post on the site, newest first. Admins can edit or delete any of them.
export default function PostsPanel({ onNotice }: Props) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const r = await api<{ posts: AdminPost[] }>(`/admin/posts?q=${encodeURIComponent(q)}`);
      setPosts(r.posts);
    } catch (e) {
      onNotice(errorMessage(e, "投稿を読み込めませんでした。"));
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { void load(query); }, [query, load]);

  return (
    <section className="admin-card">
      <form className="admin-search" onSubmit={(e: FormEvent) => { e.preventDefault(); setQuery(input.trim()); }}>
        <Search size={16} />
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="本文で検索" maxLength={50} aria-label="投稿の本文で検索" />
        <button type="submit" className="outline-small">検索</button>
      </form>
      {loading ? (
        <div className="admin-loading"><LoaderCircle className="spin" size={16} />読み込み中…</div>
      ) : (
        <AdminPostList posts={posts} showAuthor onChanged={() => void load(query)} onNotice={onNotice} />
      )}
    </section>
  );
}

type ListProps = { posts: AdminPost[]; onChanged: () => void; onNotice: (text: string) => void; showAuthor?: boolean };

export function AdminPostList({ posts, onChanged, onNotice, showAuthor = false }: ListProps) {
  if (!posts.length) return <p className="admin-muted">投稿はありません。</p>;
  return (
    <ul className="admin-list">
      {posts.map(post => (
        <AdminPostRow key={post.id} post={post} showAuthor={showAuthor} onChanged={onChanged} onNotice={onNotice} />
      ))}
    </ul>
  );
}

function AdminPostRow({ post, showAuthor, onChanged, onNotice }: { post: AdminPost } & Omit<ListProps, "posts">) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const [visibility, setVisibility] = useState<Visibility>(post.visibility);
  const [busy, setBusy] = useState(false);
  const id = encodeURIComponent(post.id);
  const kind = post.media_type === "video" ? "動画" : post.media_type === "image" ? "画像" : "テキスト";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admin/posts/${id}`, { method: "PATCH", body: JSON.stringify({ caption, visibility }) });
      setEditing(false);
      onNotice("投稿を更新しました。");
      onChanged();
    } catch (err) {
      onNotice(errorMessage(err, "投稿を更新できませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("この投稿を削除しますか？ コメントといいねも削除され、元に戻せません。")) return;
    setBusy(true);
    try {
      await api(`/admin/posts/${id}`, { method: "DELETE" });
      onNotice("投稿を削除しました。");
      onChanged();
    } catch (err) {
      onNotice(errorMessage(err, "投稿を削除できませんでした。"));
      setBusy(false);
    }
  };

  return (
    <li className="admin-post">
      <div className="admin-post-head">
        {showAuthor && <Avatar url={post.avatar_url ?? null} name={post.display_name ?? ""} size="small" />}
        <div className="admin-row-main">
          {showAuthor && <strong>{post.display_name}</strong>}
          <small className="admin-muted">{formatAdminDate(post.created_at)} ・ {visibilityLabel(post.visibility)} ・ {kind}</small>
        </div>
        {post.media_type === "image" && post.media_url && <img className="admin-thumb" src={post.media_url} alt="" loading="lazy" />}
        <div className="admin-post-actions">
          <a className="outline-small" href={`/page/post/${id}`} target="_blank" rel="noreferrer">開く</a>
          <button type="button" className="outline-small" onClick={() => setEditing(v => !v)} disabled={busy}><Pencil size={14} />編集</button>
          <button type="button" className="admin-danger-button small" onClick={() => void remove()} disabled={busy}><Trash2 size={14} />削除</button>
        </div>
      </div>
      {editing ? (
        <form className="admin-form" onSubmit={save}>
          <label>
            本文
            <textarea rows={3} maxLength={500} value={caption} onChange={e => setCaption(e.target.value)} />
          </label>
          <label>
            公開範囲
            <select value={visibility} onChange={e => setVisibility(e.target.value as Visibility)}>
              <option value="public">公開</option>
              <option value="followers">フォロワーのみ</option>
              <option value="close_friends">親しい友達</option>
            </select>
          </label>
          <div className="admin-actions-row">
            <button type="button" className="outline-small" onClick={() => setEditing(false)}>キャンセル</button>
            <button type="submit" className="primary-button" disabled={busy}>保存する</button>
          </div>
        </form>
      ) : (
        <p className="admin-post-caption">{post.caption || "（本文なし）"}</p>
      )}
    </li>
  );
}
