"""Thumbnails, gallery paging/filters, history deletion."""
import asyncio
import io
import types

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import config
import main
import thumbs
from history import History


def png_bytes(w=800, h=400, color=(200, 120, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


def job(i, mode="create", status="done"):
    return {
        "id": f"{i:032x}", "created_at": 1000.0 + i, "mode": mode, "label": "x", "template": "t",
        "status": status, "params": {}, "seeds": {}, "prompt_id": f"p{i}",
    }


# ----------------------------------------------------------------------------- history


@pytest.fixture
def hist(tmp_path):
    h = History(tmp_path / "h.db")
    h.create(job(1, "create"))
    h.create(job(2, "multiedit"))
    h.create(job(3, "inpaint", "queued"))
    h.create(job(4, "create"))
    for i in (1, 2, 4):
        h.finish(job(i)["id"], "done")
    return h


def test_history_filters(hist):
    assert [j["created_at"] for j in hist.list(10, status="done")] == [1004.0, 1002.0, 1001.0]
    assert [j["mode"] for j in hist.list(10, status="done", group="edit")] == ["multiedit"]
    assert len(hist.list(10, status="done", group="create")) == 2
    assert [j["created_at"] for j in hist.list(10, before=1004.0, status="done")] == [1002.0, 1001.0]
    assert len(hist.list(2)) == 2


def test_history_delete_only_finished(hist):
    assert hist.delete(job(1)["id"]) is True
    assert hist.get(job(1)["id"]) is None
    assert hist.delete(job(3)["id"]) is False  # still queued
    assert hist.delete("nope") is False


# ----------------------------------------------------------------------------- thumbnails


def test_make_webp_downscales_and_never_enlarges():
    big = Image.open(io.BytesIO(thumbs.make_webp(png_bytes(2000, 1000), 384)))
    assert big.format == "WEBP" and big.size == (384, 192)
    small = Image.open(io.BytesIO(thumbs.make_webp(png_bytes(100, 50), 384)))
    assert small.size == (100, 50)


def test_get_or_create_caches(tmp_path):
    calls = []

    async def fetch():
        calls.append(1)
        return png_bytes()

    async def twice():
        a = await thumbs.get_or_create(tmp_path, "abc", 0, 384, fetch)
        return a, await thumbs.get_or_create(tmp_path, "abc", 0, 384, fetch)

    a, b = asyncio.run(twice())
    assert a == b and a.is_file() and len(calls) == 1
    thumbs.remove_for_job(tmp_path, "abc")
    assert not a.exists()


def test_get_or_create_survives_broken_source(tmp_path):
    async def garbage():
        return b"not an image"

    async def missing():
        return None

    async def run():
        return await thumbs.get_or_create(tmp_path, "abc", 0, 384, garbage), await thumbs.get_or_create(tmp_path, "abc", 0, 384, missing)

    assert asyncio.run(run()) == (None, None)


# ----------------------------------------------------------------------------- routes


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "THUMBS_DIR", tmp_path / "thumbs")
    monkeypatch.setattr(main, "comfy_dir", lambda settings: tmp_path / "comfy")  # never touch the real output folder
    (tmp_path / "comfy" / "ComfyUI" / "output" / "AccioStudio").mkdir(parents=True)
    with TestClient(main.app) as c:
        code = c.app.state.auth.setup_code
        assert c.post("/api/auth/setup", json={"password": "correct horse battery", "code": code}).status_code == 200
        yield c


def seed_job(client, i=1, mode="create"):
    j = job(i, mode)
    client.app.state.history.create(j)
    client.app.state.history.finish(
        j["id"], "done", outputs=[{"node": "12", "role": "final", "filename": "a.png", "subfolder": "AccioStudio", "type": "output"}]
    )
    return j["id"]


def test_thumbnail_route(client, tmp_path):
    jid = seed_job(client)
    calls = []

    async def fake_send(request, stream=False):
        calls.append(1)
        return types.SimpleNamespace(status_code=200, content=png_bytes(1600, 900))

    client.app.state.comfy.send = fake_send
    r = client.get(f"/api/jobs/{jid}/image/0?size=384")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert "immutable" in r.headers["cache-control"]
    assert Image.open(io.BytesIO(r.content)).size == (384, 216)
    client.get(f"/api/jobs/{jid}/image/0?size=384")
    assert len(calls) == 1  # second request came from the disk cache
    assert client.get(f"/api/jobs/{jid}/image/0?size=999").status_code == 422
    assert client.get(f"/api/jobs/{jid}/image/5?size=384").status_code == 404


def test_gallery_listing_and_delete(client, tmp_path):
    a, b, c = seed_job(client, 1), seed_job(client, 2, "inpaint"), seed_job(client, 3)
    ids = lambda q: [j["id"] for j in client.get(f"/api/jobs?status=done&{q}").json()["jobs"]]
    assert ids("limit=10") == [c, b, a]
    assert ids("group=edit") == [b]
    assert ids("limit=1&before=1003") == [b]
    assert client.get("/api/jobs?status=bogus").status_code == 422
    assert client.get("/api/jobs?group=bogus").status_code == 422
    (tmp_path / "thumbs").mkdir()
    (tmp_path / "thumbs" / f"{b}_0_384.webp").write_bytes(b"x")
    assert client.delete(f"/api/jobs/{b}").status_code == 200
    assert not (tmp_path / "thumbs" / f"{b}_0_384.webp").exists()
    assert ids("limit=10") == [c, a]
    assert client.delete(f"/api/jobs/{b}").status_code == 404


def test_delete_needs_login(client):
    jid = seed_job(client)
    client.post("/api/auth/logout")
    assert client.delete(f"/api/jobs/{jid}").status_code == 401


def test_delete_removes_the_image_files_too(client, tmp_path):
    out = tmp_path / "comfy" / "ComfyUI" / "output" / "AccioStudio"
    (out / "a.png").write_bytes(b"x")
    jid = seed_job(client)
    assert client.get("/api/health").json()["can_delete_files"] is True
    r = client.delete(f"/api/jobs/{jid}")
    assert r.json() == {"ok": True, "files_deleted": 1, "files_kept": 0}
    assert not (out / "a.png").exists()


def test_files_are_kept_for_an_external_backend(client, tmp_path):
    out = tmp_path / "comfy" / "ComfyUI" / "output" / "AccioStudio"
    (out / "a.png").write_bytes(b"x")
    jid = seed_job(client)
    client.app.state.settings = {**client.app.state.settings, "external_comfy_url": "http://elsewhere:8188"}
    try:
        assert client.get("/api/health").json()["can_delete_files"] is False
        assert client.delete(f"/api/jobs/{jid}").json() == {"ok": True, "files_deleted": 0, "files_kept": 1}
        assert (out / "a.png").exists()
    finally:
        client.app.state.settings = {**client.app.state.settings, "external_comfy_url": ""}


def test_delete_files_never_leaves_the_output_folder(tmp_path):
    import outputs

    root = tmp_path / "output"
    (root / "sub").mkdir(parents=True)
    (root / "sub" / "ok.png").write_bytes(b"x")
    secret = tmp_path / "secret.txt"
    secret.write_text("keep me")
    entries = [
        {"filename": "ok.png", "subfolder": "sub", "type": "output"},
        {"filename": "secret.txt", "subfolder": "..", "type": "output"},
        {"filename": r"..\..\secret.txt", "subfolder": "", "type": "output"},
        {"filename": "ok.png", "subfolder": "sub", "type": "temp"},
        {"filename": "gone.png", "subfolder": "sub", "type": "output"},  # already missing: fine
    ]
    deleted, failed = outputs.delete_files(root, entries)
    assert secret.read_text() == "keep me" and not (root / "sub" / "ok.png").exists()
    assert (deleted, failed) == (2, 3)
