import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Camera, ImagePlus, Upload } from "lucide-react";
import { giveFilesToMode } from "./workspace";
import { useEditSubmit } from "./actions";
import type { EditMode } from "./store";

const ACCEPT = "image/*";
const hasTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** Hidden file inputs behind two buttons: pick from the gallery / disk, or (touch screens) take a photo. */
export function PickButtons({ multiple, onFiles, label = "Choose an image", compact }: { multiple?: boolean; onFiles: (f: File[]) => void; label?: string; compact?: boolean }) {
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) onFiles([...e.target.files]);
    e.target.value = ""; // the same file can be chosen again
  };
  const cls = compact
    ? "hover-wash flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[14px] font-medium text-text-2 hover:text-text"
    : "flex h-12 items-center gap-2 rounded-full bg-gradient-to-b from-gold-hi to-gold px-5 text-[15px] font-semibold text-on-gold";
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <input ref={pick} type="file" accept={ACCEPT} multiple={multiple} hidden onChange={take} />
      <input ref={cam} type="file" accept={ACCEPT} capture="environment" hidden onChange={take} />
      <button type="button" onClick={() => pick.current?.click()} className={cls}>
        <ImagePlus size={20} strokeWidth={1.7} /> {label}
      </button>
      {hasTouch() && (
        <button type="button" onClick={() => cam.current?.click()} className="hover-wash flex h-12 items-center gap-2 rounded-full border border-line-strong px-4 text-[14px] font-medium text-text-2 hover:text-text">
          <Camera size={20} strokeWidth={1.7} /> Take a photo
        </button>
      )}
    </div>
  );
}

/** Drag-and-drop of image files onto an element. Returns the props to spread and whether a drag is over it. */
export function useFileDrop(onFiles: (f: File[]) => void) {
  const [over, setOver] = useState(false);
  const isFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      },
    },
  };
}

/** Route files to a mode and show a problem in the composer's error slot. */
export async function receiveFiles(mode: EditMode, files: File[]) {
  const problem = await giveFilesToMode(mode, files);
  useEditSubmit.getState().setError(problem);
}

/** Ctrl+V of an image goes to the active Edit mode. */
export function usePasteImages(mode: EditMode) {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith("image/"))) {
        e.preventDefault();
        void receiveFiles(mode, files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [mode]);
}

/** Big empty-state drop target shared by the three editors. */
export function EmptyPicker({ mode, title, text, icon }: { mode: EditMode; title: string; text: string; icon?: ReactNode }) {
  const drop = useFileDrop((f) => void receiveFiles(mode, f));
  return (
    <div className="flex h-full overflow-y-auto p-4" {...drop.props}>
      <div className={`m-auto w-full max-w-md rounded-l border border-dashed p-7 text-center transition-colors ${drop.over ? "border-gold bg-gold-wash" : "border-line-strong"}`}>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-raised text-text-2">{icon ?? <Upload size={22} strokeWidth={1.7} />}</div>
        <h2 className="serif mt-4 text-[22px] font-medium">{title}</h2>
        <p className="mx-auto mt-2 max-w-xs text-[14px] text-text-2">{text}</p>
        <div className="mt-5">
          <PickButtons multiple={mode === "multiedit"} onFiles={(f) => void receiveFiles(mode, f)} label={mode === "multiedit" ? "Choose images" : "Choose an image"} />
        </div>
        <p className="mt-3 text-[12px] text-text-3">You can also drop a file here or paste one with Ctrl+V.</p>
      </div>
    </div>
  );
}
