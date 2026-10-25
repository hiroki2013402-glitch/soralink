export default function LoginPage() {
  return <main className="landing">
    <div className="city-sky" aria-hidden="true">
      <div className="sun-glow"/><div className="cloud cloud-a"/><div className="cloud cloud-b"/>
      <div className="cityline">{Array.from({length:28},(_,i)=><i key={i}/>)}</div>
    </div>
    <div className="landing-content">
      <img className="landing-logo" src="/images/soralink-logo.jpg" alt="SoraLink ロゴ"/>
      <h1>SoraLink</h1><p>つながる。広がる。あなたの世界。</p>
      <div className="landing-actions">
        <a className="primary-button landing-btn" href="/api/auth/login?mode=register">新規登録</a>
        <a className="outline-button landing-btn" href="/api/auth/login?mode=login">ログイン</a>
      </div>
      <small>写真や日常を、あなたらしくシェアしよう。</small>
    </div>
  </main>;
}
