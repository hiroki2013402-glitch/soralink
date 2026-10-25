// Client-side routes. Paths: /page/<tab>, /page/post/<id>, /page/post/<id>/image

export type Tab = "home" | "search" | "create" | "notifications" | "profile" | "post";
export type Route = { tab: Tab; postId?: string; image?: boolean };

// Tabs that appear in the navigation (the "post" view is opened from feeds, not the menu).
export const TABS: Tab[] = ["home", "search", "create", "notifications", "profile"];

export const TAB_TITLES: Record<Tab, string> = {
  home: "ホーム",
  search: "検索",
  create: "投稿を作成",
  notifications: "通知",
  profile: "マイページ",
  post: "投稿"
};

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[1] === "post" && parts[2]) {
    let postId = parts[2];
    try { postId = decodeURIComponent(postId); } catch { /* keep the raw segment */ }
    return { tab: "post", postId, image: parts[3] === "image" };
  }
  const tab = parts[1] as Tab;
  return { tab: TABS.includes(tab) ? tab : "home" };
}
