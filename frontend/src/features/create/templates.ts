import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Create and Edit write different kinds of prompts, so each keeps its own list. */
export type TemplateTarget = "create" | "edit";

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  target: TemplateTarget;
}

interface TemplateState {
  items: PromptTemplate[];
  /** Saves under the name; a template of the same name for the same target is overwritten. */
  save: (target: TemplateTarget, name: string, text: string) => void;
  /** Edits an existing template in place; a no-op when the name or text is blank. */
  update: (id: string, name: string, text: string) => void;
  remove: (id: string) => void;
}

export const useTemplates = create<TemplateState>()(
  persist(
    (set) => ({
      items: [],
      save: (target, name, text) =>
        set((s) => {
          const n = name.trim();
          const t = text.trim();
          if (!n || !t) return s;
          const same = s.items.find((i) => i.target === target && i.name.toLowerCase() === n.toLowerCase());
          if (same) return { items: s.items.map((i) => (i === same ? { ...i, name: n, text: t } : i)) };
          return { items: [{ id: crypto.randomUUID(), name: n, text: t, target }, ...s.items] };
        }),
      update: (id, name, text) =>
        set((s) => {
          const n = name.trim();
          const t = text.trim();
          if (!n || !t) return s;
          return { items: s.items.map((i) => (i.id === id ? { ...i, name: n, text: t } : i)) };
        }),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
    }),
    { name: "accio.templates", version: 1 },
  ),
);
