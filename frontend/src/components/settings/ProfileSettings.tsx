import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { useAuthContext } from "../../auth/AuthProvider";
import { initials } from "../../utils/format";
import { formatFull } from "../../utils/date";

export function ProfileSettings() {
  const { user, updateProfile, updatePassword } = useAuthContext();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [rotating, setRotating] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
    setEmail(user?.email ?? "");
  }, [user]);

  const flash = (setter: (value: boolean) => void) => {
    setter(true);
    window.setTimeout(() => setter(false), 2200);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateProfile({ displayName: displayName.trim(), email: email.trim() });
      flash(setSaved);
    } finally {
      setSaving(false);
    }
  };

  const handleRotate = async () => {
    setPasswordError(null);
    if (newPassword.length < 6) {
      setPasswordError("New password needs at least 6 characters");
      return;
    }
    setRotating(true);
    try {
      await updatePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      flash(setRotated);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Password update failed");
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="panel settings-panel">
        <span className="panel-accent" />
        <div className="panel-head">
          <div className="flex min-w-0 items-center gap-3">
            <span className="panel-medallion !rounded-full font-display text-[13px] italic">
              {initials(displayName || "?")}
            </span>
            <div className="panel-head-text">
              <span className="panel-title">Profile</span>
              <span className="panel-kicker">who the archive answers to</span>
            </div>
          </div>
          {saved && (
            <span className="fx-rise t-mono text-[10px] uppercase tracking-[0.2em] text-moss">
              <Icon name="check" size={12} className="mr-1 inline-block -translate-y-px" />
              saved
            </span>
          )}
        </div>

        <div className="panel-pad grid gap-6 lg:grid-cols-[1fr_220px]">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field mb-0">
              <label className="label" htmlFor="profile-name">Display name</label>
              <input
                id="profile-name"
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="field mb-0">
              <label className="label" htmlFor="profile-email">Email</label>
              <input
                id="profile-email"
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>

          <aside className="side-fact">
            <span className="side-fact-label">Member since</span>
            <span className="side-fact-value !text-[18px]">
              {user ? formatFull(user.createdAt) : "—"}
            </span>
            <span className="side-fact-note">
              Your archive, your rules — every memory scoped to this account alone.
            </span>
          </aside>
        </div>
      </section>

      <section className="panel settings-panel">
        <span className="panel-accent" />
        <div className="panel-head">
          <div className="flex min-w-0 items-center gap-3">
            <span className="panel-medallion">
              <Icon name="refresh" size={16} />
            </span>
            <div className="panel-head-text">
              <span className="panel-title">Security</span>
              <span className="panel-kicker">rotate the key that seals your token</span>
            </div>
          </div>
          {rotated && (
            <span className="fx-rise t-mono text-[10px] uppercase tracking-[0.2em] text-moss">
              <Icon name="check" size={12} className="mr-1 inline-block -translate-y-px" />
              rotated
            </span>
          )}
        </div>

        <div className="panel-pad grid gap-6 lg:grid-cols-[1fr_220px]">
          <div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field mb-0">
                <label className="label" htmlFor="profile-current">Current password</label>
                <input
                  id="profile-current"
                  className="input"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
              <div className="field mb-0">
                <label className="label" htmlFor="profile-new">New password</label>
                <input
                  id="profile-new"
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                {passwordError && <span className="field-error">{passwordError}</span>}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm mt-4" onClick={() => void handleRotate()} disabled={rotating}>
              <Icon name="refresh" size={13} className={rotating ? "fx-spin-slow" : ""} />
              {rotating ? "Rotating…" : "Rotate password"}
            </button>
          </div>

          <aside className="side-fact">
            <span className="side-fact-label">Policy</span>
            <span className="side-fact-value !text-[18px] text-ember-hi">bcrypt · 12</span>
            <span className="side-fact-note">
              Hashed server-side, never stored plain. Tokens expire every 24h.
            </span>
          </aside>
        </div>
      </section>
    </div>
  );
}