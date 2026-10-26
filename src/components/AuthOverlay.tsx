type Props = { text?: string; detail?: string };

// Full-screen "認証中" animation shown while a sign-in (or the admin password check) is in progress.
export default function AuthOverlay({ text = "認証中", detail = "Sennin Account で確認しています" }: Props) {
  return (
    <div className="auth-overlay" role="status" aria-live="polite">
      <div className="auth-card">
        <div className="auth-rings" aria-hidden="true"><span /><span /><span /></div>
        <p className="auth-title">
          {text}
          <span className="auth-dots" aria-hidden="true"><i /><i /><i /></span>
        </p>
        <p className="auth-detail">{detail}</p>
      </div>
    </div>
  );
}
