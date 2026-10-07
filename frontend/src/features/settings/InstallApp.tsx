import { usePwaInstall } from "../../lib/pwa";
import { Label } from "../../components/ui/controls";

const HELP = {
  installed: "Accio is installed on this device.",
  ios: "In Safari, tap Share, then Add to Home Screen.",
  insecure: "Browsers only offer installing on a secure address: open Accio through the Cloudflare or zrok link, or on this PC at 127.0.0.1.",
  unavailable: "Use your browser's menu (Install app / Add to Home Screen) if it offers it.",
} as const;

export function InstallApp() {
  const { state, install } = usePwaInstall();
  return (
    <div>
      <Label>Install as an app</Label>
      {state === "prompt" ? (
        <button
          type="button"
          onClick={() => void install()}
          className="hover-wash mt-1.5 h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text"
        >
          Install Accio
        </button>
      ) : (
        <p className="mt-1.5 text-[13px] text-text-2">{HELP[state]}</p>
      )}
    </div>
  );
}
