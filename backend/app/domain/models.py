from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CommandInvocation(StrictModel):
    name: str = Field(..., min_length=1)
    argument: str | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("argument")
    @classmethod
    def normalize_argument(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ParseCommandsRequest(StrictModel):
    text: str = Field(..., min_length=1)


class ParseCommandsResponse(StrictModel):
    commands: list[CommandInvocation]


class CommandExecutionRequest(StrictModel):
    actor_id: str = Field(default="player", min_length=1)
    text: str | None = None
    commands: list[CommandInvocation] | None = None
    scene_id: str | None = None

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class StateMutation(StrictModel):
    kind: str
    path: str
    before: Any = None
    after: Any = None
    note: str | None = None


class CommandExecutionResult(StrictModel):
    name: str
    argument: str | None = None
    ok: bool
    message: str
    mutations: list[StateMutation] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)


class StateOverview(StrictModel):
    actor_id: str
    actor_name: str
    hp_current: int
    hp_max: int
    spell_slots: dict[str, int]
    gold: int
    inventory: dict[str, int]
    equipment: dict[str, str | None]
    current_scene_id: str
    current_location: str
    active_quests: list[str]


class TurnExecutionResponse(StrictModel):
    parsed_commands: list[CommandInvocation]
    results: list[CommandExecutionResult]
    overview: StateOverview
    event_ids: list[str]
    narration_context: dict[str, Any]
    lore_sync: dict[str, Any] = Field(default_factory=dict)


class JournalEntryCreate(StrictModel):
    kind: Literal["turn_raw", "scene_summary", "fact", "quest_update", "note"]
    text: str = Field(..., min_length=1)
    tags: list[str] = Field(default_factory=list)


class JournalEntry(StrictModel):
    id: str
    timestamp: str
    kind: str
    text: str
    tags: list[str] = Field(default_factory=list)

    @classmethod
    def create(cls, kind: str, text: str, tags: list[str] | None = None) -> "JournalEntry":
        return cls(
            id=f"journal_{uuid4().hex[:10]}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            kind=kind,
            text=text,
            tags=tags or [],
        )


class EventRecord(StrictModel):
    id: str
    timestamp: str
    actor_id: str
    scene_id: str | None = None
    command_name: str
    ok: bool
    message: str
    payload: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        *,
        actor_id: str,
        scene_id: str | None,
        command_name: str,
        ok: bool,
        message: str,
        payload: dict[str, Any] | None = None,
    ) -> "EventRecord":
        return cls(
            id=f"event_{uuid4().hex[:10]}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            actor_id=actor_id,
            scene_id=scene_id,
            command_name=command_name,
            ok=ok,
            message=message,
            payload=payload or {},
        )
