import { create } from "zustand";
import { useEdit } from "./store";

/** The modes that have a Prompt enhancer (Outpaint has none). */
export type EnhancedMode = "multiedit" | "inpaint";

/** The enhancer's rewrite of a finished job, as shown in the prompt box. */
export interface EnhancedText {
  /** id of the job that produced it */
  id: string;
  text: string;
}

interface State {
  /** modes whose prompt box currently shows the enhancer's rewrite instead of the user's own prompt */
  active: Partial<Record<EnhancedMode, true>>;
  /** what the box held before switching (restored when switching back) */
  saved: Partial<Record<EnhancedMode, { prompt: string; enhancer: boolean }>>;
  /** the rewrite as the user last edited it, kept while they look at their own prompt */
  draft: Partial<Record<EnhancedMode, EnhancedText>>;
}

export const useEnhancedView = create<State>(() => ({ active: {}, saved: {}, draft: {} }));

/**
 * Put the enhancer's rewrite into the prompt box and switch the Prompt enhancer off, so Generate sends the text as it is
 * and the (slow) enhancer does not run again. Nothing else is special: the box and the toggle are the normal ones.
 */
export function showEnhanced(mode: EnhancedMode, latest: EnhancedText) {
  const edit = useEdit.getState();
  const view = useEnhancedView.getState();
  const text = view.draft[mode]?.id === latest.id ? view.draft[mode]!.text : latest.text;
  useEnhancedView.setState({
    active: { ...view.active, [mode]: true },
    saved: view.active[mode] ? view.saved : { ...view.saved, [mode]: { prompt: edit.prompts[mode], enhancer: edit.enhancer[mode] } },
  });
  edit.setPrompt(mode, text);
  edit.patch({ enhancer: { ...edit.enhancer, [mode]: false } });
}

/** Back to the user's own prompt and the enhancer setting they had; the edited rewrite is remembered. */
export function showOwn(mode: EnhancedMode, latest: EnhancedText) {
  const edit = useEdit.getState();
  const view = useEnhancedView.getState();
  const saved = view.saved[mode];
  const { [mode]: _a, ...active } = view.active;
  useEnhancedView.setState({ active, draft: { ...view.draft, [mode]: { id: latest.id, text: edit.prompts[mode] } } });
  if (saved) {
    edit.setPrompt(mode, saved.prompt);
    edit.patch({ enhancer: { ...edit.enhancer, [mode]: saved.enhancer } });
  }
}
