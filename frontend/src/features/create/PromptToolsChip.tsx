import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FileText, LayoutTemplate, Palette, WandSparkles } from "lucide-react";
import { Chip } from "../../components/ui/controls";
import { Sheet } from "../../components/ui/Sheet";
import { BuilderSheet } from "./builder/BuilderSheet";
import { LayoutSheet } from "./builder/LayoutSheet";
import { useEdit } from "../edit/store";
import { useCreate } from "./store";
import { StyleSheet } from "./StylePicker";
import { TemplateSheet } from "./TemplatePicker";

type Tool = "builder" | "layout" | "style" | "templates";

function Row({ icon, title, sub, onClick }: { icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hover-wash flex min-h-14 w-full items-center gap-3 rounded-m border border-line px-3 py-2 text-left transition-colors hover:border-line-strong">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-raised text-text-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-text">{title}</span>
        <span className="block truncate text-[12px] text-text-3">{sub}</span>
      </span>
      <ChevronRight size={16} strokeWidth={1.7} className="flex-none text-text-3" aria-hidden />
    </button>
  );
}

/**
 * Mobile: Style and Templates (plus Builder in Create) behind one chip, so the chip row stays on one line without hidden,
 * scroll-only chips. The chip gets a dot while a style is chosen; picking a tool closes this menu and opens that tool's own sheet.
 */
export function PromptToolsChip({ target = "create" }: { target?: "create" | "edit" }) {
  const createStyle = useCreate((s) => s.style);
  const editStyle = useEdit((s) => s.style);
  const style = target === "edit" ? editStyle : createStyle;
  const moss = useCreate((s) => s.variant === "moss");
  const [menu, setMenu] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const open = (t: Tool) => {
    setMenu(false);
    setTool(t);
  };
  const close = () => setTool(null);

  return (
    <>
      <Chip toggle={false} onClick={() => setMenu(true)} label={style ? `Prompt tools. Style: ${style.name}` : "Prompt tools"} tip={target === "edit" ? "Style and Templates" : "Builder, Style and Templates"}>
        <WandSparkles size={15} strokeWidth={1.7} className={style ? "text-gold-text" : undefined} />
        <span>Tools</span>
        {style && <i className="h-[7px] w-[7px] rounded-full bg-gold-ui" aria-hidden />}
      </Chip>
      {createPortal(
        <Sheet open={menu} onClose={() => setMenu(false)} title="Prompt tools" height="60%">
          <div className="flex flex-col gap-2">
            {target === "create" && <Row icon={<WandSparkles size={18} strokeWidth={1.7} />} title="Builder" sub="Build a prompt from options: character or scene" onClick={() => open("builder")} />}
            {target === "create" && moss && <Row icon={<LayoutTemplate size={18} strokeWidth={1.7} />} title="Layout" sub="Draw boxes and describe what goes in each" onClick={() => open("layout")} />}
            <Row icon={<Palette size={18} strokeWidth={1.7} />} title="Style" sub={style ? `Current: ${style.name}` : "Add a style to your prompt"} onClick={() => open("style")} />
            <Row icon={<FileText size={18} strokeWidth={1.7} />} title="Templates" sub="Save and reuse prompts" onClick={() => open("templates")} />
          </div>
        </Sheet>,
        document.body,
      )}
      {target === "create" && <BuilderSheet open={tool === "builder"} onClose={close} />}
      {target === "create" && <LayoutSheet open={tool === "layout"} onClose={close} />}
      <StyleSheet open={tool === "style"} onClose={close} target={target} />
      <TemplateSheet open={tool === "templates"} onClose={close} target={target} />
    </>
  );
}
