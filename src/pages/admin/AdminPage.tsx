import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { FileText, LoaderCircle, LogIn, LogOut, Lock, Megaphone, MessageCircle, ScrollText, ShieldCheck, Users } from "lucide-react";
import AuthOverlay from "../../components/AuthOverlay";
import NoticeBanner from "../../components/layout/NoticeBanner";
import { api } from "../../lib/api";
import { clearAuthPending, isAuthPending, markAuthPending } from "../../lib/authPending";
import { errorMessage } from "../../lib/errors";
import AnnouncementsPanel from "./AnnouncementsPanel";
import AuditPanel from "./AuditPanel";
import DmPanel from "./DmPanel";
import PostsPanel from "./PostsPanel";
import UsersPanel from "./UsersPanel";

type AdminStatus = {
  configured: boolean;
  gateOpen: boolean;
  isAdmin: boolean;
  user: { id: string; display_name: string; avatar_url: string | null } | null;
};
type Tab = "users" | "posts" | "announcements" | "dm" | "audit";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "users", label: "ユーザー", icon: Users },
  { id: "posts", label: "投稿", icon: FileText },
  { id: "announcements", label: "お知らせ", icon: Megaphone },
  { id: "dm", label: "DM", icon: MessageCircle },
  { id: "audit", label: "操作ログ", icon: ScrollText }
];

// Admin screen at /admin. Step 1: admin password. Step 2: Sennin Account login, which grants admin rights.
export default function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [authPending, setAuthPending] = useState(isAuthPending);
  const [redirecting, setRedirecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(() => new URLSearchParams(location.search).get("auth_error") ?? "");
  const [tab, setTab] = useState<Tab>("users");
  const [dmUserId, setDmUserId] = useState("");

  const tell = useCallback((text: string) => setNotice(text), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api<AdminStatus>("/admin/status"));
    } catch (e) {
      setNotice(errorMessage(e, "管理者の状態を確認できませんでした。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(location.search).has("auth_error")) history.replaceState({}, "", "/admin");
    void refresh();
  }, [refresh]);

  // The overlay that was carried over from the Sennin Account redirect ends when the status check finishes.
  useEffect(() => {
    if (!loading && authPending) {
      clearAuthPending();
      setAuthPending(false);
    }
  }, [loading, authPending]);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await api("/admin/unlock", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      await refresh();
    } catch (err) {
      setNotice(errorMessage(err, "パスワードを確認できませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  const startSenninLogin = () => {
    markAuthPending();
    setRedirecting(true);
    location.href = "/api/auth/login?mode=login";
  };

  const logout = async () => {
    setBusy(true);
    try {
      await api("/auth/logout", { method: "POST" });
      await refresh();
      tell("ログアウトしました。");
    } catch (e) {
      tell(errorMessage(e, "ログアウトできませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = status?.isAdmin === true;
  const showOverlay = redirecting || busy || (authPending && loading);

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div className="admin-brand"><ShieldCheck size={20} /><strong>SoraLink 管理画面</strong></div>
        {isAdmin && status?.user && (
          <div className="admin-who">
            <span>{status.user.display_name}</span>
            <button type="button" className="outline-small" onClick={() => void logout()} disabled={busy}>
              <LogOut size={14} />ログアウト
            </button>
          </div>
        )}
      </header>

      {notice && <div className="admin-notice"><NoticeBanner text={notice} onClose={() => setNotice("")} /></div>}

      <main className="admin-main">
        {!status && loading ? (
          <div className="admin-loading"><LoaderCircle className="spin" size={18} />確認しています…</div>
        ) : !status?.configured ? (
          <section className="admin-card admin-gate">
            <h1>管理画面は未設定です</h1>
            <p>サーバーの環境変数 <code>ADMIN_PASSWORD</code> を設定してから再起動してください。</p>
          </section>
        ) : !isAdmin ? (
          <section className="admin-card admin-gate">
            <div className="admin-gate-icon"><Lock size={22} /></div>
            {status.gateOpen ? (
              <>
                <h1>仙人アカウントでログイン</h1>
                <p>パスワードを確認しました。管理者にする仙人アカウントでログインしてください。このログインに限り、管理者権限が付与されます。</p>
                <button type="button" className="primary-button admin-wide" onClick={startSenninLogin} disabled={busy}>
                  <LogIn size={16} />仙人アカウントでログイン
                </button>
              </>
            ) : (
              <>
                <h1>管理者ログイン</h1>
                <p>管理者パスワードを入力してください。</p>
                <form className="admin-form" onSubmit={unlock}>
                  <label>
                    管理者パスワード
                    <input type="password" autoComplete="current-password" maxLength={200} required value={password} onChange={e => setPassword(e.target.value)} />
                  </label>
                  <button type="submit" className="primary-button admin-wide" disabled={busy || !password}>次へ</button>
                </form>
              </>
            )}
            {status.user && <p className="admin-muted small">現在のログイン: {status.user.display_name}（管理者ではありません）</p>}
            <p className="admin-muted small">管理者権限はログアウトするか、12時間が過ぎると無効になります。</p>
          </section>
        ) : (
          <>
            <nav className="admin-tabs" aria-label="管理メニュー">
              {TABS.map(item => {
                const Icon = item.icon;
                return (
                  <button key={item.id} type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                    <Icon size={16} />{item.label}
                  </button>
                );
              })}
            </nav>
            {tab === "users" && <UsersPanel onNotice={tell} onShowDms={id => { setDmUserId(id); setTab("dm"); }} />}
            {tab === "posts" && <PostsPanel onNotice={tell} />}
            {tab === "announcements" && <AnnouncementsPanel onNotice={tell} />}
            {tab === "dm" && <DmPanel key={dmUserId} initialUserId={dmUserId} onNotice={tell} />}
            {tab === "audit" && <AuditPanel onNotice={tell} />}
          </>
        )}
      </main>

      {showOverlay && (
        <AuthOverlay
          text={busy && !redirecting ? "確認中" : "認証中"}
          detail={busy && !redirecting ? "管理者パスワードを確認しています" : "Sennin Account でログインしています"}
        />
      )}
    </div>
  );
}
