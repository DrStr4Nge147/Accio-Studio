"""Model files: finding the ones already on disk and downloading the rest (stdlib only).

The installer does not download models. This module holds the logic for the part of the app that does (Settings > Models),
so the verification, resume and "already have it" rules exist once.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import core
from core import curl_download, fmt_size, free_space, verify_safetensors

# The folders the app sorts LoRAs by (frontend/src/lib/loras.ts): Create's, then the two Edit families.
LORA_FOLDERS = ("krea2", "qwen2.1-edit", "flux-klein9b-edit")


def find_model_file(folder: Path, name: str) -> Path | None:
    """`name` directly in `folder`, else in any subfolder (ComfyUI lists models recursively, so users file LoRAs into loras/krea2/...)."""
    direct = folder / name
    if direct.is_file():
        return direct
    if not folder.is_dir():
        return None
    return next((p for p in sorted(folder.rglob("*")) if p.name.lower() == name.lower() and p.is_file()), None)


def settings_model_folders(kind: str) -> list[Path]:
    """The folders chosen in Settings > Model folders for one kind (diffusion_models, text_encoders, vae, loras), any family."""
    try:
        saved = json.loads((core.ROOT / "settings.json").read_text(encoding="utf-8")).get("model_paths", {})
        return [Path(k[kind]) for k in saved.values() if isinstance(k, dict) and isinstance(k.get(kind), str)]
    except (OSError, ValueError, AttributeError):
        return []


def locate_existing(m: dict, say: Callable[[str], None] = print) -> Path | None:
    """A verified copy of manifest entry `m` in a folder the user chose in Settings, else None."""
    for p in (find_model_file(d, m["file"]) for d in settings_model_folders(m["folder"])):
        if p:
            ok, why = verify_safetensors(p, m["size"])
            if ok:
                return p
            say(f"  [!] {m['file']} in the existing folder failed verification ({why}); will download a fresh copy")
    return None


def make_lora_folders(models_dir: Path) -> None:
    for name in LORA_FOLDERS:
        (models_dir / "loras" / name).mkdir(parents=True, exist_ok=True)


def wanted(manifest: dict, optional: bool = False, groups: frozenset[str] = frozenset()) -> list[dict]:
    """The manifest entries to have: every required one, plus an optional one when its "group" is asked for (or, with no group,
    when `optional` is set)."""
    return [m for m in manifest["models"] if m["required"] or (m["group"] in groups if "group" in m else optional)]


def install_models(manifest: dict, dest_root: Path, optional: bool = False, groups: frozenset[str] = frozenset(),
                   say: Callable[[str], None] = print) -> list[str]:
    """Download what is missing under `dest_root` (ComfyUI's models folder), resuming partial files. Returns the files that failed."""
    todo, rows = [], []
    for m in wanted(manifest, optional, groups):
        dest = dest_root / m["folder"] / m["file"]
        if locate_existing(m, say):
            rows.append((m["file"], m["size"], "found in a folder chosen in Settings"))
            continue
        have_at = find_model_file(dest.parent, m["file"])
        if have_at:
            ok, why = verify_safetensors(have_at, m["size"])
            if ok:
                rows.append((m["file"], m["size"], "already installed"))
                continue
            say(f"  [!] {m['file']} is incomplete or damaged ({why}); re-downloading")
            if have_at == dest:
                dest.unlink()  # only ever delete our own copy; a damaged file the user filed in a subfolder is left alone
        part = dest.with_name(dest.name + ".part")
        have = part.stat().st_size if part.is_file() else 0
        rows.append((m["file"], m["size"], f"download{f' (resume from {fmt_size(have)})' if have else ''}"))
        todo.append((m, dest, m["size"] - have))
    say("  Model                                                                 Size       Status")
    for name, size, status in rows:
        say(f"  {name[:66].ljust(66)} {fmt_size(size).rjust(9)}  {status}")
    need = sum(t[2] for t in todo)
    say(f"\n  To download: {fmt_size(need)} in {len(todo)} file(s). Free space: {fmt_size(free_space(dest_root))}.")
    if not todo:
        return []
    if free_space(dest_root) < need * 1.02 + 2_000_000_000:
        raise RuntimeError("not enough free disk space for the model downloads")
    failed = []
    for m, dest, _ in todo:
        say(f"\n  downloading {m['file']} ({fmt_size(m['size'])})")
        for attempt in (1, 2):
            try:
                curl_download(m["url"], dest, expected_size=m["size"])
                ok, why = verify_safetensors(dest, m["size"])
                if ok:
                    say("    verified.")
                    break
                say(f"    verification failed: {why}")
                dest.unlink(missing_ok=True)
            except RuntimeError as e:
                say(f"    {e}")
        else:
            failed.append(m["file"])
    return failed
