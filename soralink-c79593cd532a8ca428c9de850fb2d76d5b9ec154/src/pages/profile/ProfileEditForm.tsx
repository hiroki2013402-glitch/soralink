import { Check, ImagePlus, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import Avatar from "../../components/Avatar";
import ImageCropper from "../../components/ImageCropper";
import type { ProfileForm, ProfileImageField } from "./profileForm";

type Props = {
  form: ProfileForm;
  uploading: ProfileImageField | null;
  saving: boolean;
  onChange: (patch: Partial<ProfileForm>) => void;
  onUploadImage: (field: ProfileImageField, file: File) => void;
  onSave: (e: FormEvent) => void;
  onCancel: () => void;
};

// The "プロフィールを編集" form: cover and avatar pickers, name, bio and link.
export default function ProfileEditForm({ form, uploading, saving, onChange, onUploadImage, onSave, onCancel }: Props) {
  const [cropping, setCropping] = useState<{ field: ProfileImageField; file: File } | null>(null);

  return (
    <form className="edit-profile" onSubmit={onSave}>
      <h2>プロフィールを編集</h2>
      <div className="edit-images">
        <label className="cover-picker" style={form.coverUrl ? { backgroundImage: `url("${form.coverUrl}")` } : {}}>
          <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading !== null} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setCropping({ field: "coverUrl", file: f }); }} />
          <span>{uploading === "coverUrl" ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}{uploading === "coverUrl" ? "アップロード中…" : "カバー画像を変更"}</span>
        </label>
        <label className="avatar-picker">
          <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading !== null} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setCropping({ field: "avatarUrl", file: f }); }} />
          <Avatar url={form.avatarUrl} name={form.displayName} size="large" />
          <span>{uploading === "avatarUrl" ? "アップロード中…" : "アイコンを変更"}</span>
        </label>
      </div>
      <label>ユーザー名<input required maxLength={80} value={form.displayName} onChange={e => onChange({ displayName: e.target.value })} /></label>
      <label>自己紹介<textarea maxLength={300} rows={3} value={form.bio} onChange={e => onChange({ bio: e.target.value })} placeholder="あなたについて" /></label>
      <label>リンク（https://）<input type="url" value={form.website} onChange={e => onChange({ website: e.target.value })} placeholder="https://example.com" /></label>
      <p className="form-help">画像はアップロード前に表示範囲を調整できます。アイコンは円形、カバー画像は横長に切り抜きます。</p>
      {cropping && (
        <ImageCropper
          file={cropping.file}
          shape={cropping.field === "avatarUrl" ? "circle" : "wide"}
          onCancel={() => setCropping(null)}
          onConfirm={cropped => {
            const field = cropping.field;
            setCropping(null);
            onUploadImage(field, cropped);
          }}
        />
      )}
      <div className="edit-actions">
        <button type="button" className="outline-small" onClick={onCancel}>キャンセル</button>
        <button className="primary-button" disabled={saving || uploading !== null}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存する</button>
      </div>
    </form>
  );
}
