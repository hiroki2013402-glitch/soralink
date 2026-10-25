// Time labels for the message list (short, like "5分" / "3時間" / "2日") and the chat (centred separators).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function shortAgo(value: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(value).getTime());
  if (diff < MINUTE) return "今";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}時間`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}日`;
  return `${Math.floor(diff / (7 * DAY))}週`;
}

// Separator label in the chat: time today, weekday/date with time otherwise.
export function chatStamp(value: string, now = new Date()) {
  const date = new Date(value);
  const time = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return time;
  const days = Math.floor((now.getTime() - date.getTime()) / DAY);
  if (days < 7) return `${date.toLocaleDateString("ja-JP", { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })} ${time}`;
}

// Messages from the same sender close together are drawn as one group (one avatar, joined bubbles).
export const GROUP_GAP_MS = 5 * MINUTE;
// A centred time label appears between messages this far apart.
export const STAMP_GAP_MS = 30 * MINUTE;
