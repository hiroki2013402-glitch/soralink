import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

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

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
// Arrow keys move the picture by 8px, or 40px with Shift.
const NUDGE = 8;
const NUDGE_LARGE = 40;

type Size = { w: number; h: number };
type Point = { x: number; y: number };

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
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// Crop dialog. The frame is what gets saved: drag or pinch to position, wheel / buttons / slider to zoom,
// arrow keys for fine moves, and a grid to line up the subject.
export default function ImageCropper({ file, shape, onCancel, onConfirm }: Props) {
  const spec = SPECS[shape];
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [frame, setFrame] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  // Active pointers on the frame (one = drag, two = pinch).
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const g = layout(natural, frame, zoom);
  const ox = clamp(offset.x, g.maxX);
  const oy = clamp(offset.y, g.maxY);
  const left = (frame.w - g.dispW) / 2 + ox;
  const top = (frame.h - g.dispH) / 2 + oy;
  const ready = Boolean(natural && bitmap) && !busy;

  useEffect(() => {
    let cancelled = false;
    let decoded: ImageBitmap | null = null;
    setBitmap(null);
    setNatural(null);
    setError("");

    createImageBitmap(file).then(image => {
      if (cancelled) {
        image.close();
        return;
      }
      decoded = image;
      setBitmap(image);
      setNatural({ w: image.width, h: image.height });
    }).catch(() => {
      if (!cancelled) setError("この画像形式はブラウザーで開けません。JPG、PNG、WebP形式の画像を選んでください。");
    });

    return () => {
      cancelled = true;
      decoded?.close();
    };
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

  useLayoutEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !bitmap || !g.dispW || !g.dispH) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(g.dispW * scale));
    canvas.height = Math.max(1, Math.round(g.dispH * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("画像を表示できません。別の画像でお試しください。");
      return;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }, [bitmap, g.dispW, g.dispH]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Wheel zooms the picture. A native listener is used so the page behind the dialog does not scroll.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const resetPosition = () => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  };

  const zoomBy = (delta: number) => setZoom(z => clampZoom(Math.round((z + delta) * 100) / 100));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready) return;
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox, oy };
      pinch.current = null;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: distance(a, b), zoom };
      drag.current = null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointers.current.get(e.pointerId);
    if (!point) return;
    point.x = e.clientX;
    point.y = e.clientY;

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (pinch.current.dist > 0) setZoom(clampZoom(pinch.current.zoom * distance(a, b) / pinch.current.dist));
      return;
    }
    const start = drag.current;
    if (!start) return;
    setOffset({
      x: clamp(start.ox + e.clientX - start.x, g.maxX),
      y: clamp(start.oy + e.clientY - start.y, g.maxY)
    });
  };

  // When one of two fingers lifts, the remaining finger keeps dragging from where it is.
  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    const [remaining] = [...pointers.current.values()];
    drag.current = remaining && pointers.current.size === 1
      ? { x: remaining.x, y: remaining.y, ox, oy }
      : null;
  };

  const onFrameKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step }
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setOffset({ x: clamp(ox + move.x, g.maxX), y: clamp(oy + move.y, g.maxY) });
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomBy(-ZOOM_STEP);
    } else if (e.key === "0") {
      e.preventDefault();
      resetPosition();
    }
  };

  const save = async () => {
    if (!natural || !bitmap || busy) return;
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
      ctx.drawImage(bitmap, -left / g.scale, -top / g.scale, frame.w / g.scale, frame.h / g.scale, 0, 0, outWidth, outHeight);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.9));
      if (!blob) throw new Error("encode");
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
      onConfirm(new File([blob], `${shape}-${Date.now()}.${extension}`, { type: blob.type }));
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
            tabIndex={0}
            role="group"
            aria-label="表示範囲。矢印キーで移動、+と-で拡大縮小、0でリセット"
            onKeyDown={onFrameKey}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            {bitmap && <canvas ref={previewRef} className="crop-image" style={{ left, top, width: g.dispW, height: g.dispH }} aria-hidden="true" />}
            <div className="crop-grid" aria-hidden="true"><i className="v1" /><i className="v2" /><i className="h1" /><i className="h2" /></div>
          </div>
        </div>
        <p className="crop-hint">ドラッグかスマホのピンチで位置を合わせ、ホイールやボタンで拡大縮小します。枠の中が切り抜かれます。</p>
        <div className="crop-zoom">
          <button type="button" className="crop-step" onClick={() => zoomBy(-ZOOM_STEP)} disabled={!ready || zoom <= MIN_ZOOM} aria-label="縮小"><ZoomOut size={17} /></button>
          <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} disabled={!ready} aria-label="拡大率" />
          <button type="button" className="crop-step" onClick={() => zoomBy(ZOOM_STEP)} disabled={!ready || zoom >= MAX_ZOOM} aria-label="拡大"><ZoomIn size={17} /></button>
          <span className="crop-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
        </div>
        {error && <p className="x-composer-error">{error}</p>}
        <div className="crop-actions">
          <button type="button" className="outline-small crop-reset" onClick={resetPosition} disabled={!ready}><RotateCcw size={15} />リセット</button>
          <button type="button" className="outline-small" onClick={onCancel} disabled={busy}>キャンセル</button>
          <button type="button" className="primary-button" onClick={() => void save()} disabled={!ready}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}この範囲で保存
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
