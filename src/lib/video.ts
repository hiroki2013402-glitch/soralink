import { api } from "./api";
import type { Visibility } from "../types";

export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

type UploadReservation = { id: string; chunkSize: number; chunkCount: number };

// Poster image for a video URL. Matches the server's keys: videos/<id>.mp4 -> posters/<id>.jpg,
// and the API fallback /api/media/video/<id> -> /api/media/video/<id>/poster.
export function posterFor(mediaUrl: string | null | undefined): string | undefined {
  if (!mediaUrl) return undefined;
  if (mediaUrl.startsWith("/api/media/video/")) return `${mediaUrl}/poster`;
  const match = mediaUrl.match(/\/videos\/([0-9a-f-]{36})\.(?:mp4|webm|mov)$/i);
  return match ? `${mediaUrl.slice(0, match.index)}/posters/${match[1]}.jpg` : undefined;
}

// Grabs a frame a little way into the clip, so the poster is not a black first frame. Resolves null on failure.
export function capturePoster(file: File): Promise<Blob | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let timer = 0;
    let finished = false;
    const finish = (blob: Blob | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(blob);
    };
    timer = window.setTimeout(() => finish(null), 10000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      const target = Math.min(0.5, Math.max(0, (video.duration || 0) / 3));
      if (target > 0) video.currentTime = target;
      else video.dispatchEvent(new Event("seeked"));
    };
    video.onseeked = () => {
      if (!video.videoWidth || !video.videoHeight) return finish(null);
      const scale = Math.min(1, 720 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return finish(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => finish(blob), "image/jpeg", 0.85);
    };
    video.src = url;
  });
}

// Uploads fixed-size binary chunks through the server into the dedicated video Turso database.
export async function uploadVideo(file: File, visibility: Visibility, onProgress: (ratio: number) => void): Promise<string> {
  if (!VIDEO_TYPES.includes(file.type)) throw new Error("MP4、WebM、MOV形式の動画を選択してください。");
  if (file.size > VIDEO_MAX_BYTES) throw new Error("動画は200MB以下にしてください。");

  const reservation = await api<UploadReservation>("/media/video/presign", {
    method: "POST",
    body: JSON.stringify({ mimeType: file.type, size: file.size, fileName: file.name, visibility })
  });
  for (let index = 0; index < reservation.chunkCount; index++) {
    const begin = index * reservation.chunkSize;
    const chunk = file.slice(begin, Math.min(begin + reservation.chunkSize, file.size));
    const response = await fetch(`/api/media/video/${reservation.id}/chunk/${index}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/octet-stream" }, body: chunk
    });
    if (!response.ok) {
      let message = "動画を動画専用Tursoへアップロードできませんでした。";
      try { const body = await response.json(); if (body?.error) message = body.error; } catch { /* keep default */ }
      throw new Error(message);
    }
    onProgress((index + 1) / reservation.chunkCount);
  }
  await api("/media/video/complete", { method: "POST", body: JSON.stringify({ id: reservation.id }) });
  return reservation.id;
}
