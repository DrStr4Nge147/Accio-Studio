import { useEffect, useState } from "react";
import { ChevronRight, Folder, HardDrive, CornerLeftUp } from "lucide-react";
import { browseFolders, type FolderListing } from "../../api/endpoints";

const small = "hover-wash inline-flex h-9 items-center gap-1 rounded-full border border-line-strong px-3 text-[13px] text-text-2 hover:text-text disabled:opacity-50";

const join = (dir: string, name: string) => (dir.endsWith("\\") ? dir + name : `${dir}\\${name}`);

/** Picks a folder on the PC that runs Accio (a browser cannot read real paths, so the server lists the folders). */
export function FolderBrowser({ start, onPick, onClose }: { start: string; onPick: (path: string) => void; onClose: () => void }) {
  const [list, setList] = useState<FolderListing | null>(null);
  const [failed, setFailed] = useState(false);

  const go = (path: string) => {
    setFailed(false);
    browseFolders(path)
      .then(setList)
      .catch(() => setFailed(true));
  };
  useEffect(() => go(start), [start]);

  return (
    <div className="mt-1.5 rounded-s border border-line-strong bg-raised p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={small} disabled={!list || list.parent === null} onClick={() => list && go(list.parent ?? "")}>
          <CornerLeftUp size={14} strokeWidth={1.7} /> Up
        </button>
        <button type="button" className={`${small} bg-gold text-on-gold`} disabled={!list || list.drives} onClick={() => list && onPick(list.path)}>
          Use this folder
        </button>
        <button type="button" className={small} onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="mt-2 break-all font-mono text-[12px] text-text-2">{list ? list.path || "This PC" : failed ? "" : "Loading…"}</p>
      {failed && <p className="mt-1 text-[12px] text-danger">Couldn't list the folders. Type the path instead.</p>}
      {list && (
        <ul className="mt-1 max-h-56 overflow-y-auto" aria-label="Folders">
          {list.folders.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => go(list.drives ? name : join(list.path, name))}
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-text hover:bg-overlay"
              >
                {list.drives ? <HardDrive size={15} strokeWidth={1.7} /> : <Folder size={15} strokeWidth={1.7} />}
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <ChevronRight size={14} strokeWidth={1.7} className="text-text-3" />
              </button>
            </li>
          ))}
          {list.folders.length === 0 && <li className="px-2 py-2 text-[12px] text-text-3">No folders in here.</li>}
        </ul>
      )}
    </div>
  );
}
