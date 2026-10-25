import { LoaderCircle, Maximize, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

type Props = {
  src: string;
  poster?: string;
  label: string;
};

const RATES = [1, 1.25, 1.5, 2, 0.5];
const CONTROLS_HIDE_MS = 2500;
const SEEK_STEP = 5;

// Only one video plays at a time: starting one pauses the previous one.
let activeVideo: HTMLVideoElement | null = null;

const pad = (n: number) => String(n).padStart(2, "0");
function clock(seconds: number) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

// Own player for posts: poster, buffered progress, seek, mute, speed, fullscreen, and keyboard controls.
// Pauses when scrolled out of view. Streams from the URL with range requests, so seeking is immediate.
export default function VideoPlayer({ src, poster, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rateIndex, setRateIndex] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const wake = () => {
    setShowControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
  };

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // Pause when the player leaves the screen, so a feed does not play several videos at once.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      const v = videoRef.current;
      if (v && !entry.isIntersecting && !v.paused) v.pause();
    }, { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    wake();
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      void v.play().catch(() => setFailed(true));
    } else {
      v.pause();
    }
  };

  const seekTo = (seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, seconds), Number.isFinite(v.duration) ? v.duration : seconds);
    wake();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    wake();
  };

  const cycleRate = () => {
    const next = (rateIndex + 1) % RATES.length;
    setRateIndex(next);
    if (videoRef.current) videoRef.current.playbackRate = RATES[next];
    wake();
  };

  const toggleFullscreen = () => {
    const wrap = wrapRef.current;
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (wrap?.requestFullscreen) {
      void wrap.requestFullscreen().catch(() => undefined);
    } else {
      // iOS Safari only supports fullscreen on the video element itself.
      v?.webkitEnterFullscreen?.();
    }
  };

  const retry = () => {
    setFailed(false);
    setEnded(false);
    setAttempt(n => n + 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    switch (event.key) {
      case " ":
      case "k":
        event.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        event.preventDefault();
        seekTo(v.currentTime - SEEK_STEP);
        break;
      case "ArrowRight":
        event.preventDefault();
        seekTo(v.currentTime + SEEK_STEP);
        break;
      case "m":
        toggleMute();
        break;
      case "f":
        toggleFullscreen();
        break;
      default:
        break;
    }
  };

  const playedPct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <div
      ref={wrapRef}
      className={`vp ${playing ? "is-playing" : ""} ${showControls || !playing ? "show-controls" : ""} ${fullscreen ? "is-fullscreen" : ""}`}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      onPointerMove={wake}
      onFocus={wake}
    >
      <video
        key={attempt}
        ref={videoRef}
        className="vp-video"
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        onClick={togglePlay}
        onPlay={event => {
          if (activeVideo && activeVideo !== event.currentTarget) activeVideo.pause();
          activeVideo = event.currentTarget;
          setPlaying(true);
          setEnded(false);
          wake();
        }}
        onPause={() => { setPlaying(false); setShowControls(true); }}
        onEnded={() => { setPlaying(false); setEnded(true); setShowControls(true); }}
        onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)}
        onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onProgress={event => {
          const v = event.currentTarget;
          const ranges = v.buffered;
          setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={() => { setWaiting(false); setFailed(true); }}
      />

      {!failed && !playing && (
        <button type="button" className="vp-big" onClick={togglePlay} aria-label={ended ? "もう一度再生" : "再生"}>
          {ended ? <RotateCcw size={26} /> : <Play size={26} fill="currentColor" />}
        </button>
      )}

      {waiting && !failed && playing && (
        <span className="vp-spinner" aria-hidden="true"><LoaderCircle size={30} className="spin" /></span>
      )}

      {failed && (
        <div className="vp-error" role="alert">
          <p>動画を再生できませんでした。</p>
          <button type="button" onClick={retry}>もう一度読み込む</button>
        </div>
      )}

      <div className="vp-bar">
        <button type="button" className="vp-btn" onClick={togglePlay} aria-label={playing ? "一時停止" : "再生"}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <span className="vp-time">{clock(current)} / {clock(duration)}</span>
        <div className="vp-track" style={{ "--played": `${playedPct}%`, "--buffered": `${bufferedPct}%` } as CSSProperties}>
          <input
            type="range"
            className="vp-range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            aria-label="再生位置"
            aria-valuetext={`${clock(current)} / ${clock(duration)}`}
            onChange={event => seekTo(Number(event.currentTarget.value))}
          />
        </div>
        <button type="button" className="vp-btn" onClick={toggleMute} aria-label={muted ? "ミュート解除" : "ミュート"}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button type="button" className="vp-rate" onClick={cycleRate} aria-label="再生速度">{RATES[rateIndex]}x</button>
        <button type="button" className="vp-btn" onClick={toggleFullscreen} aria-label={fullscreen ? "全画面を終了" : "全画面"}>
          <Maximize size={17} />
        </button>
      </div>
    </div>
  );
}
