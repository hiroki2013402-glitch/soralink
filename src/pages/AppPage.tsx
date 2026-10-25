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
import RelationsModal from "../components/RelationsModal";
import MessagesPage from "./messages/MessagesPage";
import ConversationPage from "./messages/ConversationPage";
import { onDmEvent, startDmRealtime, stopDmRealtime } from "../lib/dmRealtime";
import type { PostCardHandlers } from "../components/PostCard";
import type { NewPost } from "../components/CreatePost";
import { api } from "../lib/api";
import { optimizeImage } from "../lib/images";
import { errorMessage } from "../lib/errors";
import { parseRoute } from "../lib/route";
import type { Route, Tab } from "../lib/route";
import type { Notice, Person, Post, SearchResults, User } from "../types";
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
      const me = await api<{ user: User }>("/me").catch(() => null);
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

  // Initial load, and handle OAuth errors passed back in the query string.
  useEffect(() => {
    void load();
    const authError = new URLSearchParams(location.search).get("auth_error");
    if (authError) {
      tell(authError);
      history.replaceState({}, "", location.pathname);
    }
  }, [load, tell]);

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
  const openConversation = useCallback((id: string) => go(`/page/messages/${encodeURIComponent(id)}`), [go]);
  const goMessages = useCallback(() => go("/page/messages"), [go]);

  const createPost = async (input: NewPost) => {
    await api("/posts", { method: "POST", body: JSON.stringify(input) });
    await load(true);
    tell("投稿を公開しました。");
    go("/page/home");
  };

  const like = async (id: string) => {
    if (!user) return tell("いいねするにはログインしてください。");
    try {
      const r = await api<{ liked: boolean }>(`/posts/${id}/like`, { method: "POST" });
      setLiked(v => ({ ...v, [id]: r.liked }));
      const bump = (list: Post[]) => list.map(p => p.id === id ? { ...p, likes_count: Math.max(0, Number(p.likes_count) + (r.liked ? 1 : -1)) } : p);
      setPosts(bump);
      setProfilePosts(bump);
      setResults(r => r ? { ...r, posts: bump(r.posts) } : r);
    } catch (e) {
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
      const r = await api<{ user: User }>("/me/profile", { method: "PATCH", body: JSON.stringify(profileForm) });
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
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      go("/page/home", true);
      tell("ログアウトしました。");
    } catch (e) {
      tell(errorMessage(e, "ログアウトできませんでした"));
    }
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
    onNotice: tell
  };

  const activeTab = route.tab;

  if (!user) return <LoginPage />;

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

      <main className="main-layout">
        <SideNav user={user} activeTab={activeTab} unread={unread} dmUnread={dmUnread} onOpenTab={openTab} />

        <section className="main-column">
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
            route.conversationId ? (
              <ConversationPage
                key={route.conversationId}
                user={user}
                conversationId={route.conversationId}
                onBack={goMessages}
                onCountsChanged={refreshCounts}
                onNotice={tell}
              />
            ) : (
              <MessagesPage user={user} counts={dmCounts} onOpenConversation={openConversation} onNotice={tell} />
            )
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
            />
          )}

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

        <RightRail user={user} onOpenPost={openPost} onOpenProfile={openProfile} onNotice={tell} />
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
