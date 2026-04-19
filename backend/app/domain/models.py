from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


CommandExecutionMode = Literal["commit", "dry_run"]
CommandFailurePolicy = Literal["best_effort", "rollback_on_failure"]


class CommandExecutionRequest(StrictModel):
    actor_id: str = Field(default="player", min_length=1)
    text: str | None = None
    raw_text: str | None = None
    commands: list[CommandInvocation] | None = None
    scene_id: str | None = None
    mode: CommandExecutionMode = "commit"
    failure_policy: CommandFailurePolicy = "best_effort"

    @field_validator("text", "raw_text")
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def sync_text_fields(self) -> "CommandExecutionRequest":
        canonical_text = self.text or self.raw_text
        self.text = canonical_text
        self.raw_text = canonical_text
        return self


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
    error_code: str | None = None
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
    turn_id: str
    mode: CommandExecutionMode
    failure_policy: CommandFailurePolicy = "best_effort"
    parsed_commands: list[CommandInvocation]
    results: list[CommandExecutionResult]
    command_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    has_failures: bool = False
    rolled_back: bool = False
    committed: bool = False
    state_changes: list[StateMutation] = Field(default_factory=list)
    discarded_state_changes: list[StateMutation] = Field(default_factory=list)
    overview: StateOverview
    refresh_hints: list[str] = Field(default_factory=list)
    event_ids: list[str] = Field(default_factory=list)
    narration_context: dict[str, Any]
    lore_sync: dict[str, Any] = Field(default_factory=dict)


class ActivatedLoreEntry(StrictModel):
    id: str
    title: str
    entry_type: str
    content: str
    keywords: list[str] = Field(default_factory=list)
    secondary_keywords: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    match_reasons: list[str] = Field(default_factory=list)
    score: int = 0
    order: int = 0
    constant: bool = False
    selective: bool = True


class TurnSidecarWarning(StrictModel):
    stage: Literal["narration", "extraction"]
    error_code: str
    message: str


class ChatContextMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1)
    name: str | None = None


JournalEntryKind = Literal[
    "turn_raw",
    "scene_summary",
    "session_summary",
    "fact",
    "note",
    "canon_fact",
    "quest_update",
    "relationship_note",
]


class JournalEntryCreate(StrictModel):
    kind: JournalEntryKind
    text: str = Field(..., min_length=1)
    tags: list[str] = Field(default_factory=list)
    scene_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class JournalSessionSummaryCreate(StrictModel):
    summary: str = Field(..., min_length=1)
    durable_facts: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    scene_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class JournalEntry(StrictModel):
    id: str
    timestamp: str
    kind: str
    text: str
    tags: list[str] = Field(default_factory=list)
    scene_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        kind: str,
        text: str,
        tags: list[str] | None = None,
        scene_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "JournalEntry":
        return cls(
            id=f"journal_{uuid4().hex[:10]}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            kind=kind,
            text=text,
            tags=tags or [],
            scene_id=scene_id,
            metadata=metadata or {},
        )


class EventRecord(StrictModel):
    id: str
    turn_id: str
    timestamp: str
    actor_id: str
    scene_id: str | None = None
    command_name: str
    event_type: str = "command_execution"
    source: str = "backend"
    ok: bool
    message: str
    summary: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        *,
        turn_id: str,
        actor_id: str,
        scene_id: str | None,
        command_name: str,
        ok: bool,
        message: str,
        payload: dict[str, Any] | None = None,
        event_type: str = "command_execution",
        source: str = "backend",
        summary: str | None = None,
    ) -> "EventRecord":
        return cls(
            id=f"event_{uuid4().hex[:10]}",
            turn_id=turn_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            actor_id=actor_id,
            scene_id=scene_id,
            command_name=command_name,
            event_type=event_type,
            source=source,
            ok=ok,
            message=message,
            summary=summary or message,
            payload=payload or {},
        )


class ExtractedUpdate(StrictModel):
    category: Literal["item_change", "quest_progress", "location_change", "condition_change", "scene_object_change", "relationship_shift"]
    description: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    payload: dict[str, Any] = Field(default_factory=dict)


class ExtractionEnvelope(StrictModel):
    updates: list[ExtractedUpdate] = Field(default_factory=list)


class NarrationResolveRequest(StrictModel):
    actor_id: str = Field(default="player", min_length=1)
    text: str | None = None
    raw_text: str | None = None
    commands: list[CommandInvocation] | None = None
    recent_chat_messages: list[ChatContextMessage] = Field(default_factory=list)
    scene_id: str | None = None
    mode: CommandExecutionMode = "commit"
    failure_policy: CommandFailurePolicy = "best_effort"
    include_extraction: bool = False

    @field_validator("text", "raw_text")
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def sync_text_fields(self) -> "NarrationResolveRequest":
        canonical_text = self.text or self.raw_text
        self.text = canonical_text
        self.raw_text = canonical_text
        return self


class ResolvedTurnResponse(TurnExecutionResponse):
    prose: str
    activated_lore_entries: list[ActivatedLoreEntry] = Field(default_factory=list)
    proposed_updates: list[ExtractedUpdate] = Field(default_factory=list)
    applied_updates: list[StateMutation] = Field(default_factory=list)
    staged_updates: list[ExtractedUpdate] = Field(default_factory=list)
    warnings: list[TurnSidecarWarning] = Field(default_factory=list)
    narrator_model: str | None = None
    extractor_model: str | None = None


class SceneOpenRequest(StrictModel):
    scene_id: str = Field(..., min_length=1)
    location: str = Field(..., min_length=1)
    time_of_day: str | None = None
    nearby_npcs: list[str] = Field(default_factory=list)
    notable_objects: list[str] = Field(default_factory=list)
    visible_clues: list[str] = Field(default_factory=list)
    exits: list[str] = Field(default_factory=list)
    scene_tags: list[str] = Field(default_factory=list)
    tension_level: int = 0
    active_hazards: list[str] = Field(default_factory=list)
    pending_roll: dict[str, Any] | None = None
    recent_discoveries: list[str] = Field(default_factory=list)
    notable_object_details: dict[str, Any] = Field(default_factory=dict)


class SceneCloseRequest(StrictModel):
    summary: str = Field(..., min_length=1)
    durable_facts: list[str] = Field(default_factory=list)
    next_scene: SceneOpenRequest | None = None


class SceneDraftCloseSummaryRequest(StrictModel):
    instructions: str | None = None
    recent_event_limit: int = Field(default=8, ge=0, le=50)
    recent_journal_limit: int = Field(default=8, ge=0, le=50)

    @field_validator("instructions")
    @classmethod
    def clean_instructions(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class SceneDraftCloseSummaryResponse(StrictModel):
    ok: bool = True
    scene_id: str
    model: str | None = None
    summary: str
    durable_facts: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    source_counts: dict[str, int] = Field(default_factory=dict)


class SceneArchiveRecord(StrictModel):
    archive_id: str
    scene_id: str
    started_at: str | None = None
    ended_at: str
    summary: str
    snapshot: dict[str, Any]
