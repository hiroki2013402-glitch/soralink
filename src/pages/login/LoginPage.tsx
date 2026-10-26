import { useState } from "react";
import AuthOverlay from "../../components/AuthOverlay";
import { markAuthPending } from "../../lib/authPending";

export default function LoginPage() {
  const [starting, setStarting] = useState(false);

  // Shows the 認証中 overlay, then leaves for Sennin Account. The overlay stays until the browser navigates away.
  const start = (mode: "login" | "register") => {
    if (starting) return;
    markAuthPending();
    setStarting(true);
    location.href = `/api/auth/login?mode=${mode}`;
  };

  return <main className="landing">
    <div className="city-sky" aria-hidden="true">
      <div className="sun-glow"/><div className="cloud cloud-a"/><div className="cloud cloud-b"/>
      <div className="cityline">{Array.from({length:28},(_,i)=><i key={i}/>)}</div>
    </div>
    <div className="landing-content">
      <img className="landing-logo" src="/images/soralink-logo.jpg" alt="SoraLink ロゴ"/>
      <h1>SoraLink</h1><p>つながる。広がる。あなたの世界。</p>
      <div className="landing-actions">
        <button type="button" className="primary-button landing-btn" onClick={() => start("register")} disabled={starting}>新規登録</button>
        <button type="button" className="outline-button landing-btn" onClick={() => start("login")} disabled={starting}>ログイン</button>
      </div>
      <small>写真や日常を、あなたらしくシェアしよう。</small>
    </div>
    {starting && <AuthOverlay />}
  </main>;
}
