from __future__ import annotations

import json
import os
import sqlite3
import threading
import hashlib
import re
from abc import ABC, abstractmethod
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from shutil import copy2
from typing import Any, Callable

from app.config import BASE_DIR, REPOSITORY_BACKEND, SEED_DIR

STATE_DOCUMENTS = {
    "campaign_state": "campaign_state.json",
    "scene_state": "scene_state.json",
    "character_state": "character_state.safe.json",
    "cast_registry": "cast_registry.json",
    "item_registry": "item_registry.json",
    "spell_registry": "spell_registry.json",
    "lorebook_state": "lorebook_state.json",
}

DEFAULT_SAVE_ID = "default"
SAFE_SAVE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
UNSAFE_SAVE_ID_CHARS = re.compile(r"[^a-z0-9]+")


def normalize_save_id(save_id: str | None) -> str:
    raw_value = str(save_id or "").strip()
    if not raw_value:
        return DEFAULT_SAVE_ID

    canonical = raw_value.casefold()
    if SAFE_SAVE_ID_PATTERN.fullmatch(canonical):
        return canonical

    slug = UNSAFE_SAVE_ID_CHARS.sub("-", canonical).strip("-.")
    slug = re.sub(r"-{2,}", "-", slug)[:48]
    if not slug:
        slug = "save"

    digest = hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:8]
    return f"{slug}--{digest}"


def resolve_runtime_dir(project_root: Path, save_id: str | None = None) -> tuple[str, Path]:
    normalized_save_id = normalize_save_id(save_id)
    runtime_root = project_root / "runtime"
    if normalized_save_id == DEFAULT_SAVE_ID:
        return normalized_save_id, runtime_root
    return normalized_save_id, runtime_root / "saves" / normalized_save_id


def default_lorebook_state() -> dict[str, Any]:
    return {
        "schema_version": "0.2.0",
        "revision": 0,
        "updated_at": None,
        "actors": {},
        "items": {},
        "quests": {},
        "relationships": {},
        "locations": {},
        "insertion_entries": {},
        "timeline": [],
    }


class StateRepository(ABC):
    seed_dir: Path
    runtime_dir: Path
    save_id: str

    @abstractmethod
    def load_campaign_state(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def save_campaign_state(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_scene_state(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def save_scene_state(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_character_state(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def save_character_state(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_cast_registry(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def save_cast_registry(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_item_registry(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def save_item_registry(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_spell_registry(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def save_spell_registry(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_lorebook_state(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def save_lorebook_state(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def append_event(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def list_events(self, limit: int = 20) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def append_journal(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def list_journal(self, limit: int = 20) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def archive_scene(self, payload: dict[str, Any]) -> None:
        raise NotImplementedError

    @abstractmethod
    def list_scene_archives(self, limit: int = 20) -> list[dict[str, Any]]:
        raise NotImplementedError


class JsonStateRepository(StateRepository):
    def __init__(self, base_dir: Path | None = None, save_id: str | None = None) -> None:
        self._lock = threading.RLock()
        project_root = base_dir or BASE_DIR
        seed_dir = project_root / "data" / "seed"
        if not seed_dir.exists():
            seed_dir = project_root / "data"

        self.seed_dir = seed_dir if base_dir else SEED_DIR
        self.save_id, self.runtime_dir = resolve_runtime_dir(project_root, save_id)
        self.data_dir = self.runtime_dir / "data"
        self.storage_dir = self.runtime_dir / "storage"
        self.campaign_state_path = self.data_dir / STATE_DOCUMENTS["campaign_state"]
        self.scene_state_path = self.data_dir / STATE_DOCUMENTS["scene_state"]
        self.character_state_path = self.data_dir / STATE_DOCUMENTS["character_state"]
        self.cast_registry_path = self.data_dir / STATE_DOCUMENTS["cast_registry"]
        self.item_registry_path = self.data_dir / STATE_DOCUMENTS["item_registry"]
        self.spell_registry_path = self.data_dir / STATE_DOCUMENTS["spell_registry"]
        self.lorebook_state_path = self.data_dir / STATE_DOCUMENTS["lorebook_state"]
        self.event_log_path = self.storage_dir / "event_log.jsonl"
        self.journal_path = self.storage_dir / "journal_entries.jsonl"
        self.scene_archive_path = self.storage_dir / "scene_archives.jsonl"
        self._bootstrap_runtime_files()

    def _bootstrap_runtime_files(self) -> None:
        with self._lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.storage_dir.mkdir(parents=True, exist_ok=True)

            self._ensure_runtime_file(self.campaign_state_path, self.seed_dir / STATE_DOCUMENTS["campaign_state"])
            self._ensure_runtime_file(self.scene_state_path, self.seed_dir / STATE_DOCUMENTS["scene_state"])
            self._ensure_runtime_file(self.character_state_path, self.seed_dir / STATE_DOCUMENTS["character_state"])
            self._ensure_runtime_file(self.cast_registry_path, self.seed_dir / STATE_DOCUMENTS["cast_registry"])
            self._ensure_runtime_file(self.item_registry_path, self.seed_dir / STATE_DOCUMENTS["item_registry"])
            self._ensure_runtime_file(self.spell_registry_path, self.seed_dir / STATE_DOCUMENTS["spell_registry"])
            self._ensure_runtime_file(
                self.lorebook_state_path,
                self.data_dir / "__generated_lorebook_state.json",
                json.dumps(self._default_lorebook_state(), indent=2),
            )
            self._ensure_runtime_file(self.event_log_path, self.storage_dir / "__generated_event_log.jsonl", "")
            self._ensure_runtime_file(self.journal_path, self.storage_dir / "__generated_journal_entries.jsonl", "")
            self._ensure_runtime_file(self.scene_archive_path, self.storage_dir / "__generated_scene_archives.jsonl", "")

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

    def _append_jsonl(self, path: Path, payload: dict[str, Any]) -> None:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload) + "\n")

    def _read_jsonl(self, path: Path, limit: int) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        return [json.loads(line) for line in lines[-limit:]][::-1]

    def _default_lorebook_state(self) -> dict[str, Any]:
        return default_lorebook_state()

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
            self._append_jsonl(self.event_log_path, payload)

    def list_events(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return self._read_jsonl(self.event_log_path, limit)

    def append_journal(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._append_jsonl(self.journal_path, payload)

    def list_journal(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return self._read_jsonl(self.journal_path, limit)

    def archive_scene(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self._append_jsonl(self.scene_archive_path, payload)

    def list_scene_archives(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return self._read_jsonl(self.scene_archive_path, limit)


class SqliteStateRepository(StateRepository):
    def __init__(self, base_dir: Path | None = None, database_name: str = "state.sqlite3", save_id: str | None = None) -> None:
        self._lock = threading.RLock()
        project_root = base_dir or BASE_DIR
        seed_dir = project_root / "data" / "seed"
        if not seed_dir.exists():
            seed_dir = project_root / "data"

        self.seed_dir = seed_dir if base_dir else SEED_DIR
        self.save_id, self.runtime_dir = resolve_runtime_dir(project_root, save_id)
        self.data_dir = self.runtime_dir / "data"
        self.storage_dir = self.runtime_dir / "storage"
        self.database_path = self.storage_dir / database_name
        self.campaign_state_path = self.database_path
        self.scene_state_path = self.database_path
        self.character_state_path = self.database_path
        self.event_log_path = self.database_path
        self.journal_path = self.database_path
        self.scene_archive_path = self.database_path
        self._bootstrap_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _bootstrap_database(self) -> None:
        with self._lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.storage_dir.mkdir(parents=True, exist_ok=True)
            with self._connect() as connection:
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS state_documents (
                        doc_key TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS event_log (
                        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_id TEXT NOT NULL UNIQUE,
                        turn_id TEXT,
                        scene_id TEXT,
                        command_name TEXT,
                        ok INTEGER,
                        event_type TEXT,
                        message TEXT,
                        summary TEXT,
                        source TEXT,
                        created_at TEXT NOT NULL,
                        payload_json TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS journal_entries (
                        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        journal_id TEXT NOT NULL UNIQUE,
                        kind TEXT NOT NULL,
                        scene_id TEXT,
                        text TEXT NOT NULL,
                        tags_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        payload_json TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS scene_archives (
                        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        archive_id TEXT NOT NULL UNIQUE,
                        scene_id TEXT NOT NULL,
                        started_at TEXT,
                        ended_at TEXT NOT NULL,
                        summary TEXT,
                        payload_json TEXT NOT NULL
                    );
                    """
                )
                for doc_key, filename in STATE_DOCUMENTS.items():
                    if self._document_exists(connection, doc_key):
                        continue
                    payload = self._load_seed_document(filename, doc_key)
                    self._upsert_document(connection, doc_key, payload)

    def _document_exists(self, connection: sqlite3.Connection, doc_key: str) -> bool:
        row = connection.execute("SELECT 1 FROM state_documents WHERE doc_key = ?", (doc_key,)).fetchone()
        return row is not None

    def _load_seed_document(self, filename: str, doc_key: str) -> dict[str, Any]:
        seed_path = self.seed_dir / filename
        if seed_path.exists():
            return json.loads(seed_path.read_text(encoding="utf-8"))
        if doc_key == "lorebook_state":
            return default_lorebook_state()
        return {}

    def _upsert_document(self, connection: sqlite3.Connection, doc_key: str, payload: dict[str, Any]) -> None:
        connection.execute(
            """
            INSERT INTO state_documents (doc_key, payload_json)
            VALUES (?, ?)
            ON CONFLICT(doc_key) DO UPDATE SET payload_json = excluded.payload_json
            """,
            (doc_key, json.dumps(payload)),
        )

    def _load_document(self, doc_key: str) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT payload_json FROM state_documents WHERE doc_key = ?", (doc_key,)).fetchone()
            if row is None:
                payload = self._load_seed_document(STATE_DOCUMENTS[doc_key], doc_key)
                self._upsert_document(connection, doc_key, payload)
                connection.commit()
                return deepcopy(payload)
            return json.loads(row["payload_json"])

    def _save_document(self, doc_key: str, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as connection:
            self._upsert_document(connection, doc_key, payload)
            connection.commit()

    def load_campaign_state(self) -> dict[str, Any]:
        return self._load_document("campaign_state")

    def save_campaign_state(self, payload: dict[str, Any]) -> None:
        self._save_document("campaign_state", payload)

    def load_scene_state(self) -> dict[str, Any]:
        return self._load_document("scene_state")

    def save_scene_state(self, payload: dict[str, Any]) -> None:
        self._save_document("scene_state", payload)

    def load_character_state(self) -> dict[str, Any]:
        return self._load_document("character_state")

    def save_character_state(self, payload: dict[str, Any]) -> None:
        self._save_document("character_state", payload)

    def load_cast_registry(self) -> dict[str, Any]:
        return self._load_document("cast_registry")

    def save_cast_registry(self, payload: dict[str, Any]) -> None:
        self._save_document("cast_registry", payload)

    def load_item_registry(self) -> dict[str, Any]:
        return self._load_document("item_registry")

    def save_item_registry(self, payload: dict[str, Any]) -> None:
        self._save_document("item_registry", payload)

    def load_spell_registry(self) -> dict[str, Any]:
        return self._load_document("spell_registry")

    def save_spell_registry(self, payload: dict[str, Any]) -> None:
        self._save_document("spell_registry", payload)

    def load_lorebook_state(self) -> dict[str, Any]:
        payload = self._load_document("lorebook_state")
        if payload:
            return payload
        payload = default_lorebook_state()
        self.save_lorebook_state(payload)
        return payload

    def save_lorebook_state(self, payload: dict[str, Any]) -> None:
        self._save_document("lorebook_state", payload)

    def append_event(self, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO event_log (
                    event_id, turn_id, scene_id, command_name, ok, event_type, message, summary, source, created_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("id"),
                    payload.get("turn_id"),
                    payload.get("scene_id"),
                    payload.get("command_name"),
                    1 if payload.get("ok") else 0 if payload.get("ok") is not None else None,
                    payload.get("event_type"),
                    payload.get("message"),
                    payload.get("summary"),
                    payload.get("source"),
                    payload.get("timestamp") or payload.get("created_at") or "",
                    json.dumps(payload),
                ),
            )
            connection.commit()

    def list_events(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT payload_json FROM event_log ORDER BY row_id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def append_journal(self, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO journal_entries (journal_id, kind, scene_id, text, tags_json, created_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("id"),
                    payload.get("kind"),
                    payload.get("scene_id"),
                    payload.get("text"),
                    json.dumps(payload.get("tags", [])),
                    payload.get("timestamp") or payload.get("created_at") or "",
                    json.dumps(payload),
                ),
            )
            connection.commit()

    def list_journal(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT payload_json FROM journal_entries ORDER BY row_id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def archive_scene(self, payload: dict[str, Any]) -> None:
        archive_id = str(payload.get("archive_id") or payload.get("id") or f"archive_{payload.get('scene_id', 'scene')}_{payload.get('ended_at', '')}")
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO scene_archives (archive_id, scene_id, started_at, ended_at, summary, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    archive_id,
                    payload.get("scene_id"),
                    payload.get("started_at"),
                    payload.get("ended_at"),
                    payload.get("summary"),
                    json.dumps({**payload, "archive_id": archive_id}),
                ),
            )
            connection.commit()

    def list_scene_archives(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT payload_json FROM scene_archives ORDER BY row_id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]


class TransactionalStateRepository(StateRepository):
    def __init__(self, base_repository: StateRepository) -> None:
        self.base_repository = base_repository
        self.seed_dir = base_repository.seed_dir
        self.runtime_dir = base_repository.runtime_dir
        self.save_id = base_repository.save_id
        self._documents: dict[str, dict[str, Any]] = {}
        self._dirty_documents: set[str] = set()
        self._events: list[dict[str, Any]] = []
        self._journal_entries: list[dict[str, Any]] = []
        self._scene_archives: list[dict[str, Any]] = []

    def _load_document(self, key: str, loader: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        if key not in self._documents:
            self._documents[key] = deepcopy(loader())
        return self._documents[key]

    def _save_document(self, key: str, payload: dict[str, Any]) -> None:
        self._documents[key] = deepcopy(payload)
        self._dirty_documents.add(key)

    def load_campaign_state(self) -> dict[str, Any]:
        return self._load_document("campaign_state", self.base_repository.load_campaign_state)

    def save_campaign_state(self, payload: dict[str, Any]) -> None:
        self._save_document("campaign_state", payload)

    def load_scene_state(self) -> dict[str, Any]:
        return self._load_document("scene_state", self.base_repository.load_scene_state)

    def save_scene_state(self, payload: dict[str, Any]) -> None:
        self._save_document("scene_state", payload)

    def load_character_state(self) -> dict[str, Any]:
        return self._load_document("character_state", self.base_repository.load_character_state)

    def save_character_state(self, payload: dict[str, Any]) -> None:
        self._save_document("character_state", payload)

    def load_cast_registry(self) -> dict[str, Any]:
        return self._load_document("cast_registry", self.base_repository.load_cast_registry)

    def save_cast_registry(self, payload: dict[str, Any]) -> None:
        self._save_document("cast_registry", payload)

    def load_item_registry(self) -> dict[str, Any]:
        return self._load_document("item_registry", self.base_repository.load_item_registry)

    def save_item_registry(self, payload: dict[str, Any]) -> None:
        self._save_document("item_registry", payload)

    def load_spell_registry(self) -> dict[str, Any]:
        return self._load_document("spell_registry", self.base_repository.load_spell_registry)

    def save_spell_registry(self, payload: dict[str, Any]) -> None:
        self._save_document("spell_registry", payload)

    def load_lorebook_state(self) -> dict[str, Any]:
        return self._load_document("lorebook_state", self.base_repository.load_lorebook_state)

    def save_lorebook_state(self, payload: dict[str, Any]) -> None:
        self._save_document("lorebook_state", payload)

    def append_event(self, payload: dict[str, Any]) -> None:
        self._events.append(deepcopy(payload))

    def list_events(self, limit: int = 20) -> list[dict[str, Any]]:
        local = list(reversed(self._events[-limit:]))
        if len(local) >= limit:
            return local[:limit]
        return local + self.base_repository.list_events(limit=limit - len(local))

    def append_journal(self, payload: dict[str, Any]) -> None:
        self._journal_entries.append(deepcopy(payload))

    def list_journal(self, limit: int = 20) -> list[dict[str, Any]]:
        local = list(reversed(self._journal_entries[-limit:]))
        if len(local) >= limit:
            return local[:limit]
        return local + self.base_repository.list_journal(limit=limit - len(local))

    def archive_scene(self, payload: dict[str, Any]) -> None:
        self._scene_archives.append(deepcopy(payload))

    def list_scene_archives(self, limit: int = 20) -> list[dict[str, Any]]:
        local = list(reversed(self._scene_archives[-limit:]))
        if len(local) >= limit:
            return local[:limit]
        return local + self.base_repository.list_scene_archives(limit=limit - len(local))

    def flush(self) -> None:
        if "campaign_state" in self._dirty_documents:
            self.base_repository.save_campaign_state(self._documents["campaign_state"])
        if "scene_state" in self._dirty_documents:
            self.base_repository.save_scene_state(self._documents["scene_state"])
        if "character_state" in self._dirty_documents:
            self.base_repository.save_character_state(self._documents["character_state"])
        if "cast_registry" in self._dirty_documents:
            self.base_repository.save_cast_registry(self._documents["cast_registry"])
        if "item_registry" in self._dirty_documents:
            self.base_repository.save_item_registry(self._documents["item_registry"])
        if "spell_registry" in self._dirty_documents:
            self.base_repository.save_spell_registry(self._documents["spell_registry"])
        if "lorebook_state" in self._dirty_documents:
            self.base_repository.save_lorebook_state(self._documents["lorebook_state"])

        for payload in self._events:
            self.base_repository.append_event(payload)
        for payload in self._journal_entries:
            self.base_repository.append_journal(payload)
        for payload in self._scene_archives:
            self.base_repository.archive_scene(payload)

        self._dirty_documents.clear()
        self._events.clear()
        self._journal_entries.clear()
        self._scene_archives.clear()


@lru_cache(maxsize=32)
def _create_live_repository(selected_backend: str, normalized_save_id: str) -> StateRepository:
    if selected_backend == "json":
        return JsonStateRepository(save_id=normalized_save_id)
    return SqliteStateRepository(save_id=normalized_save_id)


def create_repository(base_dir: Path | None = None, backend: str | None = None, save_id: str | None = None) -> StateRepository:
    selected_backend = (backend or os.getenv("ST_LLM_RPG_REPOSITORY") or REPOSITORY_BACKEND).strip().lower()
    normalized_save_id = normalize_save_id(save_id)
    if base_dir is None:
        return _create_live_repository(selected_backend, normalized_save_id)
    if selected_backend == "json":
        return JsonStateRepository(base_dir=base_dir, save_id=normalized_save_id)
    return SqliteStateRepository(base_dir=base_dir, save_id=normalized_save_id)
