import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { optimizeImage } from "../lib/images";
import type { User } from "../types";
import Avatar from "./Avatar";

export type NewPost = { mediaType?: "image" | "video"; mediaUrl?: string; caption: string };
type Props = { user: User; onCreate: (input: NewPost) => Promise<void> };

const MAX_LENGTH = 500;
const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function CreatePost({ user, onCreate }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const mediaType: "image" | "video" = file?.type.startsWith("video/") ? "video" : "image";
  const trimmed = text.trim();
  const remaining = MAX_LENGTH - text.length;
  const canPost = !busy && (trimmed.length > 0 || file !== null) && remaining >= 0;

  const clearFile = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setError("");
    try {
      let mediaUrl: string | undefined;
      if (file) {
        const body = new FormData();
        body.append("file", await optimizeImage(file));
        const uploaded = await api<{ url: string }>("/media/upload", { method: "POST", body });
        mediaUrl = uploaded.url;
      }
      await onCreate({ mediaType: file ? mediaType : undefined, mediaUrl, caption: trimmed });
      setText("");
      clearFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "投稿できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  const ratio = Math.min(1, Math.max(0, text.length / MAX_LENGTH));

  return (
    <form className="x-composer" onSubmit={submit}>
      <div className="x-composer-row">
        <Avatar url={user.avatar_url} name={user.display_name} />
        <div className="x-composer-main">
          <textarea
            className="x-composer-text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="いま、何してる？"
            rows={4}
            maxLength={MAX_LENGTH + 50}
            aria-label="投稿内容"
            autoFocus
          />

          {previewUrl && (
            <div className="x-composer-media">
              {mediaType === "image" ? <img src={previewUrl} alt="添付した画像のプレビュー" /> : <video src={previewUrl} controls playsInline />}
              <button type="button" className="x-media-remove" onClick={clearFile} aria-label="添付を削除"><X size={16} /></button>
            </div>
          )}

          {error && <p className="x-composer-error" role="alert">{error}</p>}

          <div className="x-composer-bar">
            <button
              type="button"
              className="x-tool-button"
              onClick={() => inputRef.current?.click()}
              aria-label="写真または動画を追加"
              title="写真・動画を追加"
              disabled={busy}
            >
              <ImagePlus size={20} />
            </button>
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />

            <div className="x-composer-end">
              <svg className="x-ring" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r={RING_RADIUS} className="track" />
                <circle
                  cx="12"
                  cy="12"
                  r={RING_RADIUS}
                  className={`bar ${remaining <= 20 ? "warn" : ""}`}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
                  transform="rotate(-90 12 12)"
                />
              </svg>
              {remaining <= 20 && <span className={`x-count ${remaining < 0 ? "over" : ""}`}>{remaining}</span>}
              <button className="x-post-button" disabled={!canPost}>
                {busy && <LoaderCircle className="spin" size={16} />}
                {busy ? "投稿中" : "投稿する"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
