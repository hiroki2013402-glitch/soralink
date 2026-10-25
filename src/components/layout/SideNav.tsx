import { Bell, House, Plus, Search } from "lucide-react";
import Avatar from "../Avatar";
import type { Tab } from "../../lib/route";
import type { User } from "../../types";

type Props = {
  user: User;
  activeTab: Tab;
  unread: number;
  onOpenTab: (tab: Tab) => void;
};

// Desktop left sidebar: main navigation and the signed-in user.
export default function SideNav({ user, activeTab, unread, onOpenTab }: Props) {
  return (
    <aside className="left-sidebar" aria-label="メインメニュー">
      <button className={activeTab === "home" ? "selected" : ""} onClick={() => onOpenTab("home")}><House size={21} /><span>ホーム</span></button>
      <button className={activeTab === "search" ? "selected" : ""} onClick={() => onOpenTab("search")}><Search size={21} /><span>検索</span></button>
      <button className={activeTab === "create" ? "selected" : ""} onClick={() => onOpenTab("create")}><Plus size={21} /><span>投稿を作成</span></button>
      <button className={activeTab === "notifications" ? "selected" : ""} onClick={() => onOpenTab("notifications")}><Bell size={21} /><span>通知</span>{unread > 0 && <i className="sidebar-unread" />}</button>
      <button className={activeTab === "profile" ? "selected" : ""} onClick={() => onOpenTab("profile")}><Avatar url={user.avatar_url} name={user.display_name} size="small" /><span>マイページ</span></button>
      <div className="sidebar-divider" />
      <div className="sidebar-user"><Avatar url={user.avatar_url} name={user.display_name} size="small" /><span><strong>{user.display_name}</strong><small>SoraLink</small></span></div>
    </aside>
  );
}
