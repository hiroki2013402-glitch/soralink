import { Bell, Heart, Users } from "lucide-react";
import Avatar from "../../components/Avatar";
import { timeAgo } from "../../lib/format";
import type { Notice } from "../../types";

type Props = {
  notifications: Notice[];
  onOpenNotification: (n: Notice) => void;
};

// Notifications tab: likes on your posts and new followers.
export default function NotificationsPage({ notifications, onOpenNotification }: Props) {
  return (
    <section className="page-panel">
      <div className="page-heading"><span className="eyebrow">ACTIVITY</span><h1>通知</h1><p>あなたの投稿やアカウントへのアクティビティ。</p></div>
      {notifications.length ? (
        <div className="notification-list">
          {notifications.map(n => (
            <button className={`notification-row ${n.read_at ? "" : "unread"}`} key={n.id} onClick={() => onOpenNotification(n)}>
              <Avatar url={n.avatar_url} name={n.display_name} />
              <span className="notification-copy">
                <strong>{n.display_name}</strong>{n.kind === "like" ? " があなたの投稿にいいねしました。" : " があなたをフォローしました。"}
                <small>{timeAgo(n.created_at)}</small>
              </span>
              <span className="notification-symbol">{n.kind === "like" ? <Heart size={17} /> : <Users size={17} />}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state"><div className="empty-art"><Bell size={26} /></div><h3>まだ通知はありません</h3><p>いいねやフォローがあると、ここに表示されます。</p></div>
      )}
    </section>
  );
}
