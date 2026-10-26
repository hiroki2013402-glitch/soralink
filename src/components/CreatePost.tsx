import { Globe, ImagePlus, ListChecks, LoaderCircle, Plus, Star, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { api } from "../lib/api";
import { optimizeImage } from "../lib/images";
import type { Person, User, Visibility } from "../types";
import { VISIBILITY_OPTIONS } from "../lib/visibility";
import { uploadVideo, VIDEO_MAX_BYTES, VIDEO_TYPES } from "../lib/video";
import Avatar from "./Avatar";
import VideoPlayer from "./VideoPlayer";

export type NewPost = { mediaType?: "image" | "video"; mediaUrl?: string; videoId?: string; caption: string; visibility: Visibility; poll?: { options: string[] } };
type Props = { user: User; onCreate: (input: NewPost) => Promise<void> };

const MAX_LENGTH = 500;
const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/gif", ...VIDEO_TYPES].join(",");
// Photos above this size get a smaller copy for the feed. Smaller photos are already light enough.
const THUMB_THRESHOLD_BYTES = 700 * 1024;
const THUMB_SIDE = 720;
// Only names without spaces can be linked by @mention, so only those are suggested.
const LINKABLE_NAME = /^[\p{L}\p{N}_]+$/u;

export default function CreatePost({ user, onCreate }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  // Upload progress for videos, 0..1. null when nothing is uploading.
  const [progress, setProgress] = useState<number | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  // An "@word" being typed at the caret, and the people who match it.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const mediaType: "image" | "video" = file?.type.startsWith("video/") ? "video" : "image";
  const trimmed = text.trim();
  const remaining = MAX_LENGTH - text.length;
  const pollList = pollOptions.map(o => o.trim()).filter(Boolean);
  const pollValid = !pollOpen || (trimmed.length > 0 && pollList.length >= 2 && new Set(pollList.map(o => o.toLowerCase())).size === pollList.length);
  const canPost = !busy && (trimmed.length > 0 || file !== null) && remaining >= 0 && pollValid;

  // Look up people for the @word being typed (debounced).
  useEffect(() => {
    if (!mention || !mention.query) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const r = await api<{ users: Person[] }>(`/users/search?q=${encodeURIComponent(mention.query)}`);
        if (!cancelled) setPeople(r.users.filter(p => LINKABLE_NAME.test(p.display_name)).slice(0, 5));
      } catch {
        if (!cancelled) setPeople([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mention]);

  const onTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    const caret = e.target.selectionStart ?? value.length;
    const match = /(^|\s)@([\p{L}\p{N}_]{0,50})$/u.exec(value.slice(0, caret));
    setMention(match ? { start: caret - match[2].length - 1, query: match[2] } : null);
  };

  const pickPerson = (person: Person) => {
    if (!mention) return;
    const after = text.slice(mention.start + 1 + mention.query.length);
    setText(`${text.slice(0, mention.start)}@${person.display_name} ${after.replace(/^ /, "")}`);
    setMention(null);
    setPeople([]);
  };

  const clearFile = () => {
    setFile(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const togglePoll = () => {
    if (!pollOpen) clearFile();
    setPollOpen(v => !v);
  };

  const pick = (picked: File | undefined) => {
    if (!picked) return setFile(null);
    if (picked.type.startsWith("video/")) {
      if (!VIDEO_TYPES.includes(picked.type)) {
        if (inputRef.current) inputRef.current.value = "";
        return setError("MP4、WebM、MOV形式の動画を選択してください。");
      }
      if (picked.size > VIDEO_MAX_BYTES) {
        if (inputRef.current) inputRef.current.value = "";
        return setError("動画は200MB以下にしてください。");
      }
    }
    setError("");
    setFile(picked);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setError("");
    try {
      if (pollOpen) {
        await onCreate({ caption: trimmed, visibility, poll: { options: pollList } });
      } else if (file && mediaType === "video") {
        setProgress(0);
        const videoId = await uploadVideo(file, visibility, setProgress);
        await onCreate({ mediaType: "video", videoId, caption: trimmed, visibility });
      } else {
        let mediaUrl: string | undefined;
        if (file) {
          // The feed shows a smaller copy. It is uploaded first and linked to the full image.
          let thumbId: string | undefined;
          if (file.size >= THUMB_THRESHOLD_BYTES) {
            const thumbBody = new FormData();
            thumbBody.append("file", await optimizeImage(file, THUMB_SIDE));
            const thumb = await api<{ id: string }>("/media/upload", { method: "POST", body: thumbBody });
            thumbId = thumb.id;
          }
          const body = new FormData();
          body.append("file", await optimizeImage(file));
          if (thumbId) body.append("thumbId", thumbId);
          const uploaded = await api<{ url: string }>("/media/upload", { method: "POST", body });
          mediaUrl = uploaded.url;
        }
        await onCreate({ mediaType: file ? "image" : undefined, mediaUrl, caption: trimmed, visibility });
      }
      setText("");
      setPollOpen(false);
      setPollOptions(["", ""]);
      clearFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "投稿できませんでした。");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const ratio = Math.min(1, Math.max(0, text.length / MAX_LENGTH));

  return (
    <form className="x-composer" onSubmit={submit}>
      <div className="x-composer-row">
        <Avatar url={user.avatar_url} name={user.display_name} />
        <div className="x-composer-main">
          <div className="mention-anchor">
            <textarea
              className="x-composer-text"
              value={text}
              onChange={onTextChange}
              placeholder="いま、何してる？"
              rows={4}
              maxLength={MAX_LENGTH + 50}
              aria-label="投稿内容"
              autoFocus
            />
            {mention && people.length > 0 && (
              <ul className="mention-suggest" role="listbox" aria-label="メンションする人">
                {people.map(person => (
                  <li key={person.id}>
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pickPerson(person)}>
                      <Avatar url={person.avatar_url} name={person.display_name} size="small" />
                      <span>{person.display_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <small className="x-composer-hint">@ で人をメンション、# でハッシュタグを付けられます</small>

          {previewUrl && (
            <div className="x-composer-media">
              {mediaType === "image"
                ? <img src={previewUrl} alt="添付した画像のプレビュー" />
                : <VideoPlayer key={previewUrl} src={previewUrl} label="添付した動画のプレビュー" />}
              <button type="button" className="x-media-remove" onClick={clearFile} aria-label="添付を削除" disabled={busy}><X size={16} /></button>
            </div>
          )}

          {pollOpen && (
            <div className="poll-editor">
              {pollOptions.map((option, index) => (
                <div key={index} className="poll-edit-row">
                  <input
                    value={option}
                    maxLength={60}
                    placeholder={`選択肢 ${index + 1}`}
                    aria-label={`選択肢 ${index + 1}`}
                    onChange={e => setPollOptions(list => list.map((item, i) => (i === index ? e.target.value : item)))}
                    disabled={busy}
                  />
                  {pollOptions.length > 2 && (
                    <button type="button" className="x-tool-button" onClick={() => setPollOptions(list => list.filter((_, i) => i !== index))} aria-label="選択肢を削除" disabled={busy}>
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
              {pollOptions.length < 4 && (
                <button type="button" className="poll-add" onClick={() => setPollOptions(list => [...list, ""])} disabled={busy}>
                  <Plus size={15} />選択肢を追加
                </button>
              )}
            </div>
          )}

          {progress !== null && (
            <div className="x-upload-progress" role="status">
              <div className="x-upload-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <small>{progress < 1 ? `動画をアップロード中… ${Math.round(progress * 100)}%` : "動画を確認しています…"}</small>
            </div>
          )}

          {error && <p className="x-composer-error" role="alert">{error}</p>}

          <div className="vis-picker" role="radiogroup" aria-label="公開範囲">
            <div className="vis-options">
              {VISIBILITY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={visibility === option.value}
                  className={`vis-option ${visibility === option.value ? "on" : ""}`}
                  onClick={() => setVisibility(option.value)}
                  disabled={busy}
                >
                  {option.value === "public" ? <Globe size={14} /> : option.value === "followers" ? <Users size={14} /> : <Star size={14} />}
                  {option.label}
                </button>
              ))}
            </div>
            <small>{VISIBILITY_OPTIONS.find(o => o.value === visibility)?.hint}</small>
          </div>

          <div className="x-composer-bar">
            <div className="x-composer-tools">
              <button
                type="button"
                className="x-tool-button"
                onClick={() => inputRef.current?.click()}
                aria-label="写真または動画を追加"
                title="写真・動画を追加"
                disabled={busy || pollOpen}
              >
                <ImagePlus size={20} />
              </button>
              <button
                type="button"
                className={`x-tool-button ${pollOpen ? "on" : ""}`}
                onClick={togglePoll}
                aria-label="投票を追加"
                aria-pressed={pollOpen}
                title="投票を追加"
                disabled={busy || Boolean(file)}
              >
                <ListChecks size={20} />
              </button>
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept={ACCEPT}
                onChange={e => pick(e.target.files?.[0])}
              />
            </div>

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
