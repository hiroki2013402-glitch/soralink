import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Ban, LoaderCircle, MessageCircle, Search, Unlock } from "lucide-react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { AdminUser, AdminUserDetail } from "../../types";
import { formatAdminDate } from "./adminFormat";
import { AdminPostList } from "./PostsPanel";

type Props = { onNotice: (text: string) => void; onShowDms: (userId: string) => void };

// Users tab: search the directory, then open a user's settings screen (ban or unban, their posts, their DMs).
export default function UsersPanel({ onNotice, onShowDms }: Props) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const r = await api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`);
      setUsers(r.users);
    } catch (e) {
      onNotice(errorMessage(e, "ユーザーを読み込めませんでした。"));
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  // Reload the list when coming back from a user's settings screen.
  useEffect(() => {
    if (!selected) void load(query);
  }, [query, selected, load]);

  if (selected) {
    return <UserSettings userId={selected} onBack={() => setSelected(null)} onNotice={onNotice} onShowDms={onShowDms} />;
  }

  return (
    <section className="admin-card">
      <form className="admin-search" onSubmit={(e: FormEvent) => { e.preventDefault(); setQuery(input.trim()); }}>
        <Search size={16} />
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="名前・ID・メールで検索" maxLength={50} aria-label="ユーザーを検索" />
        <button type="submit" className="outline-small">検索</button>
      </form>
      {loading ? (
        <div className="admin-loading"><LoaderCircle className="spin" size={16} />読み込み中…</div>
      ) : users.length ? (
        <ul className="admin-list">
          {users.map(u => (
            <li key={u.id}>
              <button type="button" className="admin-row" onClick={() => setSelected(u.id)}>
                <Avatar url={u.avatar_url} name={u.display_name} size="small" />
                <span className="admin-row-main">
                  <strong>{u.display_name}</strong>
                  <small className="admin-mono">{u.id}</small>
                </span>
                {u.banned_at ? <span className="admin-badge danger">利用停止中</span> : <small className="admin-muted">{formatAdminDate(u.created_at)}</small>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-muted">該当するユーザーはいません。</p>
      )}
    </section>
  );
}

type SettingsProps = { userId: string; onBack: () => void; onNotice: (text: string) => void; onShowDms: (userId: string) => void };

// Per-user settings screen: profile facts, account status (ban / unban) and the user's posts.
function UserSettings({ userId, onBack, onNotice, onShowDms }: SettingsProps) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/admin/users/${encodeURIComponent(userId)}`;

  const load = useCallback(async () => {
    try {
      setDetail(await api<AdminUserDetail>(path));
    } catch (e) {
      onNotice(errorMessage(e, "ユーザーを読み込めませんでした。"));
    }
  }, [path, onNotice]);

  useEffect(() => { void load(); }, [load]);

  const ban = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (!confirm(`「${detail.user.display_name}」を利用停止にしますか？ ログイン中のセッションもすべて終了します。`)) return;
    setBusy(true);
    try {
      await api(`${path}/ban`, { method: "POST", body: JSON.stringify({ reason }) });
      setReason("");
      onNotice("利用停止にしました。");
      await load();
    } catch (err) {
      onNotice(errorMessage(err, "利用停止にできませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  const unban = async () => {
    setBusy(true);
    try {
      await api(`${path}/unban`, { method: "POST" });
      onNotice("利用停止を解除しました。");
      await load();
    } catch (err) {
      onNotice(errorMessage(err, "利用停止を解除できませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <div className="admin-loading"><LoaderCircle className="spin" size={16} />読み込み中…</div>;
  const u = detail.user;

  return (
    <div className="admin-stack">
      <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={16} />ユーザー一覧に戻る</button>

      <section className="admin-card admin-profile">
        <Avatar url={u.avatar_url} name={u.display_name} size="large" />
        <div className="admin-row-main">
          <h2>{u.display_name}</h2>
          <p className="admin-mono">{u.id}</p>
          <p>{u.email ?? "メールアドレス未登録"}</p>
          {u.bio && <p className="admin-muted">{u.bio}</p>}
          <p className="admin-muted small">
            登録 {formatAdminDate(u.created_at)} ・ 投稿 {detail.posts.length} ・ フォロワー {detail.followers} ・ フォロー中 {detail.following} ・ 有効なログイン {detail.activeSessions}
          </p>
        </div>
      </section>

      <section className="admin-card">
        <h3>アカウント設定</h3>
        {u.banned_at ? (
          <div className="admin-banned">
            <p><span className="admin-badge danger">利用停止中</span> {formatAdminDate(u.banned_at)} から</p>
            {u.banned_reason && <p className="admin-muted">理由: {u.banned_reason}</p>}
            <button type="button" className="outline-small" onClick={() => void unban()} disabled={busy}><Unlock size={15} />利用停止を解除</button>
          </div>
        ) : (
          <form className="admin-form" onSubmit={ban}>
            <label>
              利用停止の理由（任意・管理者のみ閲覧）
              <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} />
            </label>
            <div className="admin-actions-row">
              <button type="submit" className="admin-danger-button" disabled={busy}><Ban size={15} />このアカウントを利用停止</button>
            </div>
          </form>
        )}
        <div className="admin-actions-row">
          <button type="button" className="outline-small" onClick={() => onShowDms(userId)}><MessageCircle size={15} />このユーザーのDMを見る</button>
        </div>
      </section>

      <section className="admin-card">
        <h3>投稿（{detail.posts.length}件）</h3>
        <AdminPostList posts={detail.posts} onChanged={() => void load()} onNotice={onNotice} />
      </section>
    </div>
  );
}
