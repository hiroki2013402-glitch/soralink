import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import "./status.css";

type Health = {
  ok: boolean;
  name: string;
  version: string;
  videoStorage: "ready" | "unavailable";
};

type Check = {
  at: Date;
  latencyMs: number;
  health: Health;
};

// Service status: calls the same health endpoint Render uses, and shows the result with the response time.
export default function StatusPage() {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const started = performance.now();
    try {
      const health = await api<Health>("/health");
      setCheck({ at: new Date(), latencyMs: Math.round(performance.now() - started), health });
      setError("");
    } catch (e) {
      setError(errorMessage(e, "稼働状況を取得できませんでした。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const up = check?.health.ok === true && !error;
  const videoReady = check?.health.videoStorage === "ready";

  return (
    <section className="status-page">
      <header className="status-heading">
        <p className="status-eyebrow">SoraLink</p>
        <h1>サービス稼働状況</h1>
      </header>

      <div className={`status-banner ${check ? (up ? "ok" : "ng") : ""}`} role="status">
        {check && up ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
        <div className="status-banner-text">
          <strong>
            {!check && !error && "確認中…"}
            {check && up && "すべて稼働しています"}
            {error && "サービスに接続できません"}
          </strong>
          {check && <small>最終確認 {check.at.toLocaleTimeString("ja-JP")}</small>}
          {error && <small>{error}</small>}
        </div>
      </div>

      <section className="status-card" aria-label="詳細">
        <div className="status-row">
          <span>Webアプリ</span>
          <span className={up ? "good" : "bad"}>{up ? "稼働中" : check ? "停止" : "-"}</span>
        </div>
        <div className="status-row">
          <span>応答時間</span>
          <span>{check ? `${check.latencyMs} ms` : "-"}</span>
        </div>
        <div className="status-row">
          <span>動画の保存先</span>
          <span className={videoReady ? "good" : "bad"}>
            {check ? (videoReady ? "利用可能" : "利用できません") : "-"}
          </span>
        </div>
        <div className="status-row">
          <span>バージョン</span>
          <span>{check?.health.version ?? "-"}</span>
        </div>
      </section>

      <button type="button" className="status-refresh" onClick={() => void run()} disabled={loading}>
        <RefreshCw size={15} className={loading ? "spin" : ""} />
        再読み込み
      </button>
    </section>
  );
}
