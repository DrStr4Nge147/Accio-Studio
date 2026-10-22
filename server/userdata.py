"""/api/userdata: the user's own saved text (prompt templates, LoRA trigger words), kept on the server so every device sees the same lists.

One small JSON file in the data folder. The login guards the route like every other API route; the client always sends the whole
document, so the last save wins.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints

import config

log = logging.getLogger("accio")
router = APIRouter(prefix="/api/userdata")
LOCK = threading.Lock()

Name = Annotated[str, StringConstraints(min_length=1, max_length=60)]
Text = Annotated[str, StringConstraints(min_length=1, max_length=8000)]
Word = Annotated[str, StringConstraints(min_length=1, max_length=120)]
LoraName = Annotated[str, StringConstraints(min_length=1, max_length=300)]


class Template(BaseModel):
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    name: Name
    text: Text
    target: Literal["create", "edit"]


class UserData(BaseModel):
    templates: list[Template] = Field(default_factory=list, max_length=500)
    trigger_words: dict[LoraName, Annotated[list[Word], Field(max_length=100)]] = Field(default_factory=dict, max_length=300)


def data_file() -> Path:
    return config.DATA_DIR / "userdata.json"


def load() -> dict:
    """The saved document, or an empty one when there is none yet or the file is unreadable (the client's own copy then refills it)."""
    try:
        raw = json.loads(data_file().read_text(encoding="utf-8"))
        doc = UserData.model_validate(raw.get("data", {}))
        return {"data": doc.model_dump(), "updated": raw.get("updated")}
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        log.warning("userdata.json could not be read; starting from an empty list")
    return {"data": UserData().model_dump(), "updated": None}


def save(doc: UserData) -> dict:
    """Atomic replace, so a crash mid-write never leaves half a file."""
    out = {"data": doc.model_dump(), "updated": time.time()}
    path = data_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return out


@router.get("")
async def read():
    with LOCK:
        return load()


@router.put("")
async def write(body: UserData):
    with LOCK:
        return save(body)
