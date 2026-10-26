import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { AuditEntry } from "../../types";
import { AUDIT_LABELS, formatAdminDate } from "./adminFormat";

type Props = { onNotice: (text: string) => void };

// Audit tab: every admin action, newest first.
export default function AuditPanel({ onNotice }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ entries: AuditEntry[] }>("/admin/audit")
      .then(r => setEntries(r.entries))
      .catch(e => onNotice(errorMessage(e, "操作ログを読み込めませんでした。")))
      .finally(() => setLoading(false));
  }, [onNotice]);

  return (
    <section className="admin-card">
      <h3>操作ログ</h3>
      <p className="admin-muted small">利用停止・投稿の編集と削除・お知らせ配信・DMの閲覧を、新しい順に最大200件表示します。</p>
      {loading ? (
        <div className="admin-loading"><LoaderCircle className="spin" size={16} />読み込み中…</div>
      ) : entries.length ? (
        <ul className="admin-list">
          {entries.map(e => (
            <li key={e.id} className="admin-row-plain">
              <div className="admin-row-main">
                <strong>{AUDIT_LABELS[e.action] ?? e.action}</strong>
                <small className="admin-muted">{e.admin_name ?? "不明な管理者"} ・ {formatAdminDate(e.created_at)}</small>
                {e.detail && <p className="admin-muted small">{e.detail}</p>}
                {e.target && <small className="admin-mono">対象: {e.target}</small>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-muted">操作はまだありません。</p>
      )}
    </section>
  );
}
