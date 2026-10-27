import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { enablePush, needsHomeScreen, pushSupported, refreshPush } from "../../lib/push";
import "./dm-actions.css";

type State = "hidden" | "off" | "busy" | "denied" | "ios";

// Inbox banner that turns on message notifications. Shown only where push can work.
export default function PushPrompt() {
  const [state, setState] = useState<State>("hidden");

  useEffect(() => {
    let alive = true;
    if (!pushSupported()) return () => { alive = false; };
    if (needsHomeScreen()) {
      setState("ios");
    } else if (Notification.permission === "denied") {
      setState("denied");
    } else {
      refreshPush()
        .then(on => { if (alive && !on) setState("off"); })
        .catch(() => { if (alive) setState("off"); });
    }
    return () => { alive = false; };
  }, []);

  const turnOn = async () => {
    setState("busy");
    try {
      const result = await enablePush();
      if (result === "enabled") setState("hidden");
      else if (result === "denied") setState("denied");
      else setState("hidden");
    } catch {
      setState("off");
    }
  };

  if (state === "hidden") return null;
  if (state === "ios") {
    return <p className="dm-push-prompt"><BellRing size={16} />通知を受け取るには、Safariの「共有」から「ホーム画面に追加」し、そのアプリを開いてください。</p>;
  }
  if (state === "denied") {
    return <p className="dm-push-prompt"><BellRing size={16} />通知がブロックされています。ブラウザまたは端末の設定で許可してください。</p>;
  }
  return (
    <div className="dm-push-prompt">
      <BellRing size={16} />
      <span>新着メッセージを通知で受け取れます。</span>
      <button type="button" className="dm-primary-btn" onClick={() => void turnOn()} disabled={state === "busy"}>
        {state === "busy" ? "設定中…" : "通知をオンにする"}
      </button>
    </div>
  );
}
