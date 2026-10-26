import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Megaphone, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { Announcement } from "../../types";
import { formatAdminDate } from "./adminFormat";

type Props = { onNotice: (text: string) => void };

// Announcements tab: publish a site-wide notice (shown to every signed-in user) and manage past ones.
export default function AnnouncementsPanel({ onNotice }: Props) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ announcements: Announcement[] }>("/admin/announcements");
      setItems(r.announcements);
    } catch (e) {
      onNotice(errorMessage(e, "お知らせを読み込めませんでした。"));
    }
  }, [onNotice]);

  useEffect(() => { void load(); }, [load]);

  const publish = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm("全ユーザーにこのお知らせを配信しますか？")) return;
    setBusy(true);
    try {
      await api("/admin/announcements", { method: "POST", body: JSON.stringify({ title, body }) });
      setTitle("");
      setBody("");
      onNotice("お知らせを配信しました。");
      await load();
    } catch (err) {
      onNotice(errorMessage(err, "お知らせを配信できませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("このお知らせを削除しますか？ まだ閉じていないユーザーの画面からも消えます。")) return;
    try {
      await api(`/admin/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });
      onNotice("お知らせを削除しました。");
      await load();
    } catch (err) {
      onNotice(errorMessage(err, "お知らせを削除できませんでした。"));
    }
  };

  return (
    <div className="admin-stack">
      <section className="admin-card">
        <h3>全体にお知らせを配信</h3>
        <p className="admin-muted small">配信すると、ログイン中のすべてのユーザーの画面上部に表示されます。ユーザーが閉じるまで残ります。</p>
        <form className="admin-form" onSubmit={publish}>
          <label>
            タイトル
            <input value={title} maxLength={60} required onChange={e => setTitle(e.target.value)} />
          </label>
          <label>
            本文
            <textarea rows={4} value={body} maxLength={500} required onChange={e => setBody(e.target.value)} />
          </label>
          <div className="admin-actions-row">
            <span className="admin-muted small">{body.length}/500</span>
            <button type="submit" className="primary-button" disabled={busy || !title.trim() || !body.trim()}>
              <Megaphone size={15} />配信する
            </button>
          </div>
        </form>
      </section>

      <section className="admin-card">
        <h3>配信済みのお知らせ</h3>
        {items.length ? (
          <ul className="admin-list">
            {items.map(a => (
              <li key={a.id} className="admin-row-plain">
                <div className="admin-row-main">
                  <strong>{a.title}</strong>
                  <p>{a.body}</p>
                  <small className="admin-muted">{formatAdminDate(a.created_at)}</small>
                </div>
                <button type="button" className="admin-danger-button small" onClick={() => void remove(a.id)}><Trash2 size={14} />削除</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">まだお知らせはありません。</p>
        )}
      </section>
    </div>
  );
}
