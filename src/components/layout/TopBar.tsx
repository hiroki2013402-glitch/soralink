import { Bell, Search } from "lucide-react";
import type { FormEvent } from "react";
import Avatar from "../Avatar";
import BrandMark from "../BrandMark";
import { TAB_TITLES } from "../../lib/route";
import type { Tab } from "../../lib/route";
import type { User } from "../../types";

type Props = {
  user: User;
  activeTab: Tab;
  unread: number;
  search: string;
  onSearchChange: (value: string) => void;
  onSubmitSearch: (e?: FormEvent) => void;
  onOpenTab: (tab: Tab) => void;
};

// Header bar: logo, page title (mobile), user search box, notifications and profile shortcuts.
export default function TopBar({ user, activeTab, unread, search, onSearchChange, onSubmitSearch, onOpenTab }: Props) {
  return (
    <header className="topbar">
      <div className="header-left">
        <button className="mobile-logo" onClick={() => onOpenTab("home")} aria-label="ホーム"><BrandMark size={31} /></button>
        <span className="mobile-page-title">{TAB_TITLES[activeTab]}</span>
      </div>
      <div className="header-right">
        <button className="brand brand-right" onClick={() => onOpenTab("home")}><BrandMark size={40} /><span>SoraLink</span></button>
        <form className="search-bar" onSubmit={onSubmitSearch} onClick={() => { if (window.matchMedia("(max-width: 620px)").matches) onOpenTab("search"); }}>
          <Search size={17} />
          <input value={search} onChange={e => onSearchChange(e.target.value)} placeholder="ユーザーを検索" aria-label="ユーザーを検索" />
          <button aria-label="検索"><Search size={16} /></button>
        </form>
        <button className={`header-icon ${activeTab === "notifications" ? "active" : ""}`} onClick={() => onOpenTab("notifications")} aria-label="通知">
          <Bell size={21} />{unread > 0 && <i className="unread-dot" />}
        </button>
        <button className="header-avatar" onClick={() => onOpenTab("profile")} aria-label="マイページ"><Avatar url={user.avatar_url} name={user.display_name} size="small" /></button>
      </div>
    </header>
  );
}
