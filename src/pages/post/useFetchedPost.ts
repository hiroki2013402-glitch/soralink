import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { Post } from "../../types";

// Loads one post by id. Used by both the post detail page and the full-screen image view.
export function useFetchedPost(postId: string) {
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api<{ post: Post }>(`/posts/${encodeURIComponent(postId)}`)
      .then(r => { if (!cancelled) setPost(r.post); })
      .catch(e => { if (!cancelled) setError(errorMessage(e, "読み込みに失敗しました。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [postId]);
  return { post, setPost, loading, error };
}
