import { useState } from "react";
import { Megaphone, X } from "lucide-react";
import type { Announcement } from "../types";

// Dismissed announcement ids are remembered in this browser only (a per-viewer convenience).
const KEY = "soralink_dismissed_announcements";

function readDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-200))); } catch { /* storage unavailable */ }
}

// Site-wide announcements from the admin, shown at the top of the main column until dismissed.
export default function AnnouncementBanners({ items }: { items: Announcement[] }) {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const visible = items.filter(item => !dismissed.includes(item.id));
  if (!visible.length) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div className="announcement-list">
      {visible.map(item => (
        <section key={item.id} className="announcement" role="status">
          <Megaphone size={18} />
          <div className="announcement-body">
            <strong>{item.title}</strong>
            <p>{item.body}</p>
            <small>{new Date(item.created_at).toLocaleString("ja-JP")}</small>
          </div>
          <button type="button" onClick={() => dismiss(item.id)} aria-label="お知らせを閉じる"><X size={15} /></button>
        </section>
      ))}
    </div>
  );
}
