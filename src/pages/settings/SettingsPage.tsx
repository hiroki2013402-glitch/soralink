import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BellRing, LogOut, Monitor, PenLine, ShieldCheck, Smartphone } from "lucide-react";
import Avatar from "../../components/Avatar";
import { handleOf } from "../../lib/format";
import { disablePush, enablePush, currentEndpoint, needsHomeScreen, pushSupported } from "../../lib/push";
import type { Prefs } from "../../lib/preferences";
import type { User } from "../../types";
import "./settings.css";

export type NotificationSettings = { dm_push: boolean; notify_likes: boolean; notify_follows: boolean };

type Props = {
  user: User;
  settings: NotificationSettings | null;
  prefs: Prefs;
  onChangeSettings: (patch: Partial<NotificationSettings>) => void;
  onChangePrefs: (patch: Partial<Prefs>) => void;
  onEditProfile: () => void;
  onLogout: () => void;
  onNotice: (text: string) => void;
};

// One labelled switch. The label and hint explain what the choice changes.
function Switch({ checked, disabled, onChange, label, hint, id }: {
  checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string; hint?: string; id: string;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <label htmlFor={id}>{label}</label>
        {hint && <small>{hint}</small>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`settings-switch ${checked ? "on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{icon}<span>{title}</span></h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

// This browser's notification switch. It works on the push subscription, so it only affects this device.
function ThisDeviceNotifications({ onNotice }: { onNotice: (text: string) => void }) {
  const [state, setState] = useState<"loading" | "on" | "off">("loading");
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const iosNeedsHome = supported ? false : needsHomeScreen();

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    void currentEndpoint().then(endpoint => { if (alive) setState(endpoint ? "on" : "off"); }).catch(() => { if (alive) setState("off"); });
    return () => { alive = false; };
  }, [supported]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        const result = await enablePush();
        if (result === "enabled") { setState("on"); onNotice("この端末で通知を受け取るようにしました。"); }
        else if (result === "denied") onNotice("通知が許可されていません。ブラウザの設定で許可してください。");
        else onNotice("この端末では通知を設定できませんでした。");
      } else {
        await disablePush();
        setState("off");
        onNotice("この端末の通知を停止しました。");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <div className="settings-row">
        <div className="settings-row-text">
          <label>この端末の通知</label>
          <small>{iosNeedsHome ? "iPhoneでは、Safariの共有メニューから「ホーム画面に追加」すると通知を受け取れます。" : "この端末・ブラウザは通知に対応していません。"}</small>
        </div>
      </div>
    );
  }

  return (
    <Switch
      id="device-notifications"
      label="この端末で通知を受け取る"
      hint="オフにすると、この端末には通知が届かなくなります。他の端末には影響しません。"
      checked={state === "on"}
      disabled={busy || state === "loading"}
      onChange={value => void toggle(value)}
    />
  );
}

// The settings screen: account, notifications, display. Account data itself is managed by the sign-in service.
export default function SettingsPage({ user, settings, prefs, onChangeSettings, onChangePrefs, onEditProfile, onLogout, onNotice }: Props) {
  const loaded = settings !== null;
  return (
    <section className="settings-page">
      <header className="settings-heading">
        <p className="settings-eyebrow">SoraLink</p>
        <h1>設定</h1>
      </header>

      <Section icon={<PenLine size={16} />} title="アカウント">
        <div className="settings-account">
          <Avatar url={user.avatar_url} name={user.display_name} size="normal" />
          <div className="settings-account-text">
            <strong>{user.display_name}</strong>
            <small>{handleOf(user.id)}</small>
          </div>
          <button type="button" className="outline-small" onClick={onEditProfile}>プロフィールを編集</button>
        </div>
        <div className="settings-row static">
          <div className="settings-row-text">
            <label>メールアドレス</label>
            <small>{user.email || "表示できるメールアドレスがありません"}</small>
          </div>
        </div>
        <div className="settings-row static">
          <div className="settings-row-text">
            <label>ログイン</label>
            <small>パスワードやメールアドレスの変更は、ログインに使っているアカウント管理サービスで行います。</small>
          </div>
        </div>
        <div className="settings-row static">
          <button type="button" className="settings-danger" onClick={onLogout}><LogOut size={15} />ログアウト</button>
        </div>
      </Section>

      <Section icon={<BellRing size={16} />} title="通知">
        <ThisDeviceNotifications onNotice={onNotice} />
        <Switch
          id="dm-push"
          label="ダイレクトメッセージの通知"
          hint="新しいメッセージを、通知を許可した端末に送ります。"
          checked={settings?.dm_push ?? true}
          disabled={!loaded}
          onChange={value => onChangeSettings({ dm_push: value })}
        />
        <Switch
          id="notify-likes"
          label="いいねの通知"
          hint="投稿にいいねされたときに、通知一覧に表示します。"
          checked={settings?.notify_likes ?? true}
          disabled={!loaded}
          onChange={value => onChangeSettings({ notify_likes: value })}
        />
        <Switch
          id="notify-follows"
          label="フォローの通知"
          hint="新しくフォローされたときに、通知一覧に表示します。"
          checked={settings?.notify_follows ?? true}
          disabled={!loaded}
          onChange={value => onChangeSettings({ notify_follows: value })}
        />
      </Section>

      <Section icon={<Monitor size={16} />} title="表示">
        <Switch
          id="reduce-motion"
          label="アニメーションを減らす"
          hint="画面の動きを控えめにします。この端末のブラウザにだけ保存されます。"
          checked={prefs.reduceMotion}
          onChange={value => onChangePrefs({ reduceMotion: value })}
        />
      </Section>

      <Section icon={<ShieldCheck size={16} />} title="情報">
        <div className="settings-row static">
          <div className="settings-row-text">
            <label><Smartphone size={14} /> 設定の保存について</label>
            <small>通知やアカウントの設定はアカウントに保存され、どの端末からも同じ内容になります。</small>
          </div>
        </div>
      </Section>
    </section>
  );
}
