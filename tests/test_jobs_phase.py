"""The job manager reports which node class is executing, so the UI can show a VAE-decode phase."""
from __future__ import annotations

import asyncio

from engine import Built
from jobs import JobManager


class FakeHistory:
    def __init__(self):
        self.job = {"id": "j1", "status": "running", "prompt_id": "p1"}

    def by_prompt_id(self, pid):
        return self.job if pid == "p1" else None

    def update(self, *a, **k):
        pass


def manager(prompt):
    m = JobManager(comfy=None, history=FakeHistory())  # type: ignore[arg-type]
    m._built["j1"] = Built(prompt, "t", {}, {}, None, "create")

    async def no_broadcast(_jid):
        pass

    m._broadcast_job = no_broadcast  # type: ignore[method-assign]
    return m


def test_executing_event_records_node_class():
    m = manager({"7": {"class_type": "VAEDecode", "inputs": {}}, "8": {"class_type": "KSampler", "inputs": {}}})
    asyncio.run(m._on_event({"type": "executing", "data": {"prompt_id": "p1", "node": "7"}}))
    assert m.live["j1"]["class"] == "VAEDecode"
    asyncio.run(m._on_event({"type": "executing", "data": {"prompt_id": "p1", "node": "8"}}))
    assert m.live["j1"]["class"] == "KSampler"


def test_unknown_node_or_recovered_job_has_no_class():
    m = manager({})
    asyncio.run(m._on_event({"type": "executing", "data": {"prompt_id": "p1", "node": "99"}}))
    assert m.live["j1"]["class"] is None


def test_complete_waits_for_a_history_entry_that_lags_behind_execution_success(monkeypatch):
    """ComfyUI sends execution_success before it writes the history entry: the job must still end up done."""
    import jobs

    monkeypatch.setattr(jobs, "HISTORY_DELAY", 0)
    calls = {"n": 0}

    class Comfy:
        async def history(self, pid):
            calls["n"] += 1
            if calls["n"] < 3:
                return {}
            return {pid: {"status": {"status_str": "success"}, "outputs": {"200": {"images": [{"filename": "a.png", "subfolder": "s", "type": "output"}]}}}}

    class Hist(FakeHistory):
        def get(self, jid):
            return self.job

        def finish(self, jid, status, **fields):
            self.job.update(status=status, **fields)

    m = JobManager(comfy=Comfy(), history=Hist())  # type: ignore[arg-type]
    m._built["j1"] = Built({}, "t", {}, {"200": "final"}, None, "multiedit")

    async def no_broadcast(_jid):
        pass

    m._broadcast_job = no_broadcast  # type: ignore[method-assign]

    async def both_signals():  # execution_success and "executing: null" arrive back to back
        await asyncio.gather(m._complete("j1"), m._complete("j1"))

    asyncio.run(both_signals())
    assert m.history.job["status"] == "done" and calls["n"] == 3
    assert m.history.job["outputs"] == [{"node": "200", "role": "final", "filename": "a.png", "subfolder": "s", "type": "output"}]


def test_complete_gives_up_with_a_friendly_error_when_history_never_appears(monkeypatch):
    import jobs

    monkeypatch.setattr(jobs, "HISTORY_DELAY", 0)
    monkeypatch.setattr(jobs, "HISTORY_TRIES", 3)

    class Comfy:
        async def history(self, pid):
            return {}

    class Hist(FakeHistory):
        def get(self, jid):
            return self.job

        def finish(self, jid, status, **fields):
            self.job.update(status=status, **fields)

    m = JobManager(comfy=Comfy(), history=Hist())  # type: ignore[arg-type]

    async def no_broadcast(_jid):
        pass

    m._broadcast_job = no_broadcast  # type: ignore[method-assign]
    asyncio.run(m._complete("j1"))
    assert m.history.job["status"] == "error" and "couldn't be read" in m.history.job["error"]


def _late_manager(monkeypatch, comfy_history):
    import jobs

    monkeypatch.setattr(jobs, "HISTORY_DELAY", 0)
    monkeypatch.setattr(jobs, "HISTORY_TRIES", 2)

    class Comfy:
        async def history(self, pid):
            return comfy_history

    class Hist(FakeHistory):
        def get(self, jid):
            return self.job

        def finish(self, jid, status, **fields):
            self.job.update(status=status, **fields)

    m = JobManager(comfy=Comfy(), history=Hist())  # type: ignore[arg-type]
    m._built["j1"] = Built({}, "t", {}, {"200": "final"}, None, "multiedit")

    async def no_broadcast(_jid):
        pass

    m._broadcast_job = no_broadcast  # type: ignore[method-assign]
    return m


def test_missing_history_falls_back_to_the_images_comfyui_announced_while_running(monkeypatch):
    m = _late_manager(monkeypatch, {})
    img = {"filename": "a.png", "subfolder": "AccioStudio", "type": "output"}
    asyncio.run(m._on_event({"type": "executed", "data": {"prompt_id": "p1", "node": "200", "output": {"images": [img]}}}))
    asyncio.run(m._on_event({"type": "executed", "data": {"prompt_id": "p1", "node": "99", "output": {"images": [img]}}}))  # not an output node
    asyncio.run(m._on_event({"type": "execution_success", "data": {"prompt_id": "p1"}}))
    assert m.history.job["status"] == "done"
    assert m.history.job["outputs"] == [{"node": "200", "role": "final", **img}]
    assert "j1" not in m._executed


def test_missing_history_and_nothing_announced_is_still_an_error(monkeypatch):
    m = _late_manager(monkeypatch, {})
    asyncio.run(m._on_event({"type": "execution_success", "data": {"prompt_id": "p1"}}))
    assert m.history.job["status"] == "error"
