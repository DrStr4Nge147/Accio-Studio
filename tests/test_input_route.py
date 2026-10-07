"""/api/input serves back our own uploads; names and kinds are validated before anything reaches the backend."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import INPUT_NAME, app

client = TestClient(app, raise_server_exceptions=False)  # no lifespan: bad requests must be refused before any upstream call


@pytest.mark.parametrize("name", ["a1b2.png", "0123456789abcdef0123456789abcdef.jpg", "x_y-z.webp"])
def test_server_generated_names_pass(name):
    assert INPUT_NAME.fullmatch(name)


@pytest.mark.parametrize("name", ["..", ".png", "a/b.png", "a\b.png", "a b.png", "", "x" * 200 + ".png", "%2e%2e"])
def test_other_names_are_rejected(name):
    assert not INPUT_NAME.fullmatch(name)


@pytest.mark.parametrize("path", ["/api/input/media/..%2fsecret.png", "/api/input/mask/a.png", "/api/input/other/a.png", "/api/input/image/a%20b.png"])
def test_bad_requests_are_404(path):
    r = client.get(path)
    assert r.status_code == 404  # either our own refusal or no route at all; never a proxied file
