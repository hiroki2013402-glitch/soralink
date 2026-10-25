import { Bell, House, Plus, Search, UserRound } from "lucide-react";
import type { Tab } from "../../lib/route";

type Props = {
  activeTab: Tab;
  unread: number;
  onOpenTab: (tab: Tab) => void;
};

const NAV: [Tab, string, typeof House][] = [
  ["home", "ホーム", House],
  ["search", "検索", Search],
  ["create", "作成", Plus],
  ["notifications", "通知", Bell],
  ["profile", "マイページ", UserRound]
];

// Mobile bottom navigation bar.
export default function BottomNav({ activeTab, unread, onOpenTab }: Props) {
  return (
    <nav className="bottom-nav">
      {NAV.map(([id, label, Icon]) => (
        <button key={id} className={activeTab === id ? "active" : ""} onClick={() => onOpenTab(id)} aria-label={label}>
          <span className="nav-icon">{id === "create" ? <span className="create-plus"><Icon size={22} /></span> : <Icon size={21} />}</span>
          <span>{label}</span>
          {id === "notifications" && unread > 0 && <i className="nav-dot" />}
        </button>
      ))}
    </nav>
  );
}
