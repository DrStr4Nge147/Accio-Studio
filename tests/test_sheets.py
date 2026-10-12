"""Character sheets: view planning, prompts, stitching, and the group lifecycle (with a stubbed job manager)."""
import asyncio
import io
import time
import types

import pytest
from PIL import Image
from pydantic import ValidationError

import engine
import sheets
from history import History
from schemas import CharSheetParams, JobRequest


def params(**kw) -> CharSheetParams:
    base = {"mode": "charsheet", "image": {"file": "photo.png", "name": "me.jpg"}}
    return JobRequest.model_validate({"params": {**base, **kw}}).params


def png(w=64, h=48, color=(200, 100, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


# ----------------------------------------------------------------------------- schema / plan


def test_defaults_are_five_faces_and_six_body_views():
    p = params()
    assert len(p.face_views) == 5 and len(p.body_views) == 6 and p.delivery == "separate"


@pytest.mark.parametrize(
    "bad",
    [
        dict(face_views=[], body_views=[]),
        dict(face_views=["front", "front"]),
        dict(face_views=["sideways"]),
        dict(delivery="stacked"),
        dict(notes="x" * 1001),
    ],
)
def test_schema_rejects(bad):
    with pytest.raises(ValidationError):
        params(**bad)


def test_separate_plan_one_job_per_view_same_seed_and_sizes():
    kids = sheets.plan(params(), 7)
    assert [c.group for c in kids] == ["faces"] * 5 + ["body"] * 6
    assert {c.params.seed for c in kids} == {7}
    assert {(c.params.manual_width, c.params.manual_height) for c in kids if c.group == "faces"} == {sheets.FACE_SIZE}
    assert {(c.params.manual_width, c.params.manual_height) for c in kids if c.group == "body"} == {sheets.BODY_SIZE}
    assert all(c.params.manual_size and not c.params.pixel_drift_fix and not c.params.prompt_enhancer for c in kids)
    assert len({c.params.prompt for c in kids}) == len(kids)  # every view has its own wording


def test_merged_plan_is_two_sheet_jobs():
    kids = sheets.plan(params(delivery="merged", face_views=["front", "back"]), 1)
    assert [(c.group, c.key) for c in kids] == [("faces", "sheet"), ("body", "sheet")]
    assert "2 head-and-shoulders" in kids[0].params.prompt and "front, back" in kids[0].params.prompt
    assert (kids[0].params.manual_width, kids[0].params.manual_height) == sheets.MERGED_FACE_SIZE


def test_plan_skips_an_empty_group_and_adds_notes():
    kids = sheets.plan(params(face_views=[], body_views=["front"], notes="red scarf"), 1)
    assert [c.group for c in kids] == ["body"] and kids[0].params.prompt.endswith("More about the character: red scarf")


def test_every_child_builds_into_a_graph():
    for c in sheets.plan(params(), 3):
        b = engine.build(c.params, engine.Catalog())
        assert b.mode == "multiedit" and b.seeds["main"] == 3


# ----------------------------------------------------------------------------- stitching


@pytest.mark.parametrize("n,cols", [(1, 1), (2, 2), (3, 3), (4, 2), (5, 3), (6, 3)])
def test_grid_columns(n, cols):
    assert sheets.grid_columns(n) == cols


def test_stitch_wraps_and_never_scales_views():
    views = [(f"v{i}", Image.new("RGB", (100, 80), (i * 30, 0, 0))) for i in range(5)]
    sheet = sheets.stitch(views)
    cap = max(36, round(100 * 0.04))
    assert sheet.width == sheets.PAD + 3 * (100 + sheets.PAD)
    assert sheet.height == sheets.PAD + 2 * (80 + cap + sheets.PAD)
    # first view pasted 1:1 at its cell
    assert sheet.getpixel((sheets.PAD + 5, sheets.PAD + 5)) == (0, 0, 0)
    assert sheet.getpixel((sheets.PAD + 100 + sheets.PAD + 5, sheets.PAD + 5)) == (30, 0, 0)


# ----------------------------------------------------------------------------- lifecycle (stubbed jobs + backend)


class StubJobs:
    """Stands in for JobManager: submit() records a child row; tests settle the children by hand."""

    def __init__(self, history):
        self.history = history
        self.live = {}
        self.cancelled = []
        self.n = 0
        self.fail_at = None

    async def submit(self, built, p, parent=None):
        if self.fail_at is not None and self.n == self.fail_at:
            raise RuntimeError("queue full")
        self.n += 1
        jid = f"{self.n:032x}"
        self.history.create(
            {"id": jid, "created_at": time.time() + self.n * 1e-3, "mode": built.mode, "label": "x", "template": built.template,
             "status": "queued", "params": p, "seeds": built.seeds, "prompt_id": f"p{self.n}", "parent": parent}
        )
        return {"id": jid}

    async def cancel(self, jid):
        self.cancelled.append(jid)
        self.history.finish(jid, "cancelled")

    async def _broadcast_job(self, jid):
        pass

    def public(self, jid):
        return self.history.get(jid)


class StubComfy:
    def view_stream(self, filename, subfolder, type_):
        return (filename, subfolder, type_)

    async def send(self, req):
        return types.SimpleNamespace(status_code=200, content=png())


@pytest.fixture
def env(tmp_path):
    h = History(tmp_path / "h.db")
    jobs = StubJobs(h)
    out = tmp_path / "out"
    out.mkdir()
    mgr = sheets.SheetManager(jobs, h, StubComfy(), out)
    return types.SimpleNamespace(h=h, jobs=jobs, mgr=mgr, out=out)


def settle(env, pid, statuses=None):
    for i, k in enumerate(env.h.children(pid)):
        st = (statuses or {}).get(i, "done")
        if st == "done":
            env.h.finish(k["id"], "done", outputs=[{"node": "45", "role": "final", "filename": f"v{i}.png", "subfolder": "AccioStudio", "type": "output"}])
        else:
            env.h.finish(k["id"], st, error="boom" if st == "error" else None)


async def run_sheet(env, p, statuses=None):
    job = await env.mgr.create(p, engine.Catalog(), "AccioStudio")
    pid = job["id"]
    settle(env, pid, statuses)
    await asyncio.wait_for(env.mgr._tasks[pid], 10)
    return env.h.get(pid)


def test_separate_sheet_stitches_two_files_and_lists_parts(env, monkeypatch):
    monkeypatch.setattr(sheets, "POLL_SECONDS", 0.01)
    row = asyncio.run(run_sheet(env, params()))
    assert row["status"] == "done" and row["parent"] is None
    roles = [o["role"] for o in row["outputs"]]
    assert roles == ["final", "final"] + ["part"] * 11
    names = [o["filename"] for o in row["outputs"][:2]]
    assert names[0].endswith("_faces.png") and names[1].endswith("_body.png")
    for n in names:
        assert (env.out / "AccioStudio" / n).is_file()
    assert [k["parent"] for k in env.h.children(row["id"])] == [row["id"]] * 11
    assert env.h.list(10) == [env.h.get(row["id"])] or [j["id"] for j in env.h.list(10)] == [row["id"]]  # children hidden from the gallery


def test_merged_sheet_outputs_are_the_two_renders(env, monkeypatch):
    monkeypatch.setattr(sheets, "POLL_SECONDS", 0.01)
    row = asyncio.run(run_sheet(env, params(delivery="merged")))
    assert row["status"] == "done" and [o["role"] for o in row["outputs"]] == ["final", "final"]
    assert not list((env.out / "AccioStudio").glob("*")) if (env.out / "AccioStudio").exists() else True  # nothing stitched


def test_failed_view_is_reported_but_sheet_still_made(env, monkeypatch):
    monkeypatch.setattr(sheets, "POLL_SECONDS", 0.01)
    row = asyncio.run(run_sheet(env, params(face_views=["front", "back"], body_views=["front"]), {1: "error"}))
    assert row["status"] == "done" and "1 of 3 views failed" in row["warnings"][0]
    assert len([o for o in row["outputs"] if o["role"] == "part"]) == 2


def test_all_views_failing_is_an_error(env, monkeypatch):
    monkeypatch.setattr(sheets, "POLL_SECONDS", 0.01)
    row = asyncio.run(run_sheet(env, params(face_views=["front"], body_views=[]), {0: "error"}))
    assert row["status"] == "error" and row["error"] == "boom"


def test_external_backend_keeps_views_as_plain_images(env, monkeypatch):
    monkeypatch.setattr(sheets, "POLL_SECONDS", 0.01)
    env.mgr.out_dir = None
    row = asyncio.run(run_sheet(env, params(face_views=["front", "back"], body_views=[])))
    assert [o["role"] for o in row["outputs"]] == ["final", "final"] and "could not be stitched" in row["warnings"][0]


def test_cancel_stops_children_and_marks_sheet_cancelled(env, monkeypatch):
    monkeypatch.setattr(sheets, "POLL_SECONDS", 0.01)

    async def go():
        job = await env.mgr.create(params(face_views=["front", "back"], body_views=[]), engine.Catalog(), "AccioStudio")
        await env.mgr.cancel(job["id"])
        await asyncio.wait_for(env.mgr._tasks[job["id"]], 10)
        return env.h.get(job["id"])

    row = asyncio.run(go())
    assert row["status"] == "cancelled" and len(env.jobs.cancelled) == 2


def test_failure_while_queueing_cancels_what_was_queued(env):
    env.jobs.fail_at = 2

    async def go():
        with pytest.raises(RuntimeError):
            await env.mgr.create(params(), engine.Catalog(), "AccioStudio")

    asyncio.run(go())
    assert len(env.jobs.cancelled) == 2
    assert [j["status"] for j in env.h.active()] == []


def test_history_migrates_a_database_without_the_parent_column(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    db = sqlite3.connect(path)
    db.executescript(
        "CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at REAL NOT NULL, finished_at REAL, mode TEXT NOT NULL, label TEXT NOT NULL,"
        " template TEXT NOT NULL, status TEXT NOT NULL, params TEXT NOT NULL, seeds TEXT NOT NULL, prompt_id TEXT,"
        " outputs TEXT NOT NULL DEFAULT '[]', prompt_used TEXT, error TEXT, warnings TEXT NOT NULL DEFAULT '[]');"
        "INSERT INTO jobs (id, created_at, mode, label, template, status, params, seeds) VALUES ('a', 1, 'create', 'x', 't', 'done', '{}', '{}');"
    )
    db.commit()
    db.close()
    h = History(path)
    assert [j["id"] for j in h.list(10)] == ["a"] and h.get("a")["parent"] is None


def test_custom_sizes_apply_per_group_and_default_otherwise():
    kids = sheets.plan(params(face_size=[2048, 2048], face_views=["front"], body_views=["front"]), 1)
    assert [(c.params.manual_width, c.params.manual_height, c.params.size_hint) for c in kids] == [
        (2048, 2048, [2048, 2048]),
        (768, 1344, [768, 1344]),
    ]
    merged = sheets.plan(params(delivery="merged", body_size=[2048, 1024]), 1)
    assert [(c.params.manual_width, c.params.manual_height) for c in merged] == [sheets.MERGED_FACE_SIZE, (2048, 1024)]


@pytest.mark.parametrize("bad", [[1020, 1024], [32, 1024], [1024], [1024, 1024, 8], [9000, 1024]])
def test_schema_rejects_bad_sizes(bad):
    with pytest.raises(ValidationError):
        params(face_size=bad)


def test_every_prompt_resets_the_photos_pose():
    for delivery in ("separate", "merged"):
        for c in sheets.plan(params(delivery=delivery), 1):
            assert "Ignore the pose of the input photo" in c.params.prompt and "upright" in c.params.prompt
