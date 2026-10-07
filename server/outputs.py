"""Deleting a job's result files from the bundled backend's output folder.

Only files that our own history says the backend saved (type "output"), only inside that folder, only for the bundled
backend: with an external backend Accio does not own the files, so they are left alone.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("accio.outputs")


def output_dir(comfy_dir: Path) -> Path:
    return comfy_dir / "ComfyUI" / "output"


def can_delete(settings: dict[str, Any], comfy_dir: Path) -> bool:
    return not str(settings["external_comfy_url"]).strip() and output_dir(comfy_dir).is_dir()


def delete_files(root: Path, outputs: list[dict[str, Any]]) -> tuple[int, int]:
    """(deleted, failed). A file that is already gone counts as deleted; one that cannot be removed or lies outside
    the output folder counts as failed."""
    base = root.resolve()
    deleted = failed = 0
    for o in outputs:
        try:
            if o.get("type") != "output":
                failed += 1
                continue
            path = (base / str(o.get("subfolder", "")) / str(o["filename"])).resolve()
            if base not in path.parents:  # no escaping the output folder, whatever the history holds
                failed += 1
                continue
            path.unlink(missing_ok=True)
            deleted += 1
        except (OSError, KeyError, ValueError):
            log.warning("could not delete an output file", exc_info=True)
            failed += 1
    return deleted, failed
