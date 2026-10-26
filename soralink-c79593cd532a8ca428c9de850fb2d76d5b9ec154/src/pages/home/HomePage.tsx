import { ImagePlus, LoaderCircle, Link as LinkIcon, RefreshCw } from "lucide-react";
import PostCard from "../../components/PostCard";
import type { PostCardHandlers } from "../../components/PostCard";
import type { Post } from "../../types";

type Props = {
  posts: Post[];
  loading: boolean;
  error: string;
  liked: Record<string, boolean>;
  cardProps: PostCardHandlers;
  onReload: () => void;
  onCreate: () => void;
};

// Home tab: intro banner and the feed of all posts.
export default function HomePage({ posts, loading, error, liked, cardProps, onReload, onCreate }: Props) {
  return (
    <>
      <div className="home-intro">
        <div>
          <span className="eyebrow">YOUR WORLD, CONNECTED</span>
          <h1>今日の瞬間を、<br /><em>シェアしよう。</em></h1>
          <p>友達の近況や、新しい発見に出会おう。</p>
        </div>
        <div className="intro-art"><LinkIcon size={66} /></div>
      </div>
      <div className="feed-toolbar">
        <span>フィード</span>
        <button className="refresh-button" onClick={onReload} aria-label="投稿を更新"><RefreshCw size={17} /></button>
      </div>
      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" /><span>投稿を読み込み中…</span></div>
      ) : error ? (
        <div className="empty-state"><p>{error}</p><button className="primary-button" onClick={onReload}>再読み込み</button></div>
      ) : posts.length ? (
        <div className="post-list">
          {posts.map(p => <PostCard key={p.id} post={p} liked={!!liked[p.id]} {...cardProps} />)}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-art"><ImagePlus size={28} /></div>
          <h3>まだ投稿がありません</h3>
          <p>最初の投稿をシェアしてみましょう。</p>
          <button className="primary-button" onClick={onCreate}>投稿を作成</button>
        </div>
      )}
    </>
  );
}
