"""installer/connect_setup.py: parsing and decision logic with fixtures (no network, no real tailscale or zrok)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "installer"))

import connect_setup as cs  # noqa: E402


def test_clean_token_strips_command_prefix_quotes_and_space():
    assert cs.clean_token("  zrok enable AbC123xyz  ") == "AbC123xyz"
    assert cs.clean_token("zrok2 enable AbC123xyz") == "AbC123xyz"
    assert cs.clean_token('"AbC123xyz"') == "AbC123xyz"
    assert cs.clean_token("   ") == ""
    assert cs.valid_token("AbC123xyz") and not cs.valid_token("") and not cs.valid_token("a b c d")


def test_valid_name_letters_digits_4_to_32():
    assert cs.valid_name("myaccio") and cs.valid_name("A1b2") and cs.valid_name("a" * 32)
    assert not cs.valid_name("abc") and not cs.valid_name("a" * 33)
    assert not cs.valid_name("my-accio") and not cs.valid_name("my accio") and not cs.valid_name("")


def test_zrok_version_decisions():
    assert cs.version_tuple("v2.0.8 [7d46bbfd]") == (2, 0, 8)
    assert cs.version_tuple("v0.4.49") == (0, 4, 49) and cs.version_tuple("nothing") is None
    assert cs.pick_zrok_version("v2.1.0") == "2.1.0"
    assert cs.pick_zrok_version("v3.0.0") == cs.ZROK_PINNED  # an unknown major is not installed blindly
    assert cs.pick_zrok_version(None) == cs.ZROK_PINNED
    assert cs.zrok_is_current("v2.0.8 [x]", "2.0.8") and cs.zrok_is_current("v2.1.0", "2.0.8")
    assert not cs.zrok_is_current("v1.1.11 [x]", "2.0.8") and not cs.zrok_is_current("v2.0.7", "2.0.8")
    assert not cs.zrok_is_current("", "2.0.8")


def test_parse_checksums():
    h = "a" * 64
    assert cs.parse_checksums(f"{h}  zrok_2.0.8_windows_amd64.tar.gz\n{h} *./other.tgz\njunk") == {
        "zrok_2.0.8_windows_amd64.tar.gz": h, "other.tgz": h}


NAMES = json.dumps([
    {"name": "myaccio", "namespaceToken": "public", "url": "https://myaccio.shares.zrok.io", "reserved": True},
    {"name": "other", "namespaceToken": "custom", "url": "https://other.example"},
])


def test_zrok_name_lookup_and_url():
    rows = cs.zrok_names(NAMES)
    row = cs.find_zrok_name(rows, "MyAccio")
    assert row and cs.zrok_url(row, "myaccio") == "https://myaccio.shares.zrok.io"
    assert cs.find_zrok_name(rows, "other") is None  # a name in another namespace is not ours
    assert cs.find_zrok_name(rows, "nope") is None
    assert cs.zrok_url(None, "MyName") == "https://myname.shares.zrok.io"
    assert cs.zrok_url({"url": "x.zrok.io/"}, "x") == "https://x.zrok.io"
    assert cs.zrok_names("not json") == [] and cs.zrok_names('{"names":[{"name":"a"}]}') == [{"name": "a"}]
    assert cs.zrok_names('{"x":1}') == [] and cs.zrok_names("null") == []


def test_create_name_failure_messages():
    assert "taken" in cs.classify_create_name_failure("[ERROR] name already exists (409)")
    assert "not allowed" in cs.classify_create_name_failure("invalid name")
    assert "not linked" in cs.classify_create_name_failure("unauthorized 401")
    assert "boom" in cs.classify_create_name_failure("line1\nboom")
    assert "no answer" in cs.classify_create_name_failure("")


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
