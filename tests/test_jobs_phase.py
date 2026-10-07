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
