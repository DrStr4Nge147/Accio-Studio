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

# (label shown on the sheet, wording of the view). "Left" and "right" are as seen in the picture: a "left" view looks toward
# the left edge of the image.
FACE_VIEWS: dict[str, tuple[str, str]] = {
    "front": (
        "Front",
        "Completely front-facing, like a passport photo: the face points squarely at the camera, the nose is centered between the eyes, "
        "both eyes and both ears are equally visible, and the head and shoulders are square to the camera, symmetrical, upright and level.",
    ),
    "three_quarter_left": (
        "3/4 left",
        "Exact three-quarter view: the head and shoulders are turned about 45 degrees so the face looks toward the left edge of the image; "
        "both eyes are still visible with the far cheek showing, and the head stays upright and level.",
    ),
    "left_profile": (
        "Left profile",
        "Exact side profile view: the head and shoulders are turned 90 degrees so the face looks toward the left edge of the image; "
        "only one eye and one ear are visible, the nose and lips are in clean profile, and the head stays upright and level.",
    ),
    "three_quarter_right": (
        "3/4 right",
        "Exact three-quarter view: the head and shoulders are turned about 45 degrees so the face looks toward the right edge of the image; "
        "both eyes are still visible with the far cheek showing, and the head stays upright and level.",
    ),
    "right_profile": (
        "Right profile",
        "Exact side profile view: the head and shoulders are turned 90 degrees so the face looks toward the right edge of the image; "
        "only one eye and one ear are visible, the nose and lips are in clean profile, and the head stays upright and level.",
    ),
    "back": (
        "Back of head",
        "Seen completely from behind: the back of the head, the hair and the back of the neck fill the frame, no face is visible, "
        "and the shoulders are square and level.",
    ),
}
BODY_VIEWS: dict[str, tuple[str, str]] = {
    "front": (
        "Front",
        "Completely front-facing: the whole body points squarely at the camera, the head is upright and looks straight into the lens, "
        "and the body is symmetrical with the shoulders and hips square and level.",
    ),
    "three_quarter_left": (
        "3/4 left",
        "Exact three-quarter view: the whole body turns about 45 degrees to the LEFT so the chest points toward the left-front of the image, and the head follows the body, "
        "looking toward the left-front rather than straight at the camera; the far shoulder is partly hidden.",
    ),
    "left_side": (
        "Left side",
        "Exact full-profile side view: the character is facing the LEFT edge of the image. The nose, chest and toes all point left and the character looks toward the left edge of the image, "
        "not at the camera; the back is toward the right edge of the image. Only one arm and one leg are in front.",
    ),
    "back": (
        "Back",
        "Seen completely from behind: the character faces away from the camera, the back of the head and the back of the outfit are visible, no face is visible.",
    ),
    "right_side": (
        "Right side",
        "Exact full-profile side view: the character is facing the RIGHT edge of the image. The nose, chest and toes all point right and the character looks toward the right edge of the image, "
        "not at the camera; the back is toward the left edge of the image. Only one arm and one leg are in front.",
    ),
    "three_quarter_right": (
        "3/4 right",
        "Exact three-quarter view: the whole body turns about 45 degrees to the RIGHT so the chest points toward the right-front of the image, and the head follows the body, "
        "looking toward the right-front rather than straight at the camera; the far shoulder is partly hidden.",
    ),
}

# Every prompt rebuilds the character in a fresh studio pose: Qwen Edit otherwise keeps the input photo's body angle, head turn and tilt.
KEEP = "the exact same face, hair, skin, age, makeup, accessories and clothing"
RESET = "Do not copy the body angle, head turn, head tilt, pose, framing or background of the input photo."
FACE_PROMPT = (
    "Create a brand new studio character-reference portrait of the same person as in the input image, with " + KEEP + ". "
    "Tight head-and-shoulders close-up: the head fills most of the frame and the picture is cropped at the upper chest. "
    "Plain light gray background, soft even lighting, neutral relaxed expression. " + RESET + " "
)
BODY_PROMPT = (
    "Create a brand new studio character-reference full-body picture of the same person as in the input image, with " + KEEP + ". "
    "The character stands in a relaxed neutral A-pose with the arms slightly away from the body and the legs straight, shown from head to toe "
    "with the shoes visible; the figure fills about 90 percent of the picture height with a little empty space around it. Where the input photo does not show part of the outfit (for example the "
    "legs or shoes), draw it in a matching style. Plain light gray background, soft even lighting, neutral relaxed expression. " + RESET + " "
)
MERGED_FACE_PROMPT = (
    "Create a brand new character-reference sheet of the same person as in the input image: exactly {n} tight head-and-shoulders close-up "
    "portraits and no others, laid out in {layout} on a plain light gray studio background. " + RESET + " Every portrait has " + KEEP + ", "
    "a neutral relaxed expression and soft even lighting. Each portrait is its own separate, clean photo in its own cell with a thin white gutter between cells; "
    "nothing overlaps and there is no double exposure or ghosting. The portraits, in order: {panels} No text, no labels. "
)
MERGED_BODY_PROMPT = (
    "Create a brand new character-reference sheet of the same person as in the input image: exactly {n} full-body views and no others, head to toe, "
    "standing in a relaxed neutral A-pose, laid out in {layout} on a plain light gray studio background. " + RESET + " Every view has " + KEEP + ", "
    "shows the shoes, and is fully visible; draw the parts of the outfit the input photo does not show in a matching style. Soft even lighting. "
    "Each view is its own separate, clean figure with clear space between figures; nothing overlaps. The views, in order: {panels} No text, no labels. "
)


def merged_face_views(chosen: list[str]) -> list[str]:
    """A merged face sheet is drawn as a full grid: the model ghosts or blends the panels of a half-empty last row. With 5 views the
    one that is missing is added to complete a 3x2 grid."""
    if len(chosen) != 5:
        return list(chosen)
    return list(chosen) + [v for v in FACE_VIEWS if v not in chosen][:1]


def _panels(views: list[str], table: dict[str, tuple[str, str]], cols: int, noun: str) -> tuple[str, str]:
    """(layout phrase, numbered per-panel descriptions) for a merged sheet's prompt."""
    n = len(views)
    rows = math.ceil(n / cols)
    counts = [min(cols, n - r * cols) for r in range(rows)]
    layout = f"a single row of {n}" if rows == 1 else f"{rows} rows ({', '.join(f'{c} in row {i + 1}' for i, c in enumerate(counts))}), filled left to right, top to bottom"
    parts = []
    for i, v in enumerate(views):
        place = f"position {i + 1}" if rows == 1 else f"row {i // cols + 1}, column {i % cols + 1}"
        parts.append(f"{noun} {i + 1} ({place}): {table[v][1]}")
    return layout, " ".join(parts)


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
            views = merged_face_views(p.face_views)
            layout, panels = _panels(views, FACE_VIEWS, grid_columns(len(views)), "Portrait")
            prompt = MERGED_FACE_PROMPT.format(n=len(views), layout=layout, panels=panels)
            out.append(_child(p, seed, "faces", "sheet", "Face sheet", prompt, MERGED_FACE_SIZE))
        if p.body_views:
            layout, panels = _panels(p.body_views, BODY_VIEWS, len(p.body_views), "View")
            prompt = MERGED_BODY_PROMPT.format(n=len(p.body_views), layout=layout, panels=panels)
            out.append(_child(p, seed, "body", "sheet", "Body sheet", prompt, MERGED_BODY_SIZE))
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
