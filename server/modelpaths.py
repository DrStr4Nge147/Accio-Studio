"""Model folders chosen in Settings: use models that already sit on this PC (another ComfyUI, another image app).

Per family (Krea2, Qwen 2.1 Edit, Flux Klein 9B) the user can point at a folder for the diffusion model, the text encoder,
the VAE and the LoRAs. Saving does two things in the bundled ComfyUI folder, then the backend is restarted (backend.py):

- diffusion models, text encoders and VAEs: the folders are listed in extra_model_paths.yaml (ComfyUI reads it at startup);
- LoRAs: a folder junction loras/<family folder> -> the chosen folder, so the files list as `krea2/x.safetensors` and the LoRA
  picker's folder grouping (frontend/src/lib/loras.ts) keeps working. Plain extra paths would list them without any folder.

Nothing in the chosen folders is ever written, moved or deleted: removing a junction only removes the link.
"""
from __future__ import annotations

import json
import os
import stat
import subprocess
from pathlib import Path
from typing import Any

try:  # Windows-only (the app is); the import failing just disables junction creation
    from _winapi import CreateJunction  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover
    CreateJunction = None  # type: ignore[assignment]

YAML_MARKER = "# --- Accio Studio: model folders set in Settings (rewritten on every save) ---"
FAMILIES: dict[str, dict[str, str]] = {  # id -> label, folder under models/loras (the installer creates the same three, installer/modelfiles.py; a test keeps them equal)
    "krea2": {"label": "Krea2 (Create)", "lora_dir": "krea2"},
    "qwen_edit": {"label": "Qwen 2.1 Edit", "lora_dir": "qwen2.1-edit"},
    "klein": {"label": "Flux Klein 9B (Edit)", "lora_dir": "flux-klein9b-edit"},
}
KINDS: dict[str, str] = {"diffusion_models": "Diffusion model", "text_encoders": "Text encoder", "vae": "VAE", "loras": "LoRAs"}
MODEL_EXTS = {".safetensors", ".gguf", ".ckpt", ".pt", ".pth"}
COUNT_CAP = 5000


class ModelPathError(ValueError):
    """A folder that cannot be used. The message is shown to the user as is (it names the field, never a system path)."""


def field_name(family: str, kind: str) -> str:
    return f"{FAMILIES[family]['label']} · {KINDS[kind]}"


def normalize(raw: Any) -> dict[str, dict[str, str]]:
    """Only known families and kinds, only non-empty strings. Unknown keys are an error, not silently dropped."""
    if not isinstance(raw, dict):
        raise ModelPathError("The model folders were not understood.")
    out: dict[str, dict[str, str]] = {}
    for family, kinds in raw.items():
        if family not in FAMILIES or not isinstance(kinds, dict):
            raise ModelPathError("The model folders were not understood.")
        for kind, path in kinds.items():
            if kind not in KINDS or not isinstance(path, str):
                raise ModelPathError("The model folders were not understood.")
            path = path.strip().strip('"')
            if path:
                out.setdefault(family, {})[kind] = os.path.normpath(path)
    return out


def validate(paths: dict[str, dict[str, str]], models_dir: Path) -> None:
    inside = models_dir.resolve()
    for family, kinds in paths.items():
        for kind, path in kinds.items():
            name = field_name(family, kind)
            p = Path(path)
            if not p.is_absolute():
                raise ModelPathError(f"{name}: enter the full folder path, for example D:\\Models\\{KINDS[kind]}.")
            if not p.is_dir():
                raise ModelPathError(f"{name}: that folder was not found.")
            if p.resolve() == inside or inside in p.resolve().parents:
                raise ModelPathError(f"{name}: that folder is already inside the app's own models folder. Pick a folder outside it.")


def count_models(path: str) -> int | None:
    """How many model files a folder holds (capped), or None when it is not a folder."""
    if not os.path.isdir(path):
        return None
    n = 0
    for _, _, files in os.walk(path):
        n += sum(1 for f in files if os.path.splitext(f)[1].lower() in MODEL_EXTS)
        if n >= COUNT_CAP:
            return COUNT_CAP
    return n


def default_folder(comfy_base: Path, family: str, kind: str) -> str:
    """Where the app keeps that kind of model itself (what an empty field means)."""
    models = comfy_base / "ComfyUI" / "models"
    return str(models / "loras" / FAMILIES[family]["lora_dir"] if kind == "loras" else models / kind)


def browse(path: str) -> dict[str, Any]:
    """Sub-folders of `path` for the folder picker; no path = the drives. Folders only, never file names. A folder that is
    gone or unreadable falls back to its nearest existing parent."""
    if not path.strip():
        drives = [f"{c}:\\" for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if os.path.isdir(f"{c}:\\")]
        return {"path": "", "parent": None, "folders": drives, "drives": True}
    p = Path(os.path.abspath(path.strip().strip('"')))
    while not p.is_dir() and p.parent != p:
        p = p.parent
    if not p.is_dir():
        return browse("")
    try:
        names = sorted((e.name for e in os.scandir(p) if e.is_dir(follow_symlinks=True) and not e.name.startswith("$")), key=str.lower)
    except OSError:
        names = []
    parent = "" if p.parent == p else str(p.parent)
    return {"path": str(p), "parent": parent, "folders": names[:500], "drives": False}


PICK_SCRIPT = (
    "Add-Type -AssemblyName System.Windows.Forms;"
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
    # Windows keeps a background process from taking focus, so the dialog would open behind the browser. Show a tiny
    # invisible topmost owner window, press Alt (releases the foreground lock) and bring that owner to the front first.
    "Add-Type -Namespace Native -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);"
    " [DllImport(\"user32.dll\")] public static extern void keybd_event(byte k, byte s, int f, int e);';"
    "$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false;"
    "$owner.FormBorderStyle = 'None'; $owner.Opacity = 0; $owner.Size = New-Object System.Drawing.Size(1, 1);"
    "$owner.StartPosition = 'CenterScreen'; $owner.Show();"
    "[Native.U]::keybd_event(0x12, 0, 0, 0); [Native.U]::keybd_event(0x12, 0, 2, 0);"
    "[void][Native.U]::SetForegroundWindow($owner.Handle); $owner.Activate();"
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
    "$d.Description = 'Choose the folder that holds these models'; $d.ShowNewFolderButton = $false;"
    "if ($env:ACCIO_START -and (Test-Path -LiteralPath $env:ACCIO_START -PathType Container)) { $d.SelectedPath = $env:ACCIO_START };"
    "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }"
)
PICK_TIMEOUT = 600


def pick_folder(start: str = "") -> str | None:
    """Windows' own folder dialog, opened on the PC that runs Accio (the caller makes sure the request comes from there).
    Blocks until the user chooses or cancels; returns the path or None."""
    env = {**os.environ, "ACCIO_START": start[:1024]}
    try:
        done = subprocess.run(  # noqa: S603
            ["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", PICK_SCRIPT],
            env=env, capture_output=True, text=True, encoding="utf-8", timeout=PICK_TIMEOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=False,
        )
    except (OSError, subprocess.SubprocessError):
        raise ModelPathError("Could not open the folder dialog on this PC.") from None
    chosen = done.stdout.strip().splitlines()
    return chosen[-1].strip() if chosen and os.path.isdir(chosen[-1].strip()) else None


def _is_link(p: Path) -> bool:
    try:
        return bool(p.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)  # type: ignore[attr-defined]
    except (OSError, AttributeError):
        return False


def _is_empty_dir(p: Path) -> bool:
    return p.is_dir() and not any(p.iterdir())


def sync_lora_links(models_dir: Path, paths: dict[str, dict[str, str]]) -> None:
    """Make loras/<family folder> a junction to the chosen folder, or an ordinary empty folder when none is chosen."""
    for family, info in FAMILIES.items():
        link = models_dir / "loras" / info["lora_dir"]
        target = paths.get(family, {}).get("loras")
        if _is_link(link):
            if target and os.path.normcase(os.path.realpath(link)) == os.path.normcase(os.path.realpath(target)):
                continue
            os.rmdir(link)  # a junction: this removes the link only, never the files behind it
        elif link.exists() and target:
            if not _is_empty_dir(link):
                raise ModelPathError(
                    f"{field_name(family, 'loras')}: the app's own loras\\{info['lora_dir']} folder already holds files. "
                    "Move them into the folder you chose (or somewhere else), then save again."
                )
            link.rmdir()
        if target:
            if CreateJunction is None:
                raise ModelPathError("Linking a LoRA folder is only supported on Windows.")
            link.parent.mkdir(parents=True, exist_ok=True)
            CreateJunction(target, str(link))
        else:
            link.mkdir(parents=True, exist_ok=True)


def yaml_section(paths: dict[str, dict[str, str]]) -> str:
    """The extra_model_paths.yaml block for diffusion models, text encoders and VAEs (GGUF files share diffusion_models)."""
    lines = []
    for kind in ("diffusion_models", "text_encoders", "vae"):
        folders: list[str] = []
        for family in FAMILIES:
            p = paths.get(family, {}).get(kind)
            if p and Path(p).as_posix() not in folders:
                folders.append(Path(p).as_posix())
        if folders:
            lines.append(f"    {kind}: {json.dumps(chr(10).join(folders))}")  # a JSON string is a valid YAML double-quoted scalar
    if not lines:
        return ""
    return "\n".join([YAML_MARKER, "accio_user:", *lines]) + "\n"


def write_yaml(yaml_path: Path, paths: dict[str, dict[str, str]]) -> None:
    """Rewrite our block of the yaml; whatever the installer wrote above the marker stays."""
    try:
        old = yaml_path.read_text(encoding="utf-8")
    except OSError:
        old = ""
    head = old.split(YAML_MARKER)[0].rstrip("\n")
    body = yaml_section(paths)
    if not head and not body:
        yaml_path.unlink(missing_ok=True)
        return
    yaml_path.write_text((head + "\n\n" if head and body else head + "\n" if head else "") + body, encoding="utf-8")


def apply(comfy_base: Path, paths: dict[str, dict[str, str]]) -> None:
    """Validate, then write the yaml and the LoRA links of the bundled ComfyUI in `comfy_base`."""
    comfy = comfy_base / "ComfyUI"
    validate(paths, comfy / "models")
    sync_lora_links(comfy / "models", paths)
    write_yaml(comfy / "extra_model_paths.yaml", paths)
