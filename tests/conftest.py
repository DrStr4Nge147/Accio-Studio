import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))


import pytest  # noqa: E402


@pytest.fixture
def session_token(tmp_path, monkeypatch):
    """A signed-in session for tests that call the API without running the app's lifespan (no login screen needed)."""
    import auth
    import config
    import main

    monkeypatch.setattr(config, "SETTINGS_FILE", tmp_path / "settings.json")
    config.save_setting("_auth", auth.hash_password("test password 123"))
    a = auth.Auth(tmp_path / "sessions.json")
    monkeypatch.setattr(main.app.state, "auth", a, raising=False)
    return a.create_session()
