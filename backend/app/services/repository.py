from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.config import BASE_DIR


class JsonStateRepository:
    def __init__(self, base_dir: Path | None = None) -> None:
        self._lock = threading.RLock()
        project_root = base_dir or BASE_DIR
        self.data_dir = project_root / "data"
        self.storage_dir = project_root / "storage"
        self.campaign_state_path = self.data_dir / "campaign_state.json"
        self.scene_state_path = self.data_dir / "scene_state.json"
        self.character_state_path = self.data_dir / "character_state.safe.json"
        self.cast_registry_path = self.data_dir / "cast_registry.json"
        self.item_registry_path = self.data_dir / "item_registry.json"
        self.spell_registry_path = self.data_dir / "spell_registry.json"
        self.event_log_path = self.storage_dir / "event_log.jsonl"
        self.journal_path = self.storage_dir / "journal_entries.jsonl"

    def _read_json(self, path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

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

    def load_item_registry(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.item_registry_path)

    def load_spell_registry(self) -> dict[str, Any]:
        with self._lock:
            return self._read_json(self.spell_registry_path)

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
