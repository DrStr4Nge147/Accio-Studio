"""data/uploads is the single store of uploaded source images (ComfyUI's input folder points at it)."""
from __future__ import annotations

import backend
import uploads


def put(root, folder, name, data=b"x"):
    (root / folder).mkdir(parents=True, exist_ok=True)
    (root / folder / name).write_bytes(data)


def test_list_skips_masks_and_shows_a_linked_image_once(tmp_path):
    put(tmp_path, "accio", "a1.png")
    put(tmp_path, "accio", "mask-b2.png")
    put(tmp_path, "minimax_h3", "c3.webp")
    put(tmp_path, "accio", "notes.txt")
    assert uploads.ensure_in_kind("a1.png", "media", tmp_path)  # now in both subfolders
    names = sorted(u["file"] for u in uploads.list_uploads(tmp_path))
    assert names == ["a1.png", "c3.webp"]


def test_use_in_another_mode_links_instead_of_copying(tmp_path):
    put(tmp_path, "accio", "a1.png", b"data")
    assert uploads.ensure_in_kind("a1.png", "media", tmp_path)
    linked = tmp_path / "minimax_h3" / "a1.png"
    assert linked.read_bytes() == b"data"
    assert (tmp_path / "accio" / "a1.png").samefile(linked)  # one file on disk
    assert not uploads.ensure_in_kind("gone.png", "media", tmp_path)


def test_delete_removes_every_subfolder_copy(tmp_path):
    put(tmp_path, "accio", "a1.png")
    uploads.ensure_in_kind("a1.png", "media", tmp_path)
    assert uploads.delete_upload("a1.png", tmp_path) == 2
    assert uploads.list_uploads(tmp_path) == []


def test_old_input_folder_content_moves_over_once(tmp_path):
    old, store = tmp_path / "input", tmp_path / "uploads"
    put(old, "accio", "a1.png", b"old")
    put(old, "minimax_h3", "dup.png", b"old")
    put(store, "minimax_h3", "dup.png", b"kept")
    put(old, "", "example.png")  # ComfyUI's own sample stays
    assert uploads.migrate_legacy_input(old, store) == 1
    assert (store / "accio" / "a1.png").read_bytes() == b"old"
    assert (store / "minimax_h3" / "dup.png").read_bytes() == b"kept"
    assert (old / "example.png").exists() and not (old / "accio").exists()
    assert uploads.migrate_legacy_input(old, store) == 0


def test_clear_folder_empties_but_keeps_the_folder(tmp_path):
    put(tmp_path, "accio", "a1.png")
    assert backend.clear_folder(tmp_path / "accio") == 1
    assert (tmp_path / "accio").is_dir() and not any((tmp_path / "accio").iterdir())
