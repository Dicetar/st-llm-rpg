from __future__ import annotations

import json
import threading
from shutil import copy2
from pathlib import Path
from typing import Any

from app.config import BASE_DIR, SEED_DIR


class JsonStateRepository:
    def __init__(self, base_dir: Path | None = None) -> None:
        self._lock = threading.RLock()
        project_root = base_dir or BASE_DIR
        seed_dir = project_root / "data" / "seed"
        if not seed_dir.exists():
            seed_dir = project_root / "data"

        self.seed_dir = seed_dir if base_dir else SEED_DIR
        self.runtime_dir = project_root / "runtime"
        self.data_dir = self.runtime_dir / "data"
        self.storage_dir = self.runtime_dir / "storage"
        self.campaign_state_path = self.data_dir / "campaign_state.json"
        self.scene_state_path = self.data_dir / "scene_state.json"
        self.character_state_path = self.data_dir / "character_state.safe.json"
        self.cast_registry_path = self.data_dir / "cast_registry.json"
        self.item_registry_path = self.data_dir / "item_registry.json"
        self.spell_registry_path = self.data_dir / "spell_registry.json"
        self.lorebook_state_path = self.data_dir / "lorebook_state.json"
        self.event_log_path = self.storage_dir / "event_log.jsonl"
        self.journal_path = self.storage_dir / "journal_entries.jsonl"
        self._bootstrap_runtime_files()

    def _bootstrap_runtime_files(self) -> None:
        with self._lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.storage_dir.mkdir(parents=True, exist_ok=True)

            self._ensure_runtime_file(self.campaign_state_path, self.seed_dir / "campaign_state.json")
            self._ensure_runtime_file(self.scene_state_path, self.seed_dir / "scene_state.json")
            self._ensure_runtime_file(self.character_state_path, self.seed_dir / "character_state.safe.json")
            self._ensure_runtime_file(self.cast_registry_path, self.seed_dir / "cast_registry.json")
            self._ensure_runtime_file(self.item_registry_path, self.seed_dir / "item_registry.json")
            self._ensure_runtime_file(self.spell_registry_path, self.seed_dir / "spell_registry.json")
            self._ensure_runtime_file(self.lorebook_state_path, self.data_dir / "__generated_lorebook_state.json", json.dumps(self._default_lorebook_state(), indent=2))
            self._ensure_runtime_file(self.event_log_path, self.storage_dir / "__generated_event_log.jsonl", "")
            self._ensure_runtime_file(self.journal_path, self.storage_dir / "__generated_journal_entries.jsonl", "")

    def _ensure_runtime_file(self, runtime_path: Path, seed_path: Path, default_text: str | None = None) -> None:
        if runtime_path.exists():
            return
        if seed_path.exists():
            copy2(seed_path, runtime_path)
            return
        runtime_path.write_text("" if default_text is None else default_text, encoding="utf-8")

    def _read_json(self, path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _default_lorebook_state(self) -> dict[str, Any]:
        return {
            "schema_version": "0.1.0",
            "revision": 0,
            "updated_at": None,
            "actors": {},
            "items": {},
            "quests": {},
            "relationships": {},
            "locations": {},
            "timeline": [],
        }

    def load_campaign_state(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.campaign_state_path)

    def save_campaign_state(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_json(self.campaign_state_path, payload)

    def load_scene_state(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.scene_state_path)

    def save_scene_state(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_json(self.scene_state_path, payload)

    def load_character_state(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.character_state_path)

    def save_character_state(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_json(self.character_state_path, payload)

    def load_cast_registry(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.cast_registry_path)

    def save_cast_registry(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_json(self.cast_registry_path, payload)

    def load_item_registry(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.item_registry_path)

    def save_item_registry(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_json(self.item_registry_path, payload)

    def load_spell_registry(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.spell_registry_path)

    def save_spell_registry(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_json(self.spell_registry_path, payload)

    def load_lorebook_state(self) -> dict[str, Any]:
        with self._lock:
            if not self.lorebook_state_path.exists():
                payload = self._default_lorebook_state()
                self._write_json(self.lorebook_state_path, payload)
                return payload
            return self._read_json(self.lorebook_state_path)

    def save_lorebook_state(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._write_json(self.lorebook_state_path, payload)

    def append_event(self, payload: dict[str, Any]) -> None:
        with self._lock:
            with self.event_log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(payload) + "\n")

    def list_events(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            if not self.event_log_path.exists():
                return []
            lines = [line for line in self.event_log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            return [json.loads(line) for line in lines[-limit:]][::-1]

    def append_journal(self, payload: dict[str, Any]) -> None:
        with self._lock:
            with self.journal_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(payload) + "\n")

    def list_journal(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            if not self.journal_path.exists():
                return []
            lines = [line for line in self.journal_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            return [json.loads(line) for line in lines[-limit:]][::-1]
