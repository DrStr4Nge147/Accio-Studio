import { Coffee } from "lucide-react";

const URL = "https://buymeacoffee.com/drstrngenic";

/** Small "Buy me a coffee" pill. Sits in the header so it never covers content or the tab bar. */
export function CoffeeBadge({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <a
      href={URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Buy me a coffee"
      data-tip="Buy me a coffee"
      className={`inline-flex h-8 flex-none items-center gap-1.5 rounded-full bg-[#FFDD00] px-3 text-[12px] font-semibold text-[#1a1a1a] shadow-sm transition-[filter] hover:brightness-95 ${className}`}
    >
      <Coffee size={15} strokeWidth={2} />
      {compact ? "Coffee" : "Buy me a coffee"}
    </a>
  );
}
