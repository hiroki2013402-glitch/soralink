import { LoaderCircle, X } from "lucide-react";
import { useEffect } from "react";
import { useFetchedPost } from "./useFetchedPost";

type Props = { postId: string; onBack: () => void };

// Full-screen image view for /page/post/:id/image. Closes with the X button or the Escape key.
export function ImageDetailPage({ postId, onBack }: Props) {
  const { post, loading, error } = useFetchedPost(postId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <section className="x-image-view" role="dialog" aria-modal="true" aria-label="画像の詳細">
      <header className="x-image-head">
        <button className="x-image-close" onClick={onBack} aria-label="閉じる"><X size={20} /></button>
        {post && <span>{post.display_name}</span>}
      </header>
      <div className="x-image-stage">
        {loading && <LoaderCircle className="spin" size={26} />}
        {!loading && (error || !post?.media_url || post.media_type !== "image") && <p>{error || "画像が見つかりません。"}</p>}
        {post?.media_url && post.media_type === "image" && <img src={post.media_url} alt={post.caption || "投稿画像"} />}
      </div>
      {post?.caption && <p className="x-image-caption">{post.caption}</p>}
    </section>
  );
}
