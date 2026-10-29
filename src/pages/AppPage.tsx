import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import LoginPage from "./login/LoginPage";
import HomePage from "./home/HomePage";
import SearchPage from "./search/SearchPage";
import CreatePage from "./create/CreatePage";
import NotificationsPage from "./notifications/NotificationsPage";
import ProfilePage from "./profile/ProfilePage";
import { blankProfile } from "./profile/profileForm";
import type { ProfileForm, ProfileImageField } from "./profile/profileForm";
import { PostDetailPage } from "./post/PostDetailPage";
import { ImageDetailPage } from "./post/ImageDetailPage";
import TopBar from "../components/layout/TopBar";
import SideNav from "../components/layout/SideNav";
import BottomNav from "../components/layout/BottomNav";
import RightRail from "../components/layout/RightRail";
import NoticeBanner from "../components/layout/NoticeBanner";
import AuthOverlay from "../components/AuthOverlay";
import AnnouncementBanners from "../components/AnnouncementBanners";
import { clearAuthPending, isAuthPending } from "../lib/authPending";
import RelationsModal from "../components/RelationsModal";
import MessagesPage from "./messages/MessagesPage";
import ConversationPage, { DmEmptyPane } from "./messages/ConversationPage";
import { onDmEvent, startDmRealtime, stopDmRealtime } from "../lib/dmRealtime";
import type { PostCardHandlers } from "../components/PostCard";
import type { NewPost } from "../components/CreatePost";
import { api } from "../lib/api";
import { optimizeImage } from "../lib/images";
import { errorMessage } from "../lib/errors";
import { currentEndpoint, disablePush } from "../lib/push";
import { loadPrefs, savePrefs } from "../lib/preferences";
import type { Prefs } from "../lib/preferences";
import SettingsPage from "./settings/SettingsPage";
import StatusPage from "./status/StatusPage";
import type { NotificationSettings } from "./settings/SettingsPage";
import { parseRoute } from "../lib/route";
import type { Route, Tab } from "../lib/route";
import type { Announcement, Notice, Person, Post, SearchResults, User } from "../types";
import CloseFriendsModal from "../components/CloseFriendsModal";

// App shell for signed-in pages. Owns the shared state and the route; each page lives in its own file under pages/.
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [closeFriendsOpen, setCloseFriendsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [dmCounts, setDmCounts] = useState<Record<string, number>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // True while returning from Sennin Account: the 認証中 overlay stays until the first load finishes.
  const [authPending, setAuthPending] = useState(isAuthPending);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [profilePosts, setProfilePosts] = useState<Post[]>([]);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [followed, setFollowed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(blankProfile);
  const [uploading, setUploading] = useState<ProfileImageField | null>(null);
  const [saving, setSaving] = useState(false);
  const [relationType, setRelationType] = useState<"followers" | "following" | null>(null);
  const [relationUsers, setRelationUsers] = useState<Person[]>([]);
  const [relationLoading, setRelationLoading] = useState(false);

  const noticeTimer = useRef<number | undefined>(undefined);
  const canGoBack = useRef(false);
  const visitedOtherTab = useRef(false);

  const tell = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 3500);
  }, []);

  const go = useCallback((path: string, replace = false) => {
    if (location.pathname !== path) {
      if (replace) history.replaceState({ app: true }, "", path);
      else { history.pushState({ app: true }, "", path); canGoBack.current = true; }
    }
    setRoute(parseRoute(path));
  }, []);

  const goBack = useCallback(() => {
    if (canGoBack.current) history.back();
    else go("/page/home");
  }, [go]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(""); }
    try {
      const feed = await api<{ posts: Post[] }>("/feed");
      setPosts(feed.posts);
      // A suspended account gets a clear message here instead of a silent return to the login screen.
      const me = await api<{ user: User }>("/me").catch((e: unknown) => {
        if (e instanceof Error && e.message.includes("利用停止")) tell(e.message);
        return null;
      });
      setUser(me?.user ?? null);
      if (me) {
        const mine = await api<{ ids: string[] }>("/likes/mine").catch(() => ({ ids: [] as string[] }));
        setLiked(Object.fromEntries(mine.ids.map(id => [id, true])));
      } else {
        setLiked({});
      }
    } catch (e) {
      if (!silent) setError(errorMessage(e, "読み込みに失敗しました。"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    try {
      const r = await api<{ user: User; posts: Post[]; followers: number; following: number; isFollowing: boolean }>(`/users/${encodeURIComponent(id)}`);
      setProfile(r.user);
      setProfilePosts(r.posts);
      setFollowers(r.followers);
      setFollowing(r.following);
      setFollowed(r.isFollowing);
      setEditing(false);
    } catch (e) {
      tell(errorMessage(e, "プロフィールを開けませんでした"));
    }
  }, [tell]);

  // Unread counts for the nav badges. Polled every 30s, refreshed on return to the tab, and on every DM event.
  const refreshCounts = useCallback(async () => {
    const [n, d] = await Promise.all([
      api<{ count: number }>("/notifications/unread-count").catch(() => null),
      api<{ total: number; counts: Record<string, number> }>("/dm/unread").catch(() => null)
    ]);
    if (n) setUnread(n.count);
    if (d) {
      setDmUnread(d.total);
      setDmCounts(d.counts);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshCounts();
    const timer = window.setInterval(() => void refreshCounts(), 30000);
    const onVisible = () => { if (document.visibilityState === "visible") void refreshCounts(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id, refreshCounts]);

  // Supabase Realtime connection for direct messages.
  useEffect(() => {
    if (!user) return;
    void startDmRealtime(user.id);
    const off = onDmEvent(() => { void refreshCounts(); });
    return () => {
      off();
      stopDmRealtime();
    };
  }, [user?.id, refreshCounts]);

  useEffect(() => {
    if (!user) return;
    api<{ announcements: Announcement[] }>("/announcements")
      .then(r => setAnnouncements(r.announcements))
      .catch(() => setAnnouncements([]));
  }, [user?.id]);

  // Presence: tell the server this user is here. Sent while the tab is visible, so "online" means the app is open and in front.
  useEffect(() => {
    if (!user) return;
    // The heartbeat carries this browser's push endpoint, so the server knows which device has the app open.
    // The server counts a device as open for 10 seconds after its last heartbeat, so the beat is kept well inside that.
    const HEARTBEAT_MS = 4000;
    let endpoint: string | null = null;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      void currentEndpoint()
        .catch(() => null)
        .then(found => {
          endpoint = found;
          return api("/dm/presence", { method: "POST", body: JSON.stringify({ endpoint: found }) }).catch(() => undefined);
        });
    };
    // Closing the page tells the server straight away, instead of waiting for the heartbeat to lapse.
    const closed = () => {
      if (!endpoint) return;
      navigator.sendBeacon("/api/dm/presence/leave", new Blob([JSON.stringify({ endpoint })], { type: "application/json" }));
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("pagehide", closed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("pagehide", closed);
    };
  }, [user?.id]);

  // Initial load, and handle OAuth errors passed back in the query string.
  useEffect(() => {
    void load();
    const authError = new URLSearchParams(location.search).get("auth_error");
    if (authError) {
      tell(authError);
      history.replaceState({}, "", location.pathname);
    }
  }, [load, tell]);

  useEffect(() => {
    if (!loading && authPending) {
      clearAuthPending();
      setAuthPending(false);
    }
  }, [loading, authPending]);

  // Browser back/forward.
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Land on the home tab after login when the URL is not an app page.
  useEffect(() => {
    if (user && !location.pathname.startsWith("/page/")) go("/page/home", true);
  }, [user?.id, go]);

  // Keep the feed's counts fresh when coming back from a post or profile.
  useEffect(() => {
    if (route.tab !== "home") { visitedOtherTab.current = true; return; }
    if (visitedOtherTab.current) void load(true);
  }, [route, load]);

  useEffect(() => {
    if (route.tab !== "profile" || !user) return;
    void loadProfile(profileId ?? user.id);
  }, [route, profileId, user?.id, loadProfile]);

  useEffect(() => {
    if (route.tab !== "notifications" || !user) return;
    api<{ notifications: Notice[] }>("/notifications")
      .then(r => {
        setNotifications(r.notifications);
        setUnread(0);
        return api("/notifications/read", { method: "POST" });
      })
      .catch(e => tell(errorMessage(e)));
  }, [route, user?.id, tell]);

  const openProfile = (id: string) => {
    if (id !== profileId) setProfile(null);
    setProfileId(id);
    go("/page/profile");
  };

  // Tab navigation. The profile tab always opens the signed-in user's own profile.
  const openTab = (tab: Tab) => {
    if (tab === "profile") {
      if (user) openProfile(user.id);
      return;
    }
    go(`/page/${tab}`);
  };

  const openPost = (id: string) => go(`/page/post/${encodeURIComponent(id)}`);
  const openImage = (id: string) => go(`/page/post/${encodeURIComponent(id)}/image`);
  // A chat opened with a quoted note carries that quote; any other open clears it.
  const [dmQuote, setDmQuote] = useState<{ conversationId: string; text: string } | null>(null);
  const openConversation = useCallback((id: string, quote?: string) => {
    setDmQuote(quote ? { conversationId: id, text: quote } : null);
    go(`/page/messages/${encodeURIComponent(id)}`);
  }, [go]);
  const goMessages = useCallback(() => go("/page/messages"), [go]);

  const createPost = async (input: NewPost) => {
    await api("/posts", { method: "POST", body: JSON.stringify(input) });
    await load(true);
    tell("投稿を公開しました。");
    go("/page/home");
  };

  // Likes: a press is ignored while the last one is still being saved, and for a moment after it (the server allows one toggle every 3 seconds).
  const LIKE_COOLDOWN_MS = 3_000;
  const likeBusyRef = useRef<Map<string, number>>(new Map());
  const likedRef = useRef(liked);
  useEffect(() => { likedRef.current = liked; }, [liked]);

  // Shows a like straight away, and moves the count by the change it causes.
  const applyLike = (id: string, isLiked: boolean, change: number) => {
    likedRef.current = { ...likedRef.current, [id]: isLiked };
    setLiked(likedRef.current);
    const bump = (list: Post[]) => list.map(p => p.id === id ? { ...p, likes_count: Math.max(0, Number(p.likes_count) + change) } : p);
    setPosts(bump);
    setProfilePosts(bump);
    setResults(r => r ? { ...r, posts: bump(r.posts) } : r);
  };

  const like = async (id: string) => {
    if (!user) return tell("いいねするにはログインしてください。");
    const busySince = likeBusyRef.current.get(id);
    if (busySince !== undefined && Date.now() - busySince < LIKE_COOLDOWN_MS) return tell("いいねは少し間を空けてお試しください。");
    likeBusyRef.current.set(id, Number.POSITIVE_INFINITY);

    const wasLiked = Boolean(likedRef.current[id]);
    const delta = wasLiked ? -1 : 1;
    applyLike(id, !wasLiked, delta);
    try {
      const r = await api<{ liked: boolean }>(`/posts/${id}/like`, { method: "POST" });
      likeBusyRef.current.set(id, Date.now());
      // The server has the final say. Correct the count if it did not make the change we showed.
      if (r.liked !== !wasLiked) {
        const serverDelta = r.liked === wasLiked ? 0 : (r.liked ? 1 : -1);
        applyLike(id, r.liked, serverDelta - delta);
      }
    } catch (e) {
      // Refused (too many presses) keeps the cooldown; other failures allow an immediate retry.
      likeBusyRef.current.set(id, Date.now());
      applyLike(id, wasLiked, -delta);
      tell(errorMessage(e, "いいねできませんでした"));
    }
  };

  const removePost = async (id: string) => {
    if (!confirm("この投稿を削除しますか？")) return;
    try {
      await api(`/posts/${id}`, { method: "DELETE" });
      setPosts(v => v.filter(p => p.id !== id));
      setProfilePosts(v => v.filter(p => p.id !== id));
      setResults(r => r ? { ...r, posts: r.posts.filter(p => p.id !== id) } : r);
      tell("投稿を削除しました。");
      if (route.tab === "post") goBack();
    } catch (e) {
      tell(errorMessage(e, "削除できませんでした"));
    }
  };

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!user) return tell("検索にはログインしてください。");
    go("/page/search");
    const q = search.trim();
    if (!q) return setResults(null);
    try {
      setResults(await api<SearchResults>(`/search?q=${encodeURIComponent(q)}`));
    } catch (err) {
      tell(errorMessage(err, "検索できませんでした"));
    }
  };

  // Tapping a #hashtag runs the same search as typing "#tag" in the search box.
  const searchFor = async (q: string) => {
    if (!user) return tell("検索にはログインしてください。");
    setSearch(q);
    go("/page/search");
    try {
      setResults(await api<SearchResults>(`/search?q=${encodeURIComponent(q)}`));
    } catch (err) {
      tell(errorMessage(err, "検索できませんでした"));
    }
  };

  const toggleFollow = async (id: string) => {
    try {
      const r = await api<{ following: boolean }>(`/users/${id}/follow`, { method: "POST" });
      setFollowed(r.following);
      setFollowers(n => Math.max(0, n + (r.following ? 1 : -1)));
      tell(r.following ? "フォローしました。" : "フォローを解除しました。");
    } catch (e) {
      tell(errorMessage(e, "フォローできませんでした"));
    }
  };

  const openRelations = async (type: "followers" | "following") => {
    if (!profile) return;
    setRelationType(type);
    setRelationLoading(true);
    try {
      const r = await api<{ users: Person[] }>(`/users/${encodeURIComponent(profile.id)}/relations?type=${type}`);
      setRelationUsers(r.users);
    } catch (e) {
      tell(errorMessage(e, "一覧を読み込めませんでした"));
      setRelationType(null);
    } finally {
      setRelationLoading(false);
    }
  };

  const uploadProfileImage = async (field: ProfileImageField, file: File) => {
    setUploading(field);
    try {
      const body = new FormData();
      body.append("file", await optimizeImage(file, field === "avatarUrl" ? 1024 : 1920));
      const r = await api<{ url: string }>("/media/upload", { method: "POST", body });
      setProfileForm(v => ({ ...v, [field]: r.url }));
      tell("画像をアップロードしました。「保存する」で反映されます。");
    } catch (e) {
      tell(errorMessage(e, "画像をアップロードできませんでした"));
    } finally {
      setUploading(null);
    }
  };

  const startEdit = () => {
    if (!profile) return;
    setProfileForm({ displayName: profile.display_name || "", bio: profile.bio || "", website: profile.website || "", avatarUrl: profile.avatar_url || "", coverUrl: profile.cover_url || "" });
    setEditing(true);
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api<{ user: User }>("/me/profile", { method: "POST", body: JSON.stringify(profileForm) });
      setUser(r.user);
      setProfile(r.user);
      setEditing(false);
      tell("プロフィールを保存しました。");
    } catch (e) {
      tell(errorMessage(e, "保存できませんでした"));
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    try {
      // Stop notifications for this account on this device first, but never wait long for it.
      await Promise.race([disablePush(), new Promise(resolve => window.setTimeout(resolve, 1500))]);
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      go("/page/home", true);
      tell("ログアウトしました。");
    } catch (e) {
      tell(errorMessage(e, "ログアウトできませんでした"));
    }
  };

  // Account notification settings: loaded for the signed-in user, changed optimistically and confirmed by the server.
  useEffect(() => {
    if (!user) { setSettings(null); return; }
    api<{ settings: NotificationSettings }>("/me/settings")
      .then(r => setSettings(r.settings))
      .catch(() => setSettings(null));
  }, [user?.id]);

  const changeSettings = async (patch: Partial<NotificationSettings>) => {
    const before = settings;
    if (!before) return;
    setSettings({ ...before, ...patch });
    try {
      const r = await api<{ settings: NotificationSettings }>("/me/settings", { method: "PATCH", body: JSON.stringify(patch) });
      setSettings(r.settings);
    } catch (e) {
      setSettings(before);
      tell(errorMessage(e, "設定を保存できませんでした"));
    }
  };

  const changePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const openNotification = (n: Notice) => {
    if (n.kind === "like" && n.post_id) openPost(n.post_id);
    else openProfile(n.actor_id);
  };

  const cardProps: PostCardHandlers = {
    user,
    onLike: (id: string) => void like(id),
    onDelete: (id: string) => void removePost(id),
    onProfile: openProfile,
    onOpen: openPost,
    onOpenImage: openImage,
    onNotice: tell,
    onHashtag: (tag: string) => void searchFor(`#${tag}`)
  };

  const activeTab = route.tab;

  if (!user) {
    return (
      <>
        {notice && <NoticeBanner text={notice} onClose={() => setNotice("")} />}
        <LoginPage />
        {authPending && <AuthOverlay />}
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        user={user}
        activeTab={activeTab}
        unread={unread}
        dmUnread={dmUnread}
        search={search}
        onSearchChange={setSearch}
        onSubmitSearch={runSearch}
        onOpenTab={openTab}
        onOpenPost={openPost}
        onOpenProfile={openProfile}
      />

      <main className={`main-layout ${activeTab === "messages" ? "dm-mode" : ""}`}>
        <SideNav user={user} activeTab={activeTab} unread={unread} dmUnread={dmUnread} onOpenTab={openTab} />

        <section className="main-column">
          <AnnouncementBanners items={announcements} />
          {notice && <NoticeBanner text={notice} onClose={() => setNotice("")} />}

          {activeTab === "home" && (
            <HomePage
              posts={posts}
              loading={loading}
              error={error}
              liked={liked}
              cardProps={cardProps}
              onReload={() => void load()}
              onCreate={() => openTab("create")}
            />
          )}

          {activeTab === "search" && (
            <SearchPage
              search={search}
              results={results}
              liked={liked}
              cardProps={cardProps}
              onSearchChange={setSearch}
              onSubmit={runSearch}
              onOpenProfile={openProfile}
            />
          )}

          {activeTab === "create" && <CreatePage user={user} onCreate={createPost} />}

          {activeTab === "notifications" && (
            <NotificationsPage notifications={notifications} onOpenNotification={openNotification} />
          )}

          {activeTab === "messages" && (
            <div className={`dm-shell ${route.conversationId ? "has-chat" : ""}`}>
              <MessagesPage
                user={user}
                counts={dmCounts}
                selectedId={route.conversationId}
                onOpenConversation={openConversation}
                onNotice={tell}
              />
              {route.conversationId ? (
                <ConversationPage
                  key={route.conversationId}
                  user={user}
                  conversationId={route.conversationId}
                  onBack={goMessages}
                  onCountsChanged={refreshCounts}
                  onNotice={tell}
                  onOpenProfile={openProfile}
                  quote={dmQuote?.conversationId === route.conversationId ? dmQuote : null}
                />
              ) : (
                <DmEmptyPane />
              )}
            </div>
          )}

          {activeTab === "profile" && (
            <ProfilePage
              user={user}
              profile={profile}
              profilePosts={profilePosts}
              followers={followers}
              following={following}
              followed={followed}
              editing={editing}
              form={profileForm}
              uploading={uploading}
              saving={saving}
              liked={liked}
              cardProps={cardProps}
              onStartEdit={startEdit}
              onCancelEdit={() => setEditing(false)}
              onFormChange={patch => setProfileForm(v => ({ ...v, ...patch }))}
              onUploadImage={(field, file) => void uploadProfileImage(field, file)}
              onSave={saveProfile}
              onLogout={() => void logout()}
              onToggleFollow={id => void toggleFollow(id)}
              onOpenRelations={type => void openRelations(type)}
              onOpenCloseFriends={() => setCloseFriendsOpen(true)}
              onOpenSettings={() => go("/page/settings")}
            />
          )}

          {activeTab === "settings" && (
            <SettingsPage
              user={user}
              settings={settings}
              prefs={prefs}
              onChangeSettings={patch => void changeSettings(patch)}
              onChangePrefs={changePrefs}
              onEditProfile={() => void openProfile(user.id)}
              onLogout={() => void logout()}
              onNotice={tell}
              onOpenStatus={() => go("/page/status")}
            />
          )}

          {activeTab === "status" && <StatusPage />}

          {activeTab === "post" && route.postId && !route.image && (
            <PostDetailPage
              key={route.postId}
              postId={route.postId}
              user={user}
              onBack={goBack}
              onProfile={openProfile}
              onOpenImage={openImage}
              onDelete={id => void removePost(id)}
              onNotice={tell}
            />
          )}
        </section>

        {activeTab !== "messages" && <RightRail user={user} onOpenPost={openPost} onOpenProfile={openProfile} onNotice={tell} />}
      </main>

      <BottomNav activeTab={activeTab} unread={unread} dmUnread={dmUnread} onOpenTab={openTab} />

      {activeTab === "post" && route.postId && route.image && (
        <ImageDetailPage key={route.postId} postId={route.postId} onBack={goBack} />
      )}

      {closeFriendsOpen && <CloseFriendsModal onClose={() => setCloseFriendsOpen(false)} onNotice={tell} />}

      {relationType && (
        <RelationsModal
          type={relationType}
          users={relationUsers}
          loading={relationLoading}
          onClose={() => setRelationType(null)}
          onOpenProfile={openProfile}
        />
      )}
    </div>
  );
}
