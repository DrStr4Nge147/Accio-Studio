"""Tunnel helpers that need no network: Tailscale status parsing and the commands run."""
import subprocess
import types

import tunnels


def test_tailnet_url_needs_a_running_backend_and_a_name():
    url, problem = tunnels.tailnet_url({"BackendState": "Running", "Self": {"DNSName": "pc.tail1234.ts.net."}})
    assert url == "https://pc.tail1234.ts.net" and problem is None
    assert tunnels.tailnet_url({"BackendState": "Stopped"})[0] is None
    assert "sign in" in tunnels.tailnet_url({"BackendState": "NeedsLogin"})[1]
    assert "MagicDNS" in tunnels.tailnet_url({"BackendState": "Running", "Self": {}})[1]


STATUS = '{"BackendState":"Running","Self":{"DNSName":"pc.tail1.ts.net."}}'


def patch(monkeypatch, calls, serve_rc=0, serve_out=""):
    """`tailscale status` is answered by subprocess.run, `tailscale serve` by run_limited."""
    monkeypatch.setattr(tunnels, "find_tailscale", lambda: "ts.exe")
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: types.SimpleNamespace(returncode=0, stdout=STATUS, stderr=""))

    def limited(cmd, timeout):
        calls.append(cmd)
        return serve_rc, serve_out

    monkeypatch.setattr(tunnels, "run_limited", limited)
    monkeypatch.setattr(tunnels.atexit, "register", lambda *a, **k: None)
    tunnels.state.update(mode="local", public_url=None, status="local")


def test_run_tailscale_publishes_only_our_port_over_https(monkeypatch):
    calls = []
    patch(monkeypatch, calls)
    tunnels.run_tailscale(7862)
    assert calls == [["ts.exe", "serve", "--bg", "--https=443", "http://127.0.0.1:7862"]]
    assert tunnels.state["public_url"] == "https://pc.tail1.ts.net" and tunnels.state["status"] == "up"
    assert tunnels.state["mode"] == "tailscale"
    tunnels.state.update(mode="local", public_url=None, status="local")


def test_run_tailscale_reports_failures_without_a_url(monkeypatch, capsys):
    patch(monkeypatch, [], serve_rc=1, serve_out="HTTPS is not enabled for your tailnet")
    tunnels.run_tailscale(7862)
    assert tunnels.state["status"] == "failed" and tunnels.state["public_url"] is None
    assert "HTTPS Certificates" in capsys.readouterr().out
    tunnels.state.update(mode="local", public_url=None, status="local")


def test_run_tailscale_without_the_app_installed(monkeypatch, capsys):
    monkeypatch.setattr(tunnels, "find_tailscale", lambda: None)
    tunnels.run_tailscale(7862)
    assert tunnels.state["status"] == "failed" and "not installed" in capsys.readouterr().out
    tunnels.state.update(mode="local", public_url=None, status="local")


def test_run_tailscale_when_serve_is_not_enabled_on_the_tailnet(monkeypatch, capsys):
    out = "Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=abc"
    patch(monkeypatch, [], serve_rc=None, serve_out=out)  # None: it never finished and was killed
    tunnels.run_tailscale(7862)
    assert tunnels.state["status"] == "failed" and "https://login.tailscale.com/f/serve?node=abc" in capsys.readouterr().out
    tunnels.state.update(mode="local", public_url=None, status="local")


def test_run_limited_kills_a_command_that_never_finishes():
    import sys
    import time

    t = time.time()
    code, out = tunnels.run_limited([sys.executable, "-c", "print('hi', flush=True); import time; time.sleep(30)"], 2)
    assert code is None and out == "hi" and time.time() - t < 10
    assert tunnels.run_limited([sys.executable, "-c", "print('done')"], 10) == (0, "done")

