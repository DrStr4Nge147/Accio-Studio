import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, FilePlus2, FileText, Pencil, Trash2 } from "lucide-react";
import { Chip } from "../../components/ui/controls";
import { Sheet } from "../../components/ui/Sheet";
import { useServer } from "../../store/health";
import { useEdit } from "../edit/store";
import { useCreate } from "./store";
import { useTemplates, type TemplateTarget } from "./templates";

/** The prompt the composer for this target is showing, and how to replace it. */
function usePromptTarget(target: TemplateTarget) {
  const createPrompt = useCreate((s) => s.prompt);
  // Outpaint shows a built-in prompt while its own is empty, so that is what "current" means there
  const defaultOutpaint = useServer((s) => s.catalog?.defaults.edit.outpaint.prompt) ?? "";
  const editPrompt = useEdit((s) => s.prompts[s.mode] || (s.mode === "outpaint" ? defaultOutpaint : ""));
  const edit = target === "edit";
  return {
    prompt: edit ? editPrompt : createPrompt,
    setPrompt: (text: string) => {
      if (!edit) return useCreate.getState().patch({ prompt: text });
      const ed = useEdit.getState();
      ed.setPrompt(ed.mode, text);
    },
  };
}

/** The template being written: a new one (no id) or an existing one. */
interface Draft {
  id?: string;
  name: string;
  text: string;
}

const FIELD = "w-full rounded-m border border-line-strong bg-raised px-3 text-[15px] text-text outline-none placeholder:text-text-3 focus:border-gold";
const BTN = "hover-wash flex h-11 flex-none items-center justify-center gap-2 rounded-m border px-4 text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-40";

function TemplateSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: TemplateTarget }) {
  const { prompt, setPrompt } = usePromptTarget(target);
  const items = useTemplates((s) => s.items).filter((i) => i.target === target);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const canSave = !!prompt.trim() && !!name.trim();

  // A leftover half-written template should not greet the next opening
  useEffect(() => {
    if (!open) setDraft(null);
  }, [open]);

  const save = () => {
    if (!canSave) return;
    useTemplates.getState().save(target, name, prompt);
    setName("");
  };

  const commit = () => {
    if (!draft || !draft.name.trim() || !draft.text.trim()) return;
    if (draft.id) useTemplates.getState().update(draft.id, draft.name, draft.text);
    else useTemplates.getState().save(target, draft.name, draft.text);
    setDraft(null);
  };

  return createPortal(
    <Sheet open={open} onClose={onClose} title="Prompt templates" height="80%" desktopModalWidth={640}>
      {draft ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
          className="flex flex-col gap-2"
        >
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Template name"
            aria-label="Template name"
            maxLength={60}
            autoFocus
            className={`${FIELD} h-11`}
          />
          <textarea
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder="Prompt text"
            aria-label="Template prompt"
            rows={6}
            className={`${FIELD} resize-y py-2.5 leading-snug`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className={`${BTN} border-line-strong text-text-2`}>
              Cancel
            </button>
            <button type="submit" disabled={!draft.name.trim() || !draft.text.trim()} className={`${BTN} border-gold/55 text-gold-text`}>
              {draft.id ? "Save changes" : "Create template"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={prompt.trim() ? "Name for the current prompt" : "Write a prompt first, then name it"}
              aria-label="Template name"
              maxLength={60}
              className={`${FIELD} h-11 min-w-0 flex-1`}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!canSave}
                data-tip="Save the prompt currently in the box under the name on the left"
                className={`${BTN} flex-1 border-gold/55 text-gold-text sm:flex-none`}
              >
                <BookmarkPlus size={16} strokeWidth={1.7} aria-hidden />
                Save current prompt
              </button>
              <button
                type="button"
                onClick={() => setDraft({ name: "", text: "" })}
                data-tip="Write a new template from scratch, without using the prompt box"
                className={`${BTN} flex-1 border-line-strong text-text-2 hover:text-text sm:flex-none`}
              >
                <FilePlus2 size={16} strokeWidth={1.7} aria-hidden />
                New prompt
              </button>
            </div>
          </form>
          <ul className="mt-3 flex flex-col gap-2">
            {items.length === 0 && <li className="py-6 text-center text-[13px] text-text-3">No templates yet. Save the current prompt above, or write a new one.</li>}
            {items.map((t) => (
              <li key={t.id} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPrompt(t.text);
                    onClose();
                  }}
                  data-tip="Use this template: replaces the prompt in the box"
                  className="hover-wash min-w-0 flex-1 rounded-m border border-line px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                >
                  <span className="block truncate text-[14px] text-text">{t.name}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-text-3">{t.text}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Edit template ${t.name}`}
                  data-tip="Edit this template's name and text"
                  onClick={() => setDraft({ id: t.id, name: t.name, text: t.text })}
                  className="hover-wash flex w-11 flex-none items-center justify-center rounded-m border border-line text-text-3 transition-colors hover:text-text"
                >
                  <Pencil size={16} strokeWidth={1.7} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete template ${t.name}`}
                  data-tip="Delete this template"
                  onClick={() => useTemplates.getState().remove(t.id)}
                  className="hover-wash flex w-11 flex-none items-center justify-center rounded-m border border-line text-text-3 transition-colors hover:text-text"
                >
                  <Trash2 size={16} strokeWidth={1.7} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>,
    document.body,
  );
}

/** Mobile chip: opens the template sheet. */
export function TemplateChip({ target = "create" }: { target?: TemplateTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Chip toggle={false} onClick={() => setOpen(true)} label="Prompt templates" tip="Save and reuse prompts">
        <FileText size={15} strokeWidth={1.7} />
        <span>Templates</span>
      </Chip>
      <TemplateSheet open={open} onClose={() => setOpen(false)} target={target} />
    </>
  );
}

/** Desktop: a small pill inside the prompt box, next to the style pill. */
export function TemplateButton({ target = "create" }: { target?: TemplateTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Prompt templates"
        data-tip="Save and reuse prompts"
        className="hover-wash flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-[12.5px] text-text-2 transition-colors hover:border-text-3 hover:text-text"
      >
        <FileText size={14} strokeWidth={1.7} className="flex-none" aria-hidden />
        <span>Templates</span>
      </button>
      <TemplateSheet open={open} onClose={() => setOpen(false)} target={target} />
    </>
  );
}
