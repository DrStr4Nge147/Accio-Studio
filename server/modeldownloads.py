"""Model downloads for Settings > Models: what is installed, and one background job that fetches the rest.

The verify / resume / "already have it" rules are installer/modelfiles.py, shared with the installer's tooling. The browser only
ever names manifest entries; every URL comes from the manifest.
"""
from __future__ import annotations

import logging
import sys
import threading
from pathlib import Path
from typing import Any, Callable

from config import ROOT

sys.path.insert(0, str(ROOT / "installer"))
import modelfiles  # noqa: E402
from core import DownloadCancelled, free_space  # noqa: E402

log = logging.getLogger("accio")
DISK_MARGIN = 2_000_000_000  # left free on top of the download


class DownloadError(Exception):
    """A request that cannot be served; the message is shown to the user as is."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _idle() -> dict[str, Any]:
    return {"state": "idle", "queue": [], "current": None, "done": [], "failed": [], "message": ""}


class ModelDownloads:
    def __init__(self, manifest: dict[str, Any], on_finish: Callable[[], None] = lambda: None):
        self.models = {m["file"]: m for m in manifest["models"]}
        self.on_finish = on_finish  # called when a job ends, so cached "missing model" answers are dropped
        self._lock = threading.Lock()
        self._job = _idle()
        self._cancel = threading.Event()
        self._thread: threading.Thread | None = None

    # ---- reading

    def job(self) -> dict[str, Any]:
        with self._lock:
            return {**self._job, "queue": list(self._job["queue"]), "done": list(self._job["done"]), "failed": list(self._job["failed"])}

    def listing(self, models_dir: Path) -> dict[str, Any]:
        """Every manifest entry with its state (blocking file checks: call from a thread). A running job turns its files into
        "downloading" / "queued"; for those and for "partial" files `bytes` is how much is already on disk."""
        job = self.job()
        waiting = set(job["queue"]) - set(job["done"]) - set(job["failed"])
        rows = []
        for fid, m in self.models.items():
            state, have = modelfiles.status(m, models_dir, say=lambda _: None)
            if job["state"] == "running" and state not in ("linked", "installed"):
                if fid == job["current"]:
                    state = "downloading"
                elif fid in waiting:
                    state = "queued"
            rows.append({"id": fid, "size": m["size"], "folder": m["folder"], "required": bool(m["required"]), "group": m.get("group"),
                         "used_by": m.get("used_by", ""), "state": state, "bytes": have})
        return {"models": rows, "job": job, "free_bytes": free_space(models_dir)}

    # ---- changing

    def start(self, ids: list[str], models_dir: Path) -> None:
        unknown = [i for i in ids if i not in self.models]
        if not ids or unknown:
            raise DownloadError("Unknown model.")
        ids = list(dict.fromkeys(ids))
        with self._lock:
            if self._job["state"] == "running":
                raise DownloadError("A download is already running.", 409)
            todo = []
            for fid in ids:
                state, have = modelfiles.status(self.models[fid], models_dir, say=lambda _: None)
                if state not in ("linked", "installed"):
                    todo.append((fid, self.models[fid]["size"] - have))
            if not todo:
                raise DownloadError("Those models are already installed.")
            need = sum(n for _, n in todo)
            if free_space(models_dir) < need * 1.02 + DISK_MARGIN:
                raise DownloadError("Not enough free disk space for these downloads.")
            self._cancel = threading.Event()
            self._job = {**_idle(), "state": "running", "queue": [f for f, _ in todo]}
            self._thread = threading.Thread(target=self._run, args=(self._cancel, models_dir), name="model-download", daemon=True)
            self._thread.start()

    def cancel(self) -> None:
        self._cancel.set()  # the partial file stays; the next download continues from it

    def wait(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread:
            thread.join(timeout)

    # ---- the worker

    def _set(self, **kw: Any) -> None:
        with self._lock:
            self._job.update(kw)

    def _run(self, cancel: threading.Event, models_dir: Path) -> None:
        outcome, message = "done", ""
        try:
            for fid in self.job()["queue"]:
                if cancel.is_set():
                    break
                self._set(current=fid)
                m = self.models[fid]
                if modelfiles.status(m, models_dir, say=log.info)[0] in ("linked", "installed"):
                    self._append("done", fid)
                    continue
                try:
                    ok = modelfiles.fetch(m, models_dir, cancel=cancel, quiet=True, say=log.info)
                except DownloadCancelled:
                    break
                self._append("done" if ok else "failed", fid)
            if cancel.is_set():
                outcome, message = "cancelled", "Stopped. Partly downloaded files are kept and continue next time."
            elif self.job()["failed"]:
                outcome, message = "failed", "Some downloads failed or did not verify. Check the connection and try again."
        except Exception:  # noqa: BLE001 - reported to the user without details
            log.exception("model download job crashed")
            outcome, message = "failed", "The download stopped unexpectedly. Try again."
        finally:
            self._set(state=outcome, current=None, message=message)
            try:
                self.on_finish()
            except Exception:  # noqa: BLE001
                log.exception("model download finish hook failed")

    def _append(self, key: str, fid: str) -> None:
        with self._lock:
            self._job[key].append(fid)
