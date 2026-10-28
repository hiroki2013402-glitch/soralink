import { Bell, House, MessageCircle, Plus, Search, UserRound } from "lucide-react";
import CountBadge from "./CountBadge";
import type { Tab } from "../../lib/route";

type Props = {
  activeTab: Tab;
  unread: number;
  dmUnread: number;
  onOpenTab: (tab: Tab) => void;
};

const NAV: [Tab, string, typeof House][] = [
  ["home", "ホーム", House],
  ["search", "検索", Search],
  ["messages", "メッセージ", MessageCircle],
  ["create", "作成", Plus],
  ["notifications", "通知", Bell],
  ["profile", "マイページ", UserRound]
];

// Mobile bottom navigation bar.
export default function BottomNav({ activeTab, unread, dmUnread, onOpenTab }: Props) {
  return (
    <nav className="bottom-nav">
      {NAV.map(([id, label, Icon]) => (
        <button key={id} className={activeTab === id ? "active" : ""} onClick={() => onOpenTab(id)} aria-label={label}>
          <span className="nav-icon">{id === "create" ? <span className="create-plus"><Icon size={22} /></span> : <Icon size={21} />}</span>
          <span className="nav-label">{label}</span>
          {id === "notifications" && <CountBadge count={unread} />}
          {id === "messages" && <CountBadge count={dmUnread} />}
        </button>
      ))}
    </nav>
  );
}
