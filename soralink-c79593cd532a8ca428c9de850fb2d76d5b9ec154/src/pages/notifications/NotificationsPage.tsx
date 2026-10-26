import { Bell, Heart, UserPlus } from "lucide-react";
import { useState } from "react";
import Avatar from "../../components/Avatar";
import { timeAgo } from "../../lib/format";
import type { Notice } from "../../types";

type Filter = "all" | "like" | "follow";
const FILTERS: [Filter, string][] = [["all", "すべて"], ["like", "いいね"], ["follow", "フォロー"]];

type Props = {
  notifications: Notice[];
  onOpenNotification: (n: Notice) => void;
};

const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString();
const excerpt = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

// Notifications tab: likes on your posts and new followers, grouped into today and earlier.
export default function NotificationsPage({ notifications, onOpenNotification }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = notifications.filter(n => filter === "all" || n.kind === filter);
  const today = shown.filter(n => isToday(n.created_at));
  const earlier = shown.filter(n => !isToday(n.created_at));

  const row = (n: Notice) => (
    <button className={`ntf-row ${n.read_at ? "" : "unread"}`} key={n.id} onClick={() => onOpenNotification(n)}>
      <span className="ntf-avatar">
        <Avatar url={n.avatar_url} name={n.display_name} />
        <span className={`ntf-kind ${n.kind}`}>{n.kind === "like" ? <Heart size={11} fill="currentColor" /> : <UserPlus size={11} />}</span>
      </span>
      <span className="ntf-copy">
        <span className="ntf-text"><strong>{n.display_name}</strong>{n.kind === "like" ? " さんがあなたの投稿にいいねしました" : " さんがあなたをフォローしました"}</span>
        {n.kind === "like" && n.post_caption && <span className="ntf-caption">{excerpt(n.post_caption)}</span>}
        <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
      </span>
      {n.kind === "like" && n.post_media_type === "image" && n.post_media_url && (
        <img className="ntf-thumb" src={n.post_media_url} alt="" loading="lazy" decoding="async" />
      )}
    </button>
  );

  return (
    <section className="x-page ntf-page">
      <header className="x-page-head"><h1>通知</h1></header>

      <div className="ntf-filters" role="tablist">
        {FILTERS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      {shown.length ? (
        <div className="ntf-list">
          {today.length > 0 && <h2 className="ntf-group-title">今日</h2>}
          {today.map(row)}
          {earlier.length > 0 && <h2 className="ntf-group-title">それ以前</h2>}
          {earlier.map(row)}
        </div>
      ) : (
        <div className="ntf-empty">
          <span className="ntf-empty-icon"><Bell size={24} /></span>
          <h3>{filter === "all" ? "まだ通知はありません" : "該当する通知はありません"}</h3>
          <p>いいねやフォローがあると、ここに表示されます。</p>
        </div>
      )}
    </section>
  );
}
