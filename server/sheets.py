"""Character sheets: one photo -> a sheet of face close-ups and a sheet of full-body views.

Under the hood every view is an ordinary Multi-edit job (Qwen Image Edit, or Flux2 Klein) on the uploaded photo, so no new
ComfyUI graph exists. This module only (1) plans the jobs and writes each view's prompt, (2) follows them as a group and
(3) stitches the finished views into one picture per sheet.

separate: one render per view at full size, all with the same seed; the finished renders are stitched into a grid without
          resizing, so the sheet keeps the quality of every single view.
merged:   two renders (faces, body), each asking the model to draw the whole sheet in one picture. Quicker, lower quality per view.

The group is a "charsheet" job in the history. Its per-view renders are history rows with `parent` set: they are hidden from
the gallery and listed in the sheet as extra outputs (role "part") so each can still be opened on its own.
"""
from __future__ import annotations

import asyncio
import io
import logging
import math
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

import engine
from comfy import ComfyClient, ComfyError
from history import History
from jobs import JobManager
from schemas import CharSheetParams, MultiEditParams

log = logging.getLogger("accio.sheets")

POLL_SECONDS = 1.5
TERMINAL = ("done", "error", "cancelled")

FACE_SIZE = (1024, 1024)
BODY_SIZE = (768, 1344)
MERGED_FACE_SIZE = (1536, 1024)
MERGED_BODY_SIZE = (1536, 768)

# (label shown on the sheet, wording of the view)
FACE_VIEWS: dict[str, tuple[str, str]] = {
    "front": ("Front", "Front view, looking straight at the camera."),
    "three_quarter_left": ("3/4 left", "Three-quarter view: the head is turned about 45 degrees so the character faces toward the left side of the image."),
    "left_profile": ("Left profile", "Left side profile view: the head is turned 90 degrees, facing the left side of the image."),
    "three_quarter_right": ("3/4 right", "Three-quarter view: the head is turned about 45 degrees so the character faces toward the right side of the image."),
    "right_profile": ("Right profile", "Right side profile view: the head is turned 90 degrees, facing the right side of the image."),
    "back": ("Back", "View of the back of the head, seen from behind, showing the hair."),
}
BODY_VIEWS: dict[str, tuple[str, str]] = {
    "front": ("Front", "Front view, facing the camera."),
    "three_quarter_left": ("3/4 left", "Three-quarter view: the whole body is turned about 45 degrees so the character faces toward the left side of the image."),
    "left_side": ("Left side", "Left side view: the whole body is turned 90 degrees, facing the left side of the image."),
    "back": ("Back", "Back view, seen from behind."),
    "right_side": ("Right side", "Right side view: the whole body is turned 90 degrees, facing the right side of the image."),
    "three_quarter_right": ("3/4 right", "Three-quarter view: the whole body is turned about 45 degrees so the character faces toward the right side of the image."),
}

FACE_PROMPT = (
    "Using the character in the input image, make a head-and-shoulders close-up portrait on a plain light gray studio background "
    "with soft even lighting. Keep the exact same face, hair, skin, age, makeup and accessories. Neutral relaxed expression. "
    "Ignore the pose of the input photo: the head is perfectly upright and level (no tilt, no lean), the shoulders are square and level, "
    "and the chin is neither raised nor lowered, like an ID or reference photo. "
)
BODY_PROMPT = (
    "Using the character in the input image, show the same character in a full-body shot from head to toe, standing in a relaxed "
    "neutral A-pose with the arms slightly away from the body, on a plain light gray studio background with soft even lighting. "
    "Keep the exact same face, hair, skin, body proportions, outfit, shoes and accessories; invent the parts of the outfit that "
    "are not visible in a way that matches. The whole body must be fully visible with empty space around it. "
    "Ignore the pose of the input photo: the body is straight and symmetrical with the head upright and level, not tilted, leaning or posing. "
)
MERGED_FACE_PROMPT = (
    "Using the character in the input image, make a character reference sheet: {n} head-and-shoulders close-up portraits of the "
    "same character, laid out in a clean grid on a plain light gray studio background, each portrait at a different angle: {views}. "
    "Every portrait keeps the exact same face, hair, skin, age, makeup and accessories, with a neutral relaxed expression and "
    "soft even lighting. Ignore the pose of the input photo: in every portrait the head is upright and level, with no tilt or lean. "
    "No text, no labels. "
)
MERGED_BODY_PROMPT = (
    "Using the character in the input image, make a character reference sheet: {n} full-body views of the same character, head to "
    "toe, standing in a relaxed neutral A-pose, side by side in a single row on a plain light gray studio background, each at a "
    "different angle: {views}. Every view keeps the exact same face, hair, skin, body proportions, outfit, shoes and accessories "
    "and is fully visible. Soft even lighting. Ignore the pose of the input photo: every figure stands straight and symmetrical with "
    "the head upright and level, not tilted or posing. No text, no labels. "
)


@dataclass
class Child:
    group: str  # "faces" | "body"
    key: str  # view key, or "sheet" for a merged render
    label: str
    params: MultiEditParams


def _notes(p: CharSheetParams) -> str:
    return f"More about the character: {p.notes.strip()}" if p.notes.strip() else ""


def _child(p: CharSheetParams, seed: int, group: str, key: str, label: str, prompt: str, size: tuple[int, int]) -> Child:
    custom = p.face_size if group == "faces" else p.body_size
    if custom:
        size = (custom[0], custom[1])
    mp = MultiEditParams(
        mode="multiedit",
        prompt=(prompt + _notes(p)).strip(),
        images=[p.image],
        prompt_enhancer=False,  # a rewrite would drift from the exact view wording
        keep_original_resolution=False,
        pixel_drift_fix=False,  # it returns the result at the photo's size and would undo the sheet's size
        manual_size=True,
        manual_width=size[0],
        manual_height=size[1],
        seed=seed,  # the same seed for every view keeps the character steady
        sampler=p.sampler,
        size_hint=list(size),
        loras=p.loras,
        unet_name=p.unet_name,
        film_grain=p.film_grain,
    )
    return Child(group, key, label, mp)


def plan(p: CharSheetParams, seed: int) -> list[Child]:
    """The jobs a sheet needs, in the order they run: all face views, then all body views."""
    out: list[Child] = []
    if p.delivery == "merged":
        if p.face_views:
            views = ", ".join(FACE_VIEWS[v][0].lower() for v in p.face_views)
            out.append(_child(p, seed, "faces", "sheet", "Face sheet", MERGED_FACE_PROMPT.format(n=len(p.face_views), views=views), MERGED_FACE_SIZE))
        if p.body_views:
            views = ", ".join(BODY_VIEWS[v][0].lower() for v in p.body_views)
            out.append(_child(p, seed, "body", "sheet", "Body sheet", MERGED_BODY_PROMPT.format(n=len(p.body_views), views=views), MERGED_BODY_SIZE))
        return out
    for v in p.face_views:
        label, text = FACE_VIEWS[v]
        out.append(_child(p, seed, "faces", v, label, FACE_PROMPT + text + " ", FACE_SIZE))
    for v in p.body_views:
        label, text = BODY_VIEWS[v]
        out.append(_child(p, seed, "body", v, label, BODY_PROMPT + text + " ", BODY_SIZE))
    return out


# --------------------------------------------------------------------------- stitching

PAD = 24
BG = (30, 29, 34)
CAPTION = (232, 226, 212)


def grid_columns(n: int) -> int:
    """1-3 views in a row, 4 in a square, more wrap into rows of 3."""
    return n if n <= 3 else 2 if n == 4 else 3


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)  # Pillow 10.1+
    except TypeError:  # pragma: no cover - older Pillow: the small bitmap font
        return ImageFont.load_default()


def stitch(views: list[tuple[str, Image.Image]]) -> Image.Image:
    """The views in a wrapped grid, a caption under each. Views are pasted at their own size, never scaled, so nothing is lost."""
    cols = grid_columns(len(views))
    rows = math.ceil(len(views) / cols)
    cw = max(im.width for _, im in views)
    ch = max(im.height for _, im in views)
    cap = max(36, round(cw * 0.04))
    sheet = Image.new("RGB", (PAD + cols * (cw + PAD), PAD + rows * (ch + cap + PAD)), BG)
    draw = ImageDraw.Draw(sheet)
    font = _font(round(cap * 0.6))
    for i, (label, im) in enumerate(views):
        x = PAD + (i % cols) * (cw + PAD)
        y = PAD + (i // cols) * (ch + cap + PAD)
        sheet.paste(im.convert("RGB"), (x + (cw - im.width) // 2, y + (ch - im.height) // 2))
        draw.text((x + cw // 2, y + ch + cap // 2), label, fill=CAPTION, font=font, anchor="mm")
    return sheet


def _png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _stitch_png(views: list[tuple[str, bytes]]) -> bytes:
    opened = [(label, Image.open(io.BytesIO(data))) for label, data in views]
    for _, im in opened:
        im.load()
    return _png(stitch(opened))


# --------------------------------------------------------------------------- orchestration


class SheetManager:
    """Creates sheets and follows their per-view jobs. `out_dir` is the bundled backend's output folder, or None when Accio
    does not own it (external backend): then nothing is written and a separate sheet keeps its views as plain images."""

    def __init__(self, jobs: JobManager, history: History, comfy: ComfyClient, out_dir: Path | None):
        self.jobs = jobs
        self.history = history
        self.comfy = comfy
        self.out_dir = out_dir
        self._tasks: dict[str, asyncio.Task] = {}
        self._cancelled: set[str] = set()

    async def create(self, p: CharSheetParams, cat: engine.Catalog, prefix: str) -> dict[str, Any]:
        seed = p.seed if p.seed is not None else engine.default_seed()
        children = plan(p, seed)
        # Build everything first: a bad setting is reported before anything is queued.
        builts = [engine.build(c.params, cat, output_prefix=prefix) for c in children]
        pid = uuid.uuid4().hex
        n = len(children)
        row = {
            "id": pid,
            "created_at": time.time(),
            "mode": "charsheet",
            "label": "Edit · Character sheet",
            "template": "charsheet",
            "status": "running",
            "params": p.model_dump(mode="json"),
            "seeds": {"main": seed},
            "warnings": [],
        }
        self.history.create(row)
        self.jobs.live[pid] = {"node": "sheet", "class": "CharSheet", "step": 0, "max": n}
        submitted: list[str] = []
        try:
            for c, b in zip(children, builts):
                job = await self.jobs.submit(b, c.params.model_dump(mode="json"), parent=pid)
                submitted.append(job["id"])
        except Exception:
            for jid in submitted:
                await self.jobs.cancel(jid)
            self.history.finish(pid, "error", error="Couldn't queue every view of the sheet.")
            self.jobs.live.pop(pid, None)
            raise
        meta = {jid: {"group": c.group, "key": c.key, "label": c.label} for jid, c in zip(submitted, children)}
        self.history.update(pid, params={**row["params"], "_views": meta})
        self._start(pid)
        await self.jobs._broadcast_job(pid)
        return self.jobs.public(pid)  # type: ignore[return-value]

    def _start(self, pid: str) -> None:
        self._tasks[pid] = asyncio.create_task(self._watch(pid), name=f"sheet-{pid[:8]}")

    async def resume(self) -> None:
        """After a server restart: pick up sheets that were still running."""
        for job in self.history.active():
            if job["mode"] == "charsheet" and job["id"] not in self._tasks:
                self._start(job["id"])

    async def stop(self) -> None:
        for t in self._tasks.values():
            t.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    async def cancel(self, pid: str) -> dict[str, Any] | None:
        job = self.history.get(pid)
        if not job or job["status"] not in ("queued", "running"):
            return job and self.jobs.public(pid)
        self._cancelled.add(pid)
        kids = [k for k in self.history.children(pid) if k["status"] in ("queued", "running")]
        # Queued renders first: stopping the running one would let ComfyUI start the next at once.
        for k in sorted(kids, key=lambda k: k["status"] != "queued"):
            await self.jobs.cancel(k["id"])
        return self.jobs.public(pid)

    async def _watch(self, pid: str) -> None:
        try:
            while True:
                kids = self.history.children(pid)
                finished = sum(k["status"] in TERMINAL for k in kids)
                if not kids or finished == len(kids):
                    break
                live = self.jobs.live.setdefault(pid, {})
                live.update(node="sheet", **{"class": "CharSheet"}, step=finished, max=len(kids))
                ahead = [self.jobs.live.get(k["id"], {}).get("queue_ahead") for k in kids if k["status"] in ("queued", "running")]
                ahead = [a for a in ahead if a is not None]
                live["queue_ahead"] = min(ahead) if ahead else 0
                await self.jobs._broadcast_job(pid)
                await asyncio.sleep(POLL_SECONDS)
            await self._finish(pid, kids)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sheet %s failed", pid)
            self.history.finish(pid, "error", error="The character sheet couldn't be finished.")
            await self.jobs._broadcast_job(pid)
        finally:
            self.jobs.live.pop(pid, None)
            self._tasks.pop(pid, None)
            self._cancelled.discard(pid)

    async def _fetch(self, out: dict[str, Any]) -> bytes | None:
        r = await self.comfy.send(self.comfy.view_stream(out["filename"], out["subfolder"], out["type"]))
        return r.content if r.status_code == 200 else None

    async def _finish(self, pid: str, kids: list[dict[str, Any]]) -> None:
        job = self.history.get(pid)
        meta = job["params"].get("_views", {})
        done = [k for k in kids if k["status"] == "done" and k["outputs"]]
        parts = [(k, next((o for o in k["outputs"] if o["role"] == "final"), k["outputs"][0])) for k in done]
        warnings: list[str] = []
        failed = len(kids) - len(done)
        if failed and pid not in self._cancelled:
            warnings.append(f"{failed} of {len(kids)} views failed and are missing from the sheet.")
        merged = job["params"].get("delivery") == "merged"
        outputs: list[dict[str, Any]] = []
        if not merged and self.out_dir is not None and parts:
            outputs += await self._stitched(pid, parts, meta, warnings)
        elif not merged and parts:
            warnings.append("The sheet could not be stitched because Accio does not own this backend's output folder. The views are shown on their own.")
        stitched = bool(outputs)
        for k, o in parts:
            v = meta.get(k["id"], {})
            label = v.get("label", "View") if merged else f"{v.get('group', '').capitalize()} · {v.get('label', 'View')}"
            outputs.append({**o, "role": "part" if stitched else "final", "label": label})
        if pid in self._cancelled:
            self.history.finish(pid, "cancelled", outputs=outputs, warnings=warnings)
        elif not parts:
            err = next((k["error"] for k in kids if k["error"]), None) or "No view could be made."
            self.history.finish(pid, "error", error=err, warnings=warnings)
        else:
            self.history.finish(pid, "done", outputs=outputs, warnings=warnings)
        await self.jobs._broadcast_job(pid)

    async def _stitched(self, pid: str, parts: list[tuple[dict, dict]], meta: dict, warnings: list[str]) -> list[dict[str, Any]]:
        """One stitched file per group (faces, body) that has at least one finished view."""
        outs: list[dict[str, Any]] = []
        for group in ("faces", "body"):
            views: list[tuple[str, bytes]] = []
            for k, o in parts:
                if meta.get(k["id"], {}).get("group") != group:
                    continue
                try:
                    data = await self._fetch(o)
                except ComfyError:
                    data = None
                if data:
                    views.append((meta[k["id"]]["label"], data))
            if not views:
                continue
            try:
                png = await asyncio.to_thread(_stitch_png, views)
                outs.append(await asyncio.to_thread(self._save, pid, group, png))
            except Exception:
                log.exception("stitching the %s sheet failed", group)
                warnings.append(f"The {group} sheet could not be stitched; its views are shown on their own.")
        return outs

    def _save(self, pid: str, group: str, png: bytes) -> dict[str, Any]:
        sub = "AccioStudio"
        folder = (self.out_dir / sub).resolve()  # type: ignore[operator]
        folder.mkdir(parents=True, exist_ok=True)
        name = f"sheet_{pid[:8]}_{group}.png"
        (folder / name).write_bytes(png)
        return {"node": "sheet", "role": "final", "filename": name, "subfolder": sub, "type": "output", "label": f"{group.capitalize()} sheet"}
