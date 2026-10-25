import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, X, ZoomIn } from "lucide-react";

export type CropShape = "circle" | "wide";

type Props = {
  file: File;
  shape: CropShape;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
};

const SPECS = {
  circle: { aspect: 1, outWidth: 512, label: "アイコン" },
  wide: { aspect: 3, outWidth: 1500, label: "カバー画像" }
} as const;

const MAX_ZOOM = 4;

type Size = { w: number; h: number };

function layout(natural: Size | null, frame: Size, zoom: number) {
  const base = natural && frame.w && frame.h ? Math.max(frame.w / natural.w, frame.h / natural.h) : 1;
  const scale = base * zoom;
  const dispW = (natural?.w ?? 0) * scale;
  const dispH = (natural?.h ?? 0) * scale;
  return {
    scale,
    dispW,
    dispH,
    maxX: Math.max(0, (dispW - frame.w) / 2),
    maxY: Math.max(0, (dispH - frame.h) / 2)
  };
}

const clamp = (value: number, max: number) => Math.min(max, Math.max(-max, value));

export default function ImageCropper({ file, shape, onCancel, onConfirm }: Props) {
  const spec = SPECS[shape];
  const [src, setSrc] = useState("");
  const [natural, setNatural] = useState<Size | null>(null);
  const [frame, setFrame] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const g = layout(natural, frame, zoom);
  const ox = clamp(offset.x, g.maxX);
  const oy = clamp(offset.y, g.maxY);
  const left = (frame.w - g.dispW) / 2 + ox;
  const top = (frame.h - g.dispH) / 2 + oy;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox, oy };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setOffset({
      x: clamp(start.ox + e.clientX - start.x, g.maxX),
      y: clamp(start.oy + e.clientY - start.y, g.maxY)
    });
  };

  const save = async () => {
    const img = imgRef.current;
    if (!natural || !img || busy) return;
    setBusy(true);
    setError("");
    try {
      const outWidth = spec.outWidth;
      const outHeight = Math.round(outWidth / spec.aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, -left / g.scale, -top / g.scale, frame.w / g.scale, frame.h / g.scale, 0, 0, outWidth, outHeight);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.9));
      if (!blob) throw new Error("encode");
      onConfirm(new File([blob], `${shape}-${Date.now()}.webp`, { type: blob.type }));
    } catch {
      setError("画像を切り抜けませんでした。別の画像でお試しください。");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="crop-backdrop" role="presentation">
      <section className="crop-dialog" role="dialog" aria-modal="true" aria-label={`${spec.label}の表示範囲を調整`}>
        <header>
          <h2>{spec.label}の表示範囲</h2>
          <button type="button" className="crop-close" onClick={onCancel} disabled={busy} aria-label="閉じる"><X size={18} /></button>
        </header>
        <div className="crop-stage">
          <div
            ref={frameRef}
            className={`crop-frame ${shape}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          >
            {src && (
              <img
                ref={imgRef}
                className="crop-image"
                src={src}
                alt=""
                draggable={false}
                onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setError("画像を読み込めませんでした。別の画像でお試しください。")}
                style={{ left, top, width: g.dispW, height: g.dispH }}
              />
            )}
          </div>
        </div>
        <p className="crop-hint">ドラッグで位置を合わせ、スライダーで拡大縮小します。</p>
        <label className="crop-zoom">
          <ZoomIn size={17} aria-hidden="true" />
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} disabled={!natural || busy} aria-label="拡大率" />
        </label>
        {error && <p className="x-composer-error">{error}</p>}
        <div className="crop-actions">
          <button type="button" className="outline-small" onClick={onCancel} disabled={busy}>キャンセル</button>
          <button type="button" className="primary-button" onClick={() => void save()} disabled={!natural || busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}この範囲で保存
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
