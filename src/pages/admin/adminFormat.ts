import type { Visibility } from "../../types";

export function formatAdminDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const visibilityLabel = (value: Visibility) =>
  value === "followers" ? "フォロワーのみ" : value === "close_friends" ? "親しい友達" : "公開";

export const AUDIT_LABELS: Record<string, string> = {
  ban_user: "利用停止",
  unban_user: "利用停止の解除",
  edit_post: "投稿の編集",
  delete_post: "投稿の削除",
  create_announcement: "お知らせの配信",
  delete_announcement: "お知らせの削除",
  view_dm: "DMの閲覧"
};
