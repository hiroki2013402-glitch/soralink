import { Link as LinkIcon } from "lucide-react";

// Desktop right column: promotional card and footer links.
export default function RightRail() {
  return (
    <aside className="right-rail">
      <div className="rail-card">
        <span className="eyebrow">SORA LINK</span>
        <h3>あなたの世界を、<br />もっと広く。</h3>
        <p>日常の小さな瞬間をシェアして、好きな人や新しい発見とつながろう。</p>
        <div className="rail-cloud"><LinkIcon size={38} /></div>
      </div>
      <div className="rail-footer">SoraLink · 安心してつながる場所<br />利用規約　プライバシー</div>
    </aside>
  );
}
