// Client-side routes. Paths: /page/<tab>, /page/post/<id>, /page/post/<id>/image, /page/messages/<conversationId>

export type Tab = "home" | "search" | "messages" | "create" | "notifications" | "profile" | "post";
export type Route = { tab: Tab; postId?: string; image?: boolean; conversationId?: string };

// Tabs that appear in the navigation (the "post" view is opened from feeds, not the menu).
export const TABS: Tab[] = ["home", "search", "messages", "create", "notifications", "profile"];

export const TAB_TITLES: Record<Tab, string> = {
  home: "ホーム",
  search: "検索",
  messages: "メッセージ",
  create: "投稿を作成",
  notifications: "通知",
  profile: "マイページ",
  post: "投稿"
};

function decodeSegment(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[1] === "post" && parts[2]) {
    return { tab: "post", postId: decodeSegment(parts[2]), image: parts[3] === "image" };
  }
  if (parts[1] === "messages") {
    return parts[2] ? { tab: "messages", conversationId: decodeSegment(parts[2]) } : { tab: "messages" };
  }
  const tab = parts[1] as Tab;
  return { tab: TABS.includes(tab) ? tab : "home" };
}
