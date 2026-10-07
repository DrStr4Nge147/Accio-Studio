import { useState, type FormEvent } from "react";
import { changePassword } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { Field, inputCls, Label } from "../../components/ui/controls";
import { useAuth } from "../../store/auth";
import { MIN_PASSWORD } from "../auth/AuthScreen";

const btn = "hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text disabled:opacity-50";

/** Change the password (signs every other device out) or sign out here. */
export function AccountSection() {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => {
    setEditing(false);
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) return setMsg({ ok: false, text: `Use at least ${MIN_PASSWORD} characters.` });
    if (next !== confirm) return setMsg({ ok: false, text: "The two new passwords don't match." });
    setBusy(true);
    try {
      await changePassword(current, next);
      reset();
      setMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label>Account</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => (editing ? reset() : setEditing(true))}>
          {editing ? "Cancel" : "Change password"}
        </button>
        <button type="button" className={btn} onClick={() => void useAuth.getState().signOut().then(() => window.location.reload())}>
          Sign out
        </button>
      </div>
      {editing && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Field label="Current password">
            <input type="password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="New password">
            <input type="password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label="Repeat new password">
            <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </Field>
          <button type="submit" disabled={busy || !current || !next} className="h-11 rounded-full bg-gold px-5 text-[14px] font-semibold text-on-gold disabled:opacity-50">
            Save password
          </button>
        </form>
      )}
      {msg && (
        <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-ok" : "text-danger"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
