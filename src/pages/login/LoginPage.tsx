import { Link as LinkIcon } from "lucide-react";

export default function LoginPage() {
  return <main className="landing"><div className="landing-content"><div className="logo-cloud"><LinkIcon size={38} strokeWidth={1.8}/></div><h1>SoraLink</h1><p>つながる。広がる。あなたの世界。</p><div className="landing-actions"><a className="primary-button landing-btn" href="/api/auth/login">新規登録</a><a className="outline-button landing-btn" href="/api/auth/login">ログイン</a></div><small>写真や日常を、あなたらしくシェアしよう。</small></div></main>;
}
