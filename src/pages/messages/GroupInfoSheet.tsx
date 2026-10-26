import { Camera, LoaderCircle, LogOut, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import Avatar from "../../components/Avatar";
import ImageCropper from "../../components/ImageCropper";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { DmDetailConversation, DmMember, DmRole } from "../../types";

export const ROLE_LABEL: Record<DmRole, string> = {
  owner: "オーナー",
  sub_admin: "サブ管理人",
  member: "メンバー"
};

type Props = {
  meId: string;
  conversation: DmDetailConversation;
  onClose: () => void;
  // Called after a change succeeds. The parent reloads the header and tells the other members.
  onChanged: () => void;
  onAddMembers: () => void;
  onLeave: () => void;
  onNotice: (text: string) => void;
};

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 200;

// Group information: icon, name, description, members with roles, and the owner/sub-admin actions.
export default function GroupInfoSheet({ meId, conversation, onClose, onChanged, onAddMembers, onLeave, onNotice }: Props) {
  const myRole: DmRole = conversation.my_role ?? "member";
  const canManage = myRole !== "member";
  const enc = encodeURIComponent(conversation.id);

  const [title, setTitle] = useState(conversation.title ?? "");
  const [description, setDescription] = useState(conversation.description ?? "");
  const [saving, setSaving] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  // Keep the form in step with the saved values when they change elsewhere.
  useEffect(() => { setTitle(conversation.title ?? ""); }, [conversation.title]);
  useEffect(() => { setDescription(conversation.description ?? ""); }, [conversation.description]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !iconFile) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [iconFile, onClose]);

  const dirty = title.trim() !== (conversation.title ?? "") || description.trim() !== (conversation.description ?? "");

  const saveInfo = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await api(`/dm/conversations/${enc}/info`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim(), description: description.trim() })
      });
      onChanged();
    } catch (e) {
      onNotice(errorMessage(e, "グループ情報を保存できませんでした"));
    } finally {
      setSaving(false);
    }
  };

  const pickIcon = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return onNotice("画像ファイルを選択してください。");
    setIconFile(file);
  };

  const uploadIcon = async (file: File) => {
    setIconFile(null);
    setUploadingIcon(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await api(`/dm/conversations/${enc}/icon`, { method: "PUT", body });
      onChanged();
    } catch (e) {
      onNotice(errorMessage(e, "アイコンを変更できませんでした"));
    } finally {
      setUploadingIcon(false);
    }
  };

  const changeRole = async (member: DmMember, role: "sub_admin" | "member") => {
    setRoleBusyId(member.id);
    try {
      await api(`/dm/conversations/${enc}/members/${encodeURIComponent(member.id)}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      onChanged();
    } catch (e) {
      onNotice(errorMessage(e, "役職を変更できませんでした"));
    } finally {
      setRoleBusyId(null);
    }
  };

  const groupName = conversation.title || conversation.members.map(m => m.display_name).join("、");
  const memberCount = conversation.members.length;

  return (
    <div className="dm-backdrop" onClick={onClose}>
      <section className="dm-sheet dm-info-sheet" role="dialog" aria-modal="true" aria-label="グループ情報" onClick={e => e.stopPropagation()}>
        <header className="dm-sheet-head">
          <button type="button" className="dm-icon-btn" onClick={onClose} aria-label="閉じる"><X size={22} /></button>
          <strong>グループ情報</strong>
          <span className="dm-sheet-spacer" aria-hidden="true" />
        </header>

        <div className="dm-info-body">
          <div className="dm-info-hero">
            <button
              type="button"
              className="dm-info-icon"
              onClick={() => canManage && iconInput.current?.click()}
              disabled={!canManage || uploadingIcon}
              aria-label={canManage ? "グループアイコンを変更" : "グループアイコン"}
            >
              <Avatar url={conversation.icon_url ?? null} name={groupName} size="large" />
              {uploadingIcon && <span className="dm-info-icon-busy"><LoaderCircle className="spin" size={22} /></span>}
              {canManage && !uploadingIcon && <span className="dm-info-icon-edit"><Camera size={15} /></span>}
            </button>
            <input ref={iconInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="visually-hidden" onChange={pickIcon} />
            <small className="dm-info-count">{memberCount}人のグループ</small>
          </div>

          <label className="dm-info-field">
            <span>グループ名</span>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={TITLE_MAX} placeholder="未設定（メンバー名で表示）" disabled={!canManage} />
          </label>
          <label className="dm-info-field">
            <span>説明 <small>{description.length}/{DESCRIPTION_MAX}</small></span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={DESCRIPTION_MAX} rows={3} placeholder="グループの説明を入力" disabled={!canManage} />
          </label>
          {canManage && (
            <div className="dm-info-save">
              {dirty && <button type="button" className="dm-primary-btn" onClick={() => void saveInfo()} disabled={saving}>{saving ? "保存中…" : "保存"}</button>}
            </div>
          )}

          <div className="dm-info-section-head">
            <strong>メンバー</strong>
            {canManage && <button type="button" className="dm-outline-btn" onClick={onAddMembers}><UserPlus size={15} />追加</button>}
          </div>
          <ul className="dm-info-members">
            {conversation.members.map(m => {
              const role: DmRole = m.role ?? "member";
              const canPromote = canManage && role === "member";
              const canDemote = myRole === "owner" && role === "sub_admin";
              const busy = roleBusyId === m.id;
              return (
                <li key={m.id} className="dm-info-member">
                  <Avatar url={m.avatar_url} name={m.display_name} />
                  <span className="dm-info-person">
                    <strong>{m.display_name}{m.id === meId ? "（あなた）" : ""}</strong>
                    <small className={`dm-role role-${role}`}>{ROLE_LABEL[role]}</small>
                  </span>
                  {canPromote && (
                    <button type="button" className="dm-outline-btn" onClick={() => void changeRole(m, "sub_admin")} disabled={busy}>
                      {busy ? <LoaderCircle className="spin" size={14} /> : "サブ管理人にする"}
                    </button>
                  )}
                  {canDemote && (
                    <button type="button" className="dm-outline-btn" onClick={() => void changeRole(m, "member")} disabled={busy}>
                      {busy ? <LoaderCircle className="spin" size={14} /> : "メンバーに戻す"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <button type="button" className="dm-leave-btn" onClick={onLeave}><LogOut size={16} />グループから退出</button>
        </div>

        {iconFile && (
          <ImageCropper
            file={iconFile}
            shape="circle"
            onCancel={() => setIconFile(null)}
            onConfirm={cropped => void uploadIcon(cropped)}
          />
        )}
      </section>
    </div>
  );
}
