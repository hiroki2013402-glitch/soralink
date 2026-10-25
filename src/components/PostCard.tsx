import { Heart, MessageCircle, Share2, Trash2 } from "lucide-react";
import type { Post, User } from "../types";
import Avatar from "./Avatar";
import VisibilityBadge from "./VisibilityBadge";
import { timeAgo } from "../lib/format";

type Props = {
  post: Post;
  user: User | null;
  liked: boolean;
  onLike: (id: string) => void;
  onDelete: (id: string) => void;
  onProfile: (id: string) => void;
  onOpen: (id: string) => void;
  onOpenImage: (id: string) => void;
  onNotice: (text: string) => void;
};

// Everything a feed or profile needs to forward to a card, except the post itself.
export type PostCardHandlers = Omit<Props, "post" | "liked">;

export default function PostCard({ post, user, liked, onLike, onDelete, onProfile, onOpen, onOpenImage, onNotice }: Props) {
  const mine = user?.id === post.user_id;
  const likes = Number(post.likes_count) || 0;
  const comments = Number(post.comments_count) || 0;

  const share = async () => {
    const url = `${location.origin}/page/post/${post.id}`;
    try {
      if (navigator.share) await navigator.share({ title: "SoraLink", text: post.caption || "SoraLinkの投稿", url });
      else {
        await navigator.clipboard.writeText(url);
        onNotice("投稿リンクをコピーしました。");
      }
    } catch {
      // The user cancelled the share sheet.
    }
  };

  return (
    <article className="x-post">
      <button className="x-post-avatar" onClick={() => onProfile(post.user_id)} aria-label={`${post.display_name}のプロフィール`}>
        <Avatar url={post.avatar_url} name={post.display_name} />
      </button>
      <div className="x-post-main">
        <header className="x-post-head">
          <button className="x-post-author" onClick={() => onProfile(post.user_id)}>{post.display_name}</button>
          <time dateTime={post.created_at}>· {timeAgo(post.created_at)}</time>
          <VisibilityBadge visibility={post.visibility} />
          {mine && (
            <button className="x-icon-button x-post-delete" onClick={() => onDelete(post.id)} aria-label="投稿を削除" title="投稿を削除">
              <Trash2 size={16} />
            </button>
          )}
        </header>

        {post.caption && (
          <p className="x-post-caption" onClick={() => onOpen(post.id)}>{post.caption}</p>
        )}

        {post.media_url && post.media_type === "image" && (
          <button className="x-post-media" onClick={() => onOpenImage(post.id)} aria-label="画像を拡大表示">
            <img src={post.media_url} alt={post.caption || "投稿画像"} loading="lazy" decoding="async" />
          </button>
        )}
        {post.media_url && post.media_type === "video" && (
          <div className="x-post-media">
            <video src={post.media_url} controls playsInline preload="metadata" />
          </div>
        )}

        <footer className="x-post-actions">
          <button className="x-action" onClick={() => onOpen(post.id)} aria-label="コメントを見る">
            <MessageCircle size={18} /><span>{comments || ""}</span>
          </button>
          <button className={`x-action like ${liked ? "on" : ""}`} onClick={() => onLike(post.id)} disabled={!user} aria-pressed={liked} aria-label={liked ? "いいねを取り消す" : "いいね"}>
            <Heart size={18} fill={liked ? "currentColor" : "none"} /><span>{likes || ""}</span>
          </button>
          <button className="x-action" onClick={() => void share()} aria-label="共有">
            <Share2 size={17} />
          </button>
        </footer>
      </div>
    </article>
  );
}
