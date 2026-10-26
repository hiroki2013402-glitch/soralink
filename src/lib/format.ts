export function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}時間前`;
  return `${Math.floor(minutes / 1440)}日前`;
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function handleOf(id: string) {
  return `@${id.replace(/^sennin:/, "").slice(0, 24)}`;
}
