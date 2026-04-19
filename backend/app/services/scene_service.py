from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.domain.models import (
    EventRecord,
    JournalEntry,
    SceneArchiveRecord,
    SceneCloseRequest,
    SceneDraftCloseSummaryRequest,
    SceneDraftCloseSummaryResponse,
    SceneOpenRequest,
)
from app.services.lore_update_service import LoreUpdateService
from app.services.lm_studio_client import LMStudioClient
from app.services.repository import StateRepository


class SceneService:
    OPEN_REFRESH_HINTS = ["campaign", "events", "lorebook", "overview", "scene"]
    CLOSE_REFRESH_HINTS = ["campaign", "events", "journal", "lorebook", "overview", "scene", "scene_archive"]
    READ_ONLY_COMMAND_NAMES = {"inventory", "quest", "journal", "relationships", "relationship", "actor", "campaign", "scene"}

    def __init__(self, repository: StateRepository, *, lm_client: LMStudioClient | None = None) -> None:
        self.repository = repository
        self.lore_service = LoreUpdateService(repository)
        self.lm_client = lm_client or LMStudioClient()

    def open_scene(self, payload: SceneOpenRequest, *, actor_id: str = "player") -> dict:
        scene_state = payload.model_dump(exclude_none=True)
        scene_state.setdefault("started_at", datetime.now(timezone.utc).isoformat())
        scene_state.setdefault("visible_clues", [])
        scene_state.setdefault("active_hazards", [])
        scene_state.setdefault("recent_discoveries", [])
        scene_state.setdefault("notable_object_details", {})
        self.repository.save_scene_state(scene_state)
        event = EventRecord.create(
            turn_id=f"turn_{uuid4().hex[:10]}",
            actor_id=actor_id,
            scene_id=scene_state["scene_id"],
            command_name="scene_open",
            event_type="scene_opened",
            source="scene_service",
            ok=True,
            message=f"Opened scene '{scene_state['scene_id']}'.",
            payload={"scene": scene_state},
        )
        self.repository.append_event(event.model_dump())
        lore_sync = self.lore_service.sync_from_canonical_state(actor_id=actor_id, command_results=[], scene_id=scene_state["scene_id"])
        return {"ok": True, "scene": scene_state, "lore_sync": lore_sync, "refresh_hints": self.OPEN_REFRESH_HINTS}

    def close_scene(self, payload: SceneCloseRequest, *, actor_id: str = "player") -> dict:
        current_scene = self.repository.load_scene_state()
        ended_at = datetime.now(timezone.utc).isoformat()
        archive = SceneArchiveRecord(
            archive_id=f"archive_{uuid4().hex[:10]}",
            scene_id=current_scene.get("scene_id", "unknown_scene"),
            started_at=current_scene.get("started_at"),
            ended_at=ended_at,
            summary=payload.summary,
            snapshot=current_scene,
        )
        self.repository.archive_scene(archive.model_dump())

        summary_entry = JournalEntry.create(
            kind="scene_summary",
            text=payload.summary,
            scene_id=current_scene.get("scene_id"),
            tags=["scene", "summary"],
            metadata={"archive_id": archive.archive_id},
        )
        self.repository.append_journal(summary_entry.model_dump())

        for fact in payload.durable_facts:
            fact_text = str(fact).strip()
            if not fact_text:
                continue
            self.repository.append_journal(
                JournalEntry.create(
                    kind="canon_fact",
                    text=fact_text,
                    scene_id=current_scene.get("scene_id"),
                    tags=["canon", "fact"],
                    metadata={"archive_id": archive.archive_id},
                ).model_dump()
            )

        next_scene_payload = (
            payload.next_scene.model_dump(exclude_none=True)
            if payload.next_scene
            else {
                "scene_id": "no_active_scene",
                "location": "Between scenes",
                "time_of_day": current_scene.get("time_of_day"),
                "nearby_npcs": [],
                "notable_objects": [],
                "visible_clues": [],
                "exits": [],
                "scene_tags": ["inactive", "transition"],
                "tension_level": 0,
                "active_hazards": [],
                "pending_roll": None,
                "recent_discoveries": [],
                "notable_object_details": {},
            }
        )
        next_scene_payload["started_at"] = ended_at
        self.repository.save_scene_state(next_scene_payload)

        self.repository.append_event(
            EventRecord.create(
                turn_id=f"turn_{uuid4().hex[:10]}",
                actor_id=actor_id,
                scene_id=current_scene.get("scene_id"),
                command_name="scene_close",
                event_type="scene_closed",
                source="scene_service",
                ok=True,
                message=f"Closed scene '{current_scene.get('scene_id', 'unknown_scene')}'.",
                payload={"archive": archive.model_dump(), "next_scene": next_scene_payload},
            ).model_dump()
        )

        lore_sync = self.lore_service.sync_from_canonical_state(
            actor_id=actor_id,
            command_results=[
                {
                    "name": "scene_close",
                    "argument": current_scene.get("scene_id"),
                    "ok": True,
                    "message": payload.summary,
                    "mutations": [],
                }
            ],
            scene_id=next_scene_payload.get("scene_id"),
        )

        return {
            "ok": True,
            "closed_scene": archive.model_dump(),
            "next_scene": next_scene_payload,
            "lore_sync": lore_sync,
            "refresh_hints": self.CLOSE_REFRESH_HINTS,
        }

    def draft_close_summary(
        self,
        payload: SceneDraftCloseSummaryRequest,
        *,
        actor_id: str = "player",
    ) -> dict[str, Any]:
        current_scene = self.repository.load_scene_state()
        recent_events = self.repository.list_events(limit=payload.recent_event_limit) if payload.recent_event_limit else []
        recent_journal = self.repository.list_journal(limit=payload.recent_journal_limit) if payload.recent_journal_limit else []
        summary_events, filter_warnings = self._filter_summary_events(recent_events)
        draft_payload, model = self.lm_client.generate_scene_close_summary(
            scene_state=current_scene,
            recent_events=summary_events,
            recent_journal=recent_journal,
            instructions=payload.instructions,
        )
        warnings = [str(warning).strip() for warning in draft_payload.get("warnings", []) if str(warning).strip()]
        warnings = list(dict.fromkeys(filter_warnings + warnings))
        response = SceneDraftCloseSummaryResponse(
            ok=True,
            scene_id=current_scene.get("scene_id", "unknown_scene"),
            model=model,
            summary=str(draft_payload.get("summary") or "").strip() or "No scene summary drafted.",
            durable_facts=[str(fact).strip() for fact in draft_payload.get("durable_facts", []) if str(fact).strip()],
            warnings=warnings,
            source_counts={
                "events": len(summary_events),
                "raw_events": len(recent_events),
                "journal_entries": len(recent_journal),
            },
        )
        return response.model_dump()

    def _filter_summary_events(self, events: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
        filtered: list[dict[str, Any]] = []
        ignored_count = 0
        for event in events:
            event_type = event.get("event_type")
            command_name = str(event.get("command_name") or "").strip().lower()
            payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            mutations = payload.get("mutations") if isinstance(payload, dict) else []

            if event_type == "turn_rolled_back":
                ignored_count += 1
                continue
            if event_type == "command_execution" and command_name in self.READ_ONLY_COMMAND_NAMES:
                ignored_count += 1
                continue
            if event_type == "command_execution" and not mutations:
                ignored_count += 1
                continue
            filtered.append(event)

        warnings: list[str] = []
        if ignored_count:
            warnings.append(f"ignored_{ignored_count}_non_substantive_event(s)")
        if events and not filtered:
            warnings.append("low_context_no_substantive_events")
        if not events:
            warnings.append("low_context_no_recent_events")
        return filtered, warnings
