import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { login, setupPassword } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { Wordmark } from "../../components/Wordmark";
import { inputCls, Field } from "../../components/ui/controls";
import { useAuth } from "../../store/auth";

export const MIN_PASSWORD = 10;

/** What blocks the setup form, or null. Pure so it can be tested. */
export function setupBlocker(password: string, confirm: string, codeNeeded: boolean, code: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  if (codeNeeded && !code.trim()) return "Enter the setup code shown in the Accio server window.";
  return null;
}

const buttonCls =
  "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gold text-[15px] font-semibold text-on-gold transition-opacity hover:opacity-90 disabled:opacity-50";

/** Login, or the one-time "choose a password" screen on first run. Nothing else is reachable before this. */
export function AuthScreen() {
  const status = useAuth((s) => s.status);
  const refresh = useAuth((s) => s.refresh);
  const unreachable = useAuth((s) => s.unreachable);
  const first = status ? !status.configured : false;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const blocked = first ? setupBlocker(password, confirm, !!status?.setup_code_needed, code) : null;
    if (blocked) return setError(blocked);
    setBusy(true);
    setError(null);
    try {
      if (first) await setupPassword(password, code);
      else await login(password);
      setPassword("");
      setConfirm("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-full place-items-center bg-bg px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-[360px]" aria-labelledby="auth-title">
        <div className="mb-8 flex justify-center">
          <Wordmark size={40} />
        </div>
        <h1 id="auth-title" className="serif text-center text-[22px] font-medium">
          {first ? "Choose a password" : "Sign in"}
        </h1>
        <p className="mx-auto mt-2 max-w-[300px] text-center text-[13px] text-text-2">
          {first
            ? "This protects Accio when it is reachable from other devices or the internet. You only set it once."
            : "Enter your Accio password to continue."}
        </p>
        <div className="mt-6 space-y-3.5">
          <Field label={first ? "New password" : "Password"}>
            <input
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={first ? "new-password" : "current-password"}
              autoFocus
              required
              maxLength={256}
            />
          </Field>
          {first && (
            <>
              <Field label="Repeat password">
                <input
                  type="password"
                  className={inputCls}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  maxLength={256}
                />
              </Field>
              {status?.setup_code_needed && (
                <Field label="Setup code">
                  <input
                    className={`${inputCls} font-mono`}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    maxLength={64}
                  />
                  <span className="mt-1 block text-[12px] text-text-3">Printed in the Accio server window on this PC. It stops strangers from claiming a new install.</span>
                </Field>
              )}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-s border border-danger/40 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        {unreachable && !error && (
          <p role="alert" className="mt-4 text-[13px] text-text-2">
            Can't reach the Accio server. Check that it is running.
          </p>
        )}
        <button type="submit" disabled={busy || !password} className={`${buttonCls} mt-6`}>
          {busy && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />}
          {first ? "Set password" : "Sign in"}
        </button>
        {!first && <p className="mt-5 text-center text-[12px] text-text-3">Forgot it? On the PC running Accio, run Reset_Password.bat.</p>}
      </form>
    </main>
  );
}
