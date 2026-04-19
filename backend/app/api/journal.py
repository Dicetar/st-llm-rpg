from fastapi import APIRouter, HTTPException, Query

from app.domain.models import EventRecord, JournalEntry, JournalEntryCreate, JournalSessionSummaryCreate
from app.services.lore_update_service import LoreUpdateService
from app.services.repository import create_repository

router = APIRouter(tags=["journal"])
repository = create_repository()
lore_service = LoreUpdateService(repository)


def _require_actor_or_404(actor_id: str) -> None:
    actors = repository.load_character_state().get("actors", {})
    if actor_id not in actors:
        raise HTTPException(status_code=404, detail=f"Unknown actor_id '{actor_id}'.")


def _sync_lorebook_or_404(*, actor_id: str, scene_id: str | None) -> dict:
    try:
        return lore_service.sync_from_canonical_state(actor_id=actor_id, command_results=[], scene_id=scene_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/journal/entries")
def list_journal_entries(limit: int = Query(default=20, ge=1, le=100)):
    return {"entries": repository.list_journal(limit=limit)}


@router.post("/journal/entries")
def create_journal_entry(payload: JournalEntryCreate, actor_id: str = Query(default="player")):
    _require_actor_or_404(actor_id)
    entry = JournalEntry.create(
        kind=payload.kind,
        text=payload.text,
        tags=payload.tags,
        scene_id=payload.scene_id,
        metadata=payload.metadata,
    )
    entry_payload = entry.model_dump()
    repository.append_journal(entry_payload)
    lore_sync = _sync_lorebook_or_404(actor_id=actor_id, scene_id=entry.scene_id)
    return {
        **entry_payload,
        "lore_sync": lore_sync,
        "refresh_hints": ["journal", "lorebook"],
    }


@router.post("/journal/session-summary")
def create_session_summary(payload: JournalSessionSummaryCreate, actor_id: str = Query(default="player")):
    _require_actor_or_404(actor_id)
    scene_id = payload.scene_id or repository.load_scene_state().get("scene_id")
    durable_facts = [str(fact).strip() for fact in payload.durable_facts if str(fact).strip()]
    metadata = {
        **payload.metadata,
        "durable_facts": durable_facts,
        "source": payload.metadata.get("source", "manual_session_summary"),
    }
    tags = list(dict.fromkeys(["session", "summary", *payload.tags]))
    entry = JournalEntry.create(
        kind="session_summary",
        text=payload.summary,
        tags=tags,
        scene_id=scene_id,
        metadata=metadata,
    )
    entry_payload = entry.model_dump()
    repository.append_journal(entry_payload)
    repository.append_event(
        EventRecord.create(
            turn_id=f"turn_session_summary_{entry.id}",
            actor_id=actor_id,
            scene_id=scene_id,
            command_name="session_summary",
            event_type="session_summary_created",
            source="journal_api",
            ok=True,
            message="Session summary recorded.",
            payload={"journal_entry_id": entry.id, "durable_facts": durable_facts},
        ).model_dump()
    )
    lore_sync = _sync_lorebook_or_404(actor_id=actor_id, scene_id=scene_id)
    return {
        "ok": True,
        "entry": entry_payload,
        "lore_sync": lore_sync,
        "refresh_hints": ["events", "journal", "lorebook"],
    }
