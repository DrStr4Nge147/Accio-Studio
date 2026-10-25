"""Settings > Model folders: validation, the extra_model_paths.yaml block, the LoRA folder junctions, and /api/model-paths."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

import backend
import config
import main
import modelpaths
import modelpathsapi

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "installer"))
import modelfiles  # noqa: E402

client = TestClient(main.app, raise_server_exceptions=False)


def make_models(tmp_path, name="other"):
    folder = tmp_path / name
    folder.mkdir()
    (folder / "a.safetensors").write_bytes(b"x")
    (folder / "sub").mkdir()
    (folder / "sub" / "b.gguf").write_bytes(b"x")
    (folder / "notes.txt").write_text("x")
    return folder


def test_normalize_rejects_unknown_keys_and_drops_blank():
    assert modelpaths.normalize({"krea2": {"vae": ' "D:\\m\\vae" ', "loras": "  "}}) == {"krea2": {"vae": "D:\\m\\vae"}}
    for bad in ({"nope": {"vae": "D:\\x"}}, {"krea2": {"nope": "D:\\x"}}, {"krea2": {"vae": 5}}, [], {"krea2": []}):
        with pytest.raises(modelpaths.ModelPathError):
            modelpaths.normalize(bad)


def test_validate_wants_an_existing_full_path_outside_the_models_folder(tmp_path):
    models = tmp_path / "models"
    (models / "loras").mkdir(parents=True)
    ok = make_models(tmp_path)
    modelpaths.validate({"krea2": {"vae": str(ok)}}, models)
    with pytest.raises(modelpaths.ModelPathError, match="full folder path"):
        modelpaths.validate({"krea2": {"vae": "relative\\dir"}}, models)
    with pytest.raises(modelpaths.ModelPathError, match="not found"):
        modelpaths.validate({"klein": {"vae": str(tmp_path / "nowhere")}}, models)
    with pytest.raises(modelpaths.ModelPathError, match="inside the app's own models"):
        modelpaths.validate({"krea2": {"loras": str(models / "loras")}}, models)


def test_count_models_counts_nested_model_files_only(tmp_path):
    assert modelpaths.count_models(str(make_models(tmp_path))) == 2
    assert modelpaths.count_models(str(tmp_path / "nowhere")) is None


def test_yaml_block_is_valid_dedupes_and_keeps_the_installers_section(tmp_path):
    f = tmp_path / "extra_model_paths.yaml"
    f.write_text("# Written by Accio's installer.\naccio_existing:\n    vae: D:/old/vae/\n", encoding="utf-8")
    shared = str(tmp_path / "enc")
    paths = {"krea2": {"text_encoders": shared, "vae": str(tmp_path / "v")}, "klein": {"text_encoders": shared}}
    modelpaths.write_yaml(f, paths)
    modelpaths.write_yaml(f, paths)  # a second save replaces our block, it does not stack
    text = f.read_text(encoding="utf-8")
    assert text.count(modelpaths.YAML_MARKER) == 1 and "accio_existing" in text
    data = yaml.safe_load(text)
    assert data["accio_existing"] == {"vae": "D:/old/vae/"}
    assert data["accio_user"]["text_encoders"] == (tmp_path / "enc").as_posix()  # once, not twice
    assert data["accio_user"]["vae"] == (tmp_path / "v").as_posix()
    modelpaths.write_yaml(f, {})  # clearing everything leaves the installer's part alone
    assert "accio_user" not in f.read_text(encoding="utf-8") and "accio_existing" in f.read_text(encoding="utf-8")


def test_yaml_file_is_removed_when_nothing_is_left(tmp_path):
    f = tmp_path / "extra_model_paths.yaml"
    modelpaths.write_yaml(f, {"krea2": {"vae": str(tmp_path)}})
    assert f.is_file()
    modelpaths.write_yaml(f, {})
    assert not f.exists()


def test_lora_folders_become_junctions_and_clearing_never_touches_the_files(tmp_path):
    models = tmp_path / "models"
    loras = models / "loras"
    (loras / "krea2").mkdir(parents=True)  # what the installer creates
    other = make_models(tmp_path)
    modelpaths.sync_lora_links(models, {"krea2": {"loras": str(other)}})
    assert (loras / "krea2" / "a.safetensors").is_file() and (loras / "krea2" / "sub" / "b.gguf").is_file()
    assert (loras / "qwen2.1-edit").is_dir() and not (loras / "qwen2.1-edit" / "a.safetensors").exists()
    other2 = make_models(tmp_path, "other2")
    modelpaths.sync_lora_links(models, {"krea2": {"loras": str(other2)}})  # re-pointing swaps the link
    assert os.path.realpath(loras / "krea2") == os.path.realpath(other2)
    modelpaths.sync_lora_links(models, {})
    assert (loras / "krea2").is_dir() and not os.path.islink(loras / "krea2") and not any((loras / "krea2").iterdir())
    assert (other / "a.safetensors").is_file() and (other2 / "sub" / "b.gguf").is_file()  # the user's files are intact


def test_lora_folder_holding_files_is_not_replaced(tmp_path):
    models = tmp_path / "models"
    (models / "loras" / "krea2").mkdir(parents=True)
    mine = models / "loras" / "krea2" / "mine.safetensors"
    mine.write_bytes(b"x")
    with pytest.raises(modelpaths.ModelPathError, match="already holds files"):
        modelpaths.sync_lora_links(models, {"krea2": {"loras": str(make_models(tmp_path))}})
    assert mine.is_file()


def test_browse_lists_folders_only_and_falls_back_to_an_existing_parent(tmp_path):
    root = make_models(tmp_path)  # holds a.safetensors, sub/, notes.txt
    got = modelpaths.browse(str(root))
    assert got["folders"] == ["sub"] and got["path"] == str(root) and got["parent"] == str(tmp_path) and not got["drives"]
    assert modelpaths.browse(str(root / "gone" / "deeper"))["path"] == str(root)  # nearest folder that exists
    drives = modelpaths.browse("")
    assert drives["drives"] and drives["parent"] is None and all(d.endswith(":\\") for d in drives["folders"])
    top = modelpaths.browse(drives["folders"][0])
    assert top["parent"] == ""  # up from a drive root goes back to the drives list


def test_default_folder_is_the_apps_own_one(tmp_path):
    assert modelpaths.default_folder(tmp_path, "krea2", "vae") == str(tmp_path / "ComfyUI" / "models" / "vae")
    assert modelpaths.default_folder(tmp_path, "klein", "loras") == str(tmp_path / "ComfyUI" / "models" / "loras" / "flux-klein9b-edit")


def test_installer_and_server_share_the_lora_folders():
    assert set(modelfiles.LORA_FOLDERS) == {f["lora_dir"] for f in modelpaths.FAMILIES.values()}


# --------------------------------------------------------------------------- API

class FakeComfy:
    async def system_stats(self):
        return {}


@pytest.fixture
def api(session_token, tmp_path, monkeypatch):
    base = tmp_path / "comfy"
    (base / "ComfyUI" / "models" / "loras").mkdir(parents=True)
    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(config, "comfy_dir", lambda s: base)
    monkeypatch.setattr(main.app.state, "settings", config.load_settings(), raising=False)
    monkeypatch.setattr(main.app.state, "cache", {}, raising=False)
    monkeypatch.setattr(main.app.state, "comfy", FakeComfy(), raising=False)
    monkeypatch.setattr(main.app.state, "backend_restart", None, raising=False)
    restarts = []
    monkeypatch.setattr(backend, "restart", lambda settings: restarts.append(1))
    client.cookies.set("accio_session", session_token)
    yield base, restarts
    client.cookies.clear()


def wait_for(state):
    for _ in range(50):
        got = client.get("/api/model-paths").json()["restart"]["state"]
        if got == state:
            return
        time.sleep(0.1)
    raise AssertionError(f"restart never reached {state!r}, last {got!r}")


def test_save_applies_folders_and_restarts_the_backend(api, tmp_path):
    base, restarts = api
    other = make_models(tmp_path)
    r = client.put("/api/model-paths", json={"paths": {"krea2": {"loras": str(other), "vae": str(other)}}})
    assert r.status_code == 202 and r.json()["restart"]["state"] == "restarting"
    wait_for("ready")
    assert restarts == [1]
    assert (base / "ComfyUI" / "models" / "loras" / "krea2" / "a.safetensors").is_file()
    assert "accio_user" in (base / "ComfyUI" / "extra_model_paths.yaml").read_text(encoding="utf-8")
    body = client.get("/api/model-paths").json()
    krea = next(f for f in body["families"] if f["id"] == "krea2")
    assert {f["kind"]: (f["path"], f["found"]) for f in krea["fields"]}["loras"] == (str(other), 2)
    assert config.load_settings()["model_paths"]["krea2"]["vae"] == str(other)


def test_bad_folder_is_refused_and_nothing_changes(api, tmp_path):
    base, restarts = api
    r = client.put("/api/model-paths", json={"paths": {"klein": {"vae": str(tmp_path / "nowhere")}}})
    assert r.status_code == 400 and "Flux Klein 9B" in r.json()["error"]["message"] and "VAE" in r.json()["error"]["message"]
    assert not restarts and "model_paths" not in config.load_settings() or not config.load_settings()["model_paths"]
    assert not (base / "ComfyUI" / "extra_model_paths.yaml").exists()


def test_changing_the_folders_needs_a_login(api, tmp_path):
    client.cookies.clear()
    assert client.get("/api/model-paths").status_code == 401
    r = client.put("/api/model-paths", json={"paths": {"krea2": {"vae": str(make_models(tmp_path))}}})
    assert r.status_code == 401


def test_api_offers_defaults_and_a_folder_browser(api, tmp_path):
    base, _ = api
    body = client.get("/api/model-paths").json()
    vae = next(x for x in body["families"][0]["fields"] if x["kind"] == "vae")
    assert vae["default"] == str(base / "ComfyUI" / "models" / "vae")
    root = make_models(tmp_path)
    got = client.get("/api/model-paths/browse", params={"path": str(root)}).json()
    assert got["folders"] == ["sub"] and got["drives"] is False
    client.cookies.clear()
    assert client.get("/api/model-paths/browse", params={"path": str(root)}).status_code == 401


def fake_dialog(monkeypatch, stdout):
    seen = {}

    def run(args, **kw):
        seen.update(env=kw["env"], args=args)
        return type("Done", (), {"stdout": stdout})()

    monkeypatch.setattr(modelpaths.subprocess, "run", run)
    return seen


def test_pick_folder_returns_the_chosen_existing_folder(monkeypatch, tmp_path):
    seen = fake_dialog(monkeypatch, str(tmp_path) + chr(13) + chr(10))
    assert modelpaths.pick_folder("D:" + chr(92) + "Start") == str(tmp_path)
    assert "-STA" in seen["args"] and seen["env"]["ACCIO_START"] == "D:" + chr(92) + "Start"  # the start folder travels in the environment, never in the script
    fake_dialog(monkeypatch, "")  # cancelled
    assert modelpaths.pick_folder() is None
    fake_dialog(monkeypatch, str(tmp_path / "nowhere"))  # never trust what came back
    assert modelpaths.pick_folder() is None


def test_native_dialog_script_brings_itself_to_the_front():
    # Windows keeps a background process from taking focus: without these steps the dialog opens behind the browser.
    for part in ("$owner.Show()", "SetForegroundWindow", "keybd_event", "ShowDialog($owner)"):
        assert part in modelpaths.PICK_SCRIPT


def test_native_dialog_is_for_the_pc_itself(api, monkeypatch, tmp_path):
    monkeypatch.setattr(modelpathsapi, "on_this_pc", lambda request: False)
    assert client.get("/api/model-paths").json()["can_pick"] is False
    r = client.post("/api/model-paths/pick", json={"start": ""})
    assert r.status_code == 403 and "PC that runs Accio" in r.json()["error"]["message"]
    monkeypatch.setattr(modelpathsapi, "on_this_pc", lambda request: True)
    assert client.get("/api/model-paths").json()["can_pick"] is True
    monkeypatch.setattr(modelpaths, "pick_folder", lambda start="": str(tmp_path))
    assert client.post("/api/model-paths/pick", json={"start": "C:" + chr(92)}).json() == {"path": str(tmp_path)}


def test_native_dialog_is_offered_to_the_pcs_own_browser_in_every_tunnel_mode():
    from starlette.requests import Request

    def req(host, peer="127.0.0.1", extra=()):
        headers = [(b"host", host.encode()), *extra]
        return Request({"type": "http", "headers": headers, "client": (peer, 5000), "method": "GET", "path": "/", "query_string": b""})

    assert modelpathsapi.on_this_pc(req("127.0.0.1:7862")) and modelpathsapi.on_this_pc(req("localhost:7862"))
    assert not modelpathsapi.on_this_pc(req("desktop.tail1.ts.net"))  # came through a tunnel (rewritten Host)
    assert not modelpathsapi.on_this_pc(req("127.0.0.1:7862", extra=[(b"x-forwarded-for", b"100.1.2.3")]))  # proxied
    assert not modelpathsapi.on_this_pc(req("192.168.1.5:7862", peer="192.168.1.9"))  # another device on the network


def test_external_backend_cannot_be_configured(api, monkeypatch, tmp_path):
    monkeypatch.setitem(main.app.state.settings, "external_comfy_url", "http://example.invalid:1")
    assert client.get("/api/model-paths").json()["available"] is False
    r = client.put("/api/model-paths", json={"paths": {}})
    assert r.status_code == 400 and "external backend" in r.json()["error"]["message"]


def test_failed_restart_is_reported(api, monkeypatch, tmp_path):
    def boom(settings):
        raise backend.BackendError("The backend did not stop.")

    monkeypatch.setattr(backend, "restart", boom)
    assert client.put("/api/model-paths", json={"paths": {"krea2": {"vae": str(make_models(tmp_path))}}}).status_code == 202
    wait_for("failed")
    assert client.get("/api/model-paths").json()["restart"]["message"] == "The backend did not stop."
