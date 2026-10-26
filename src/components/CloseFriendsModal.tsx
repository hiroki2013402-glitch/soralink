import { LoaderCircle, Search, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import type { FollowerRow } from "../types";

type Props = {
  onClose: () => void;
  onNotice: (text: string) => void;
};

// Settings overlay: choose close friends from your followers. Posts set to "親しい友達" show only to them.
export default function CloseFriendsModal({ onClose, onNotice }: Props) {
  const [rows, setRows] = useState<FollowerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    api<{ followers: FollowerRow[] }>("/me/close-friends")
      .then(r => setRows(r.followers))
      .catch(e => onNotice(errorMessage(e, "読み込めませんでした")))
      .finally(() => setLoading(false));
  }, [onNotice]);

  const toggle = async (row: FollowerRow) => {
    setPending(row.id);
    try {
      if (row.close) {
        await api(`/me/close-friends/${encodeURIComponent(row.id)}`, { method: "DELETE" });
      } else {
        await api("/me/close-friends", { method: "POST", body: JSON.stringify({ userId: row.id }) });
      }
      setRows(v => v.map(x => (x.id === row.id ? { ...x, close: !x.close } : x)));
    } catch (e) {
      onNotice(errorMessage(e, "更新できませんでした"));
    } finally {
      setPending(null);
    }
  };

  const selected = rows.filter(r => r.close).length;
  const term = query.trim().toLowerCase();
  const shown = rows.filter(r => !term || r.display_name.toLowerCase().includes(term));

  return (
    <div className="relation-overlay" onClick={onClose}>
      <section className="relation-modal close-modal" role="dialog" aria-modal="true" aria-label="親しい友達" onClick={e => e.stopPropagation()}>
        <header>
          <div>
            <h2>親しい友達</h2>
            <span>{selected}人を選択中 ・ フォロワーの中から追加できます</span>
          </div>
          <button onClick={onClose} aria-label="閉じる"><X size={18} /></button>
        </header>

        <div className="close-search">
          <Search size={15} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="名前で絞り込み" aria-label="名前で絞り込み" />
        </div>

        {loading ? (
          <div className="loading-state"><LoaderCircle className="spin" />読み込み中…</div>
        ) : shown.length ? (
          <div className="relation-list">
            {shown.map(row => (
              <div className="close-row" key={row.id}>
                <Avatar url={row.avatar_url} name={row.display_name} />
                <span className="close-copy">
                  <strong>{row.display_name}</strong>
                  <small>{row.bio || "SoraLinkを利用しています"}</small>
                </span>
                <button
                  className={`close-toggle ${row.close ? "on" : ""}`}
                  disabled={pending === row.id}
                  onClick={() => void toggle(row)}
                  aria-pressed={row.close}
                >
                  {row.close ? <><Star size={13} fill="currentColor" />追加済み</> : "追加"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-inline close-empty">{rows.length ? "一致する人がいません。" : "フォロワーがまだいません。フォローされると、ここから親しい友達に追加できます。"}</p>
        )}
      </section>
    </div>
  );
}
