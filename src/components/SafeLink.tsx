import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert } from "lucide-react";
import "./SafeLink.css";

type Props = { href: string; children: ReactNode };

// A link in a post or message. Tapping it asks first, because the destination has not been checked.
export default function SafeLink({ href, children }: Props) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAsking(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);

  const ask = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAsking(true);
  };

  const open = () => {
    window.open(href, "_blank", "noopener,noreferrer");
    setAsking(false);
  };

  return (
    <>
      <a href={href} className="safe-link" target="_blank" rel="noopener noreferrer" onClick={ask}>
        {children}
      </a>
      {asking && createPortal(
        <div className="link-confirm-backdrop" onClick={e => { e.stopPropagation(); setAsking(false); }}>
          <div className="link-confirm" role="alertdialog" aria-modal="true" aria-labelledby="link-confirm-title" onClick={e => e.stopPropagation()}>
            <span className="link-confirm-icon"><ShieldAlert size={22} /></span>
            <h3 id="link-confirm-title">このリンクを開きますか？</h3>
            <p>安全が保障されていません。内容を確認してから開いてください。</p>
            <code className="link-confirm-url">{href}</code>
            <div className="link-confirm-actions">
              <button type="button" className="link-confirm-cancel" onClick={() => setAsking(false)}>いいえ</button>
              <button type="button" className="link-confirm-ok" onClick={open} autoFocus>はい</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
