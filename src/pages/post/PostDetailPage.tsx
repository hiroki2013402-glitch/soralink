import { ArrowLeft, Heart, LoaderCircle, MessageCircle, Share2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Avatar from "../../components/Avatar";
import VideoPlayer from "../../components/VideoPlayer";
import { posterFor } from "../../lib/video";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatDateTime, timeAgo } from "../../lib/format";
import type { Comment, User } from "../../types";
import { useFetchedPost } from "./useFetchedPost";

type Props = {
  postId: string;
  user: User | null;
  onBack: () => void;
  onProfile: (id: string) => void;
  onOpenImage: (id: string) => void;
  onDelete: (id: string) => void;
  onNotice: (text: string) => void;
};

// Post detail for /page/post/:id: the post, its like/share actions, and comments.
export function PostDetailPage({ postId, user, onBack, onProfile, onOpenImage, onDelete, onNotice }: Props) {
  const { post, setPost, loading, error } = useFetchedPost(postId);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsError, setCommentsError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const commentInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setComments([]);
    setCommentsError("");
    api<{ comments: Comment[] }>(`/posts/${encodeURIComponent(postId)}/comments`)
      .then(r => { if (!cancelled) setComments(r.comments); })
      .catch(e => { if (!cancelled) setCommentsError(errorMessage(e, "読み込みに失敗しました。")); });
    return () => { cancelled = true; };
  }, [postId]);

  const toggleLike = async () => {
    if (!post) return;
    if (!user) return onNotice("いいねするにはログインしてください。");
    try {
      const r = await api<{ liked: boolean }>(`/posts/${post.id}/like`, { method: "POST" });
      setPost({ ...post, liked: r.liked, likes_count: Math.max(0, Number(post.likes_count) + (r.liked ? 1 : -1)) });
    } catch (e) {
      onNotice(errorMessage(e, "読み込みに失敗しました。"));
    }
  };

  const sendComment = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await api<{ comment: Comment }>(`/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
      setComments(v => [...v, r.comment]);
      setBody("");
      if (post) setPost({ ...post, comments_count: Number(post.comments_count ?? 0) + 1 });
    } catch (e) {
      onNotice(errorMessage(e, "読み込みに失敗しました。"));
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (id: string) => {
    if (!confirm("このコメントを削除しますか？")) return;
    try {
      await api(`/comments/${id}`, { method: "DELETE" });
      setComments(v => v.filter(c => c.id !== id));
      if (post) setPost({ ...post, comments_count: Math.max(0, Number(post.comments_count ?? 1) - 1) });
    } catch (e) {
      onNotice(errorMessage(e, "読み込みに失敗しました。"));
    }
  };

  const share = async () => {
    const url = `${location.origin}/page/post/${postId}`;
    try {
      if (navigator.share) await navigator.share({ title: "SoraLink", text: post?.caption || "SoraLinkの投稿", url });
      else {
        await navigator.clipboard.writeText(url);
        onNotice("投稿リンクをコピーしました。");
      }
    } catch {
      // The user cancelled the share sheet.
    }
  };

  return (
    <section className="x-page x-detail-page">
      <header className="x-page-head">
        <button className="x-icon-button" onClick={onBack} aria-label="戻る"><ArrowLeft size={20} /></button>
        <h1>投稿</h1>
      </header>

      {loading && <div className="x-state"><LoaderCircle className="spin" size={22} /><span>読み込み中…</span></div>}
      {!loading && (error || !post) && (
        <div className="x-state"><p>{error || "投稿が見つかりません。"}</p><button className="x-pill" onClick={onBack}>戻る</button></div>
      )}

      {post && (
        <>
          <article className="x-detail">
            <div className="x-detail-author">
              <button onClick={() => onProfile(post.user_id)} aria-label={`${post.display_name}のプロフィール`}><Avatar url={post.avatar_url} name={post.display_name} size="large" /></button>
              <div>
                <button className="x-post-author" onClick={() => onProfile(post.user_id)}>{post.display_name}</button>
                <span className="x-muted">{timeAgo(post.created_at)}</span>
              </div>
              {user?.id === post.user_id && (
                <button className="x-icon-button" onClick={() => onDelete(post.id)} aria-label="投稿を削除"><Trash2 size={17} /></button>
              )}
            </div>

            {post.caption && <p className="x-detail-caption">{post.caption}</p>}

            {post.media_url && post.media_type === "image" && (
              <button className="x-detail-media" onClick={() => onOpenImage(post.id)} aria-label="画像を拡大表示">
                <img src={post.media_url} alt={post.caption || "投稿画像"} decoding="async" />
              </button>
            )}
            {post.media_url && post.media_type === "video" && (
              <div className="x-detail-media x-post-video">
                <VideoPlayer src={post.media_url} poster={posterFor(post.media_url)} label="投稿の動画" />
              </div>
            )}

            <time className="x-muted x-detail-time" dateTime={post.created_at}>{formatDateTime(post.created_at)}</time>

            <div className="x-detail-stats">
              <span><strong>{Number(post.likes_count) || 0}</strong> いいね</span>
              <span><strong>{comments.length}</strong> コメント</span>
            </div>

            <div className="x-detail-actions">
              <button className={`x-action like ${post.liked ? "on" : ""}`} onClick={() => void toggleLike()} aria-pressed={Boolean(post.liked)}>
                <Heart size={20} fill={post.liked ? "currentColor" : "none"} /><span>いいね</span>
              </button>
              <button className="x-action" onClick={() => commentInput.current?.focus()}>
                <MessageCircle size={20} /><span>コメント</span>
              </button>
              <button className="x-action" onClick={() => void share()}>
                <Share2 size={19} /><span>共有</span>
              </button>
            </div>
          </article>

          <section className="x-comments" aria-label="コメント">
            {user ? (
              <form className="x-comment-form" onSubmit={sendComment}>
                <Avatar url={user.avatar_url} name={user.display_name} size="small" />
                <textarea
                  ref={commentInput}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="コメントを投稿"
                  rows={1}
                  maxLength={500}
                  aria-label="コメントを入力"
                />
                <button className="x-pill" disabled={!body.trim() || sending}>
                  {sending ? <LoaderCircle className="spin" size={15} /> : "返信"}
                </button>
              </form>
            ) : (
              <p className="x-muted">コメントするにはログインしてください。</p>
            )}

            {commentsError && <p className="x-composer-error" role="alert">{commentsError}</p>}
            {!commentsError && comments.length === 0 && <p className="x-muted x-empty-comments">まだコメントはありません。</p>}

            <ul className="x-comment-list">
              {comments.map(c => (
                <li className="x-comment" key={c.id}>
                  <button onClick={() => onProfile(c.user_id)} aria-label={`${c.display_name}のプロフィール`}><Avatar url={c.avatar_url} name={c.display_name} size="small" /></button>
                  <div className="x-comment-main">
                    <div className="x-comment-head">
                      <strong>{c.display_name}</strong>
                      <span className="x-muted">{timeAgo(c.created_at)}</span>
                      {user?.id === c.user_id && (
                        <button className="x-icon-button small" onClick={() => void removeComment(c.id)} aria-label="コメントを削除"><X size={14} /></button>
                      )}
                    </div>
                    <p>{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
