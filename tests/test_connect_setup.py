"""installer/connect_setup.py (Tailscale setup): parsing and decision logic with fixtures (no network, no real tailscale)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "installer"))

import connect_setup as cs  # noqa: E402


def test_tailscale_login_state_and_dns():
    run = {"BackendState": "Running", "Self": {"DNSName": "pc.tail1.ts.net."}}
    assert cs.tailscale_login_state(run)[0] == "ok" and cs.tailscale_dns_name(run) == "pc.tail1.ts.net"
    assert cs.tailscale_login_state({"BackendState": "NeedsLogin"})[0] == "login"
    assert cs.tailscale_login_state({})[0] == "login"
    assert cs.tailscale_login_state({"BackendState": "Stopped"})[0] == "stopped"
    assert cs.tailscale_dns_name({"BackendState": "Running", "Self": {}}) == ""
    assert cs.tailscale_dns_name({}) == ""


def test_classify_serve_output():
    link = "https://login.tailscale.com/f/serve?node=n123"
    assert cs.classify_serve_output(0, "Available within your tailnet") == ("ok", None)
    assert cs.classify_serve_output(None, f"\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         {link}\n") == ("serve_disabled", link)
    assert cs.classify_serve_output(1, "HTTPS is not enabled for your tailnet") == ("https_off", None)
    assert cs.classify_serve_output(1, "cert provisioning disabled") == ("https_off", None)
    assert cs.classify_serve_output(None, "") == ("serve_disabled", None)
    assert cs.classify_serve_output(1, "something odd") == ("other", None)


def test_serve_443_target_reads_status_json():
    status = json.dumps({"TCP": {"443": {"HTTPS": True}}, "Web": {"pc.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:7862"}}}}})
    assert cs.serve_443_target(status) == "http://127.0.0.1:7862"
    assert cs.serve_443_target("{}") is None and cs.serve_443_target("") is None and cs.serve_443_target("junk") is None
    other = json.dumps({"Web": {"pc.ts.net:8443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:1"}}}}})
    assert cs.serve_443_target(other) is None


def test_poll_returns_when_check_passes_and_times_out_without_a_console(monkeypatch):
    calls = iter([None, None, "yes"])
    assert cs.poll(lambda: next(calls), "x", timeout=5, interval=0) == "yes"
    monkeypatch.setattr("builtins.input", lambda *_: (_ for _ in ()).throw(EOFError()))
    assert cs.poll(lambda: None, "x", timeout=0.05, interval=0.01) is None


def test_poll_retries_on_enter_after_timeout(monkeypatch):
    state = {"n": 0, "enters": 0}

    def check():
        state["n"] += 1
        return "ok" if state["enters"] else None

    def fake_input(*_):
        state["enters"] += 1
        return ""

    monkeypatch.setattr("builtins.input", fake_input)
    assert cs.poll(check, "x", timeout=0.02, interval=0.005) == "ok" and state["enters"] == 1


def test_links_are_https():
    assert all(v.startswith("https://") for v in cs.LINKS.values())


def test_guide_page_serves_status_and_refuses_other_hosts():
    import http.client

    from setup_page import GuidePage

    page = GuidePage(["a", "b"])
    page.start()
    host, port = page.url.split("//")[1].rstrip("/").split(":")

    def get(path, host_header=None):
        c = http.client.HTTPConnection(host, int(port), timeout=5)
        c.request("GET", path, headers={"Host": host_header or f"127.0.0.1:{port}"})
        r = c.getresponse()
        return r.status, r.read()

    try:
        page.update(status=["done", "wait"], hint={"title": "T", "text": "x", "link": "https://example.com", "button": "Go"})
        status, body = get("/status")
        data = json.loads(body)
        assert status == 200 and data["status"] == ["done", "wait"] and data["hint"]["title"] == "T" and data["done"] is False
        status, body = get("/")
        assert status == 200 and b"closes in" in body
        assert get("/nope")[0] == 404
        assert get("/status", host_header="evil.example")[0] == 403  # a rebinding page cannot read it
    finally:
        page.stop()


def test_checklist_updates_page_and_clears_hint_when_a_step_changes(capsys):
    from setup_page import GuidePage

    page = GuidePage(["a", "b"])
    cl = cs.Checklist("t", ["a", "b"], page)
    cl.set(0, "wait")
    cl.hint("Do it", "line one\nline two", None)
    assert json.loads(page.snapshot())["hint"]["title"] == "Do it"
    cl.set(0, "done")
    state = json.loads(page.snapshot())
    assert state["hint"] is None and state["status"] == ["done", "todo"]
    assert "line two" in capsys.readouterr().out
