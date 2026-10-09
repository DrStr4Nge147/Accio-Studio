"""/api/update (version + whether a newer release exists) and /api/update/apply (start Update.bat, from this PC only)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import config
import main
import updates

client = TestClient(main.app, raise_server_exceptions=False)
NEWER = {"version": "9.9.9", "zip_name": "AccioStudio-9.9.9.zip", "zip_url": "x", "size": 1, "sha256": "a" * 64, "notes_url": "https://example.invalid/r"}


@pytest.fixture(autouse=True)
def setup(session_token, monkeypatch):
    client.cookies.set("accio_session", session_token)
    monkeypatch.setattr(main.app.state, "settings", config.load_settings(), raising=False)
    monkeypatch.setitem(updates._cache, "at", 0.0)
    monkeypatch.setitem(updates._cache, "latest", None)
    monkeypatch.setitem(updates._cache, "error", None)
    monkeypatch.setattr(updates.updater, "installed_version", lambda root=None: "0.1.0")
    yield
    client.cookies.clear()


def local(monkeypatch, yes: bool) -> None:
    monkeypatch.setattr(main, "local_trusted", lambda app, scope: yes)


def test_reports_a_newer_release(monkeypatch):
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: NEWER)
    local(monkeypatch, True)
    body = client.get("/api/update").json()
    assert body["current"] == "0.1.0" and body["latest"] == "9.9.9" and body["available"] is True
    assert body["can_apply"] is True and body["notes_url"] == "https://example.invalid/r" and body["error"] is None


def test_nothing_to_do_when_up_to_date(monkeypatch):
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: {**NEWER, "version": "0.1.0"})
    local(monkeypatch, True)
    body = client.get("/api/update").json()
    assert body["available"] is False and body["can_apply"] is False


def test_other_devices_see_the_update_but_cannot_start_it(monkeypatch):
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: NEWER)
    local(monkeypatch, False)
    assert client.get("/api/update").json()["available"] is True
    assert client.get("/api/update").json()["can_apply"] is False
    started = []
    monkeypatch.setattr(updates, "start_update", lambda: started.append(1))
    r = client.post("/api/update/apply")
    assert r.status_code == 403 and "PC that runs Accio" in r.json()["error"]["message"] and not started


def test_apply_starts_the_updater_from_this_pc(monkeypatch):
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: NEWER)
    local(monkeypatch, True)
    started = []
    monkeypatch.setattr(updates, "start_update", lambda: started.append(1))
    r = client.post("/api/update/apply")
    assert r.status_code == 202 and r.json() == {"started": True, "latest": "9.9.9"} and started == [1]


def test_apply_refuses_when_there_is_nothing_newer(monkeypatch):
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: {**NEWER, "version": "0.1.0"})
    local(monkeypatch, True)
    monkeypatch.setattr(updates, "start_update", lambda: pytest.fail("must not start"))
    assert client.post("/api/update/apply").status_code == 409


def test_apply_reports_a_missing_updater_plainly(monkeypatch):
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: NEWER)
    local(monkeypatch, True)

    def missing():
        raise FileNotFoundError("Update.bat is missing")

    monkeypatch.setattr(updates, "start_update", missing)
    r = client.post("/api/update/apply")
    assert r.status_code == 500 and "Update.bat yourself" in r.json()["error"]["message"]


def test_a_failed_check_is_a_calm_message_not_an_error_and_is_retried_later(monkeypatch):
    def boom(api_url=None):
        raise OSError("<urlopen error [Errno 11001] getaddrinfo failed> C:\\secret\\path")

    monkeypatch.setattr(updates.updater, "fetch_latest", boom)
    local(monkeypatch, True)
    r = client.get("/api/update")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False and body["error"] == "Could not check for updates right now." and "secret" not in r.text
    assert updates._cache["wait"] == updates.RETRY_AFTER_FAILURE  # not hammered, not forgotten for six hours


def test_the_answer_is_cached_between_page_loads(monkeypatch):
    calls = []
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: calls.append(1) or NEWER)
    local(monkeypatch, True)
    client.get("/api/update")
    client.get("/api/update")
    assert len(calls) == 1
    client.get("/api/update?refresh=true")
    assert len(calls) == 2


def test_switching_the_check_off_never_contacts_github(monkeypatch):
    monkeypatch.setitem(main.app.state.settings, "check_updates", False)
    monkeypatch.setattr(updates.updater, "fetch_latest", lambda api_url=None: pytest.fail("must not contact GitHub"))
    body = client.get("/api/update").json()
    assert body["enabled"] is False and body["available"] is False and body["current"] == "0.1.0"


def test_the_update_endpoints_need_a_login():
    client.cookies.clear()
    assert client.get("/api/update").status_code == 401
    assert client.post("/api/update/apply").status_code == 401


def test_the_updater_is_started_in_its_own_console_with_an_explicit_path(tmp_path, monkeypatch):
    (tmp_path / "Update.bat").write_text("@echo off")
    monkeypatch.setattr(updates, "ROOT", tmp_path)
    seen = {}
    monkeypatch.setattr(updates.subprocess, "Popen", lambda cmd, **kw: seen.update(cmd=cmd, **kw))
    updates.start_update()
    assert seen["cmd"] == ["cmd.exe", "/c", ".\\Update.bat", "--yes"] and seen["cwd"] == tmp_path
    assert seen["creationflags"] & getattr(updates.subprocess, "CREATE_NEW_CONSOLE", 0)  # a visible window the user can read


def test_a_missing_updater_file_is_reported(tmp_path, monkeypatch):
    monkeypatch.setattr(updates, "ROOT", tmp_path)
    with pytest.raises(FileNotFoundError):
        updates.start_update()
