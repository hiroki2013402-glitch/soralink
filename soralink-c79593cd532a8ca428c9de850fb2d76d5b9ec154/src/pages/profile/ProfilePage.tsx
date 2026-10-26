import { ImagePlus, Link as LinkIcon, LogOut, Settings, LoaderCircle, Star } from "lucide-react";
import type { FormEvent } from "react";
import Avatar from "../../components/Avatar";
import PostCard from "../../components/PostCard";
import type { PostCardHandlers } from "../../components/PostCard";
import { handleOf } from "../../lib/format";
import type { Post, User } from "../../types";
import ProfileEditForm from "./ProfileEditForm";
import type { ProfileForm, ProfileImageField } from "./profileForm";

type Props = {
  user: User;                 // the signed-in user
  profile: User | null;       // the user whose profile is shown (null while loading)
  profilePosts: Post[];
  followers: number;
  following: number;
  followed: boolean;
  editing: boolean;
  form: ProfileForm;
  uploading: ProfileImageField | null;
  saving: boolean;
  liked: Record<string, boolean>;
  cardProps: PostCardHandlers;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onFormChange: (patch: Partial<ProfileForm>) => void;
  onUploadImage: (field: ProfileImageField, file: File) => void;
  onSave: (e: FormEvent) => void;
  onLogout: () => void;
  onToggleFollow: (id: string) => void;
  onOpenRelations: (type: "followers" | "following") => void;
  onOpenCloseFriends: () => void;
};

// Profile tab: header (cover, avatar, follow/edit), stats, and the user's posts.
export default function ProfilePage(props: Props) {
  const { user, profile, profilePosts, followers, following, followed, editing, liked, cardProps } = props;

  if (!profile) {
    return (
      <section className="profile-page">
        <div className="loading-state"><LoaderCircle className="spin" />プロフィールを読み込み中…</div>
      </section>
    );
  }

  return (
    <section className="profile-page">
      <div className="cover-photo" style={profile.cover_url ? { backgroundImage: `linear-gradient(0deg,#142d4b30,#142d4b08),url("${profile.cover_url}")` } : {}}>
        <span className="cover-decoration"><LinkIcon size={52} /></span>
      </div>
      <div className="profile-main">
        <div className="profile-head">
          <Avatar url={profile.avatar_url} name={profile.display_name} size="large" />
          <div className="profile-actions">
            {profile.id === user.id ? (
              <>
                <button className="outline-small" onClick={props.onOpenCloseFriends}><Star size={15} />親しい友達</button>
                <button className="outline-small" onClick={props.onStartEdit}><Settings size={15} />プロフィールを編集</button>
                <button className="outline-small logout-small" onClick={props.onLogout}><LogOut size={14} />ログアウト</button>
              </>
            ) : (
              <button className="primary-button" onClick={() => props.onToggleFollow(profile.id)}>{followed ? "フォロー中" : "フォロー"}</button>
            )}
          </div>
        </div>

        {editing ? (
          <ProfileEditForm
            form={props.form}
            uploading={props.uploading}
            saving={props.saving}
            onChange={props.onFormChange}
            onUploadImage={props.onUploadImage}
            onSave={props.onSave}
            onCancel={props.onCancelEdit}
          />
        ) : (
          <>
            <h1 className="profile-name">{profile.display_name}</h1>
            <p className="profile-handle">{handleOf(profile.id)}</p>
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            {profile.website && <a className="profile-link" href={profile.website} target="_blank" rel="noreferrer"><LinkIcon size={15} />{profile.website.replace(/^https?:\/\//, "")}</a>}
            <div className="profile-stats">
              <span><strong>{profilePosts.length}</strong>投稿</span>
              <button type="button" onClick={() => props.onOpenRelations("followers")}><strong>{followers}</strong>フォロワー</button>
              <button type="button" onClick={() => props.onOpenRelations("following")}><strong>{following}</strong>フォロー中</button>
            </div>
            {profilePosts.length ? (
              <div className="post-list profile-posts">
                {profilePosts.map(p => <PostCard key={p.id} post={p} liked={!!liked[p.id]} {...cardProps} />)}
              </div>
            ) : (
              <div className="empty-state"><div className="empty-art"><ImagePlus size={26} /></div><h3>投稿はまだありません</h3><p>公開した投稿がここに表示されます。</p></div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
