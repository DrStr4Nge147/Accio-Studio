import { createContext, useContext, type ReactNode } from "react";
import { Label } from "./controls";

const InCard = createContext(false);

/** A settings section's heading. Inside a SettingsCard the card draws the title, so this renders nothing there. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return useContext(InCard) ? null : <Label>{children}</Label>;
}

/**
 * Desktop settings panel: a titled card around one section. The card disappears while its section has nothing to show
 * (a section that is still loading renders null).
 */
export function SettingsCard({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-m border border-line bg-raised/40 has-[[data-card-body]:empty]:hidden">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium text-text">{title}</h3>
          {description && <p className="mt-0.5 text-[12.5px] leading-snug text-text-3">{description}</p>}
        </div>
        {action}
      </header>
      <div data-card-body className="px-5 py-4 empty:hidden">
        <InCard.Provider value={true}>{children}</InCard.Provider>
      </div>
    </section>
  );
}
