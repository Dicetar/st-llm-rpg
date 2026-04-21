from fastapi import APIRouter, HTTPException, Query

from app.domain.models import (
    EventRecord,
    JournalDraftSessionSummaryRequest,
    JournalDraftSessionSummaryResponse,
    JournalEntry,
    JournalEntryCreate,
    JournalSessionSummaryCreate,
)
from app.services.command_engine import CommandEngine
from app.services.lore_update_service import LoreUpdateService
from app.services.lm_studio_client import LMStudioClient
from app.services.repository import StateRepository, create_repository

router = APIRouter(tags=["journal"])


def _require_actor_or_404(repository: StateRepository, actor_id: str) -> None:
    actors = repository.load_character_state().get("actors", {})
    if actor_id not in actors:
        raise HTTPException(status_code=404, detail=f"Unknown actor_id '{actor_id}'.")


def _sync_lorebook_or_404(repository: StateRepository, *, actor_id: str, scene_id: str | None) -> dict:
    lore_service = LoreUpdateService(repository)
    try:
        return lore_service.sync_from_canonical_state(actor_id=actor_id, command_results=[], scene_id=scene_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _build_session_summary_context(repository: StateRepository, actor_id: str) -> dict:
    overview = CommandEngine(repository).build_overview(actor_id).model_dump()
    campaign_state = repository.load_campaign_state()
    scene_state = repository.load_scene_state()
    return {
        "actor_id": overview.get("actor_id"),
        "actor_name": overview.get("actor_name"),
        "scene": {
            "scene_id": scene_state.get("scene_id"),
            "location": scene_state.get("location"),
            "time_of_day": scene_state.get("time_of_day"),
        },
        "campaign": {
            "current_arc": campaign_state.get("current_arc"),
            "active_quests": overview.get("active_quests", []),
            "plot_flags": campaign_state.get("plot_flags", []),
            "relationship_names": sorted((campaign_state.get("relationships") or {}).keys()),
        },
    }


@router.get("/journal/entries")
def list_journal_entries(limit: int = Query(default=20, ge=1, le=100), save_id: str = Query(default="default")):
    repository = create_repository(save_id=save_id)
    return {"entries": repository.list_journal(limit=limit)}


@router.post("/journal/entries")
def create_journal_entry(payload: JournalEntryCreate, actor_id: str = Query(default="player"), save_id: str = Query(default="default")):
    repository = create_repository(save_id=save_id)
    _require_actor_or_404(repository, actor_id)
    entry = JournalEntry.create(
        kind=payload.kind,
        text=payload.text,
        tags=payload.tags,
        scene_id=payload.scene_id,
        metadata=payload.metadata,
    )
    entry_payload = entry.model_dump()
    repository.append_journal(entry_payload)
    lore_sync = _sync_lorebook_or_404(repository, actor_id=actor_id, scene_id=entry.scene_id)
    return {
        **entry_payload,
        "lore_sync": lore_sync,
        "refresh_hints": ["journal", "lorebook"],
    }


@router.post("/journal/session-summary")
def create_session_summary(payload: JournalSessionSummaryCreate, actor_id: str = Query(default="player"), save_id: str = Query(default="default")):
    repository = create_repository(save_id=save_id)
    _require_actor_or_404(repository, actor_id)
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
    lore_sync = _sync_lorebook_or_404(repository, actor_id=actor_id, scene_id=scene_id)
    return {
        "ok": True,
        "entry": entry_payload,
        "lore_sync": lore_sync,
        "refresh_hints": ["events", "journal", "lorebook"],
    }


@router.post("/journal/draft-session-summary")
def draft_session_summary(
    payload: JournalDraftSessionSummaryRequest,
    actor_id: str = Query(default="player"),
    save_id: str = Query(default="default"),
):
    repository = create_repository(save_id=save_id)
    _require_actor_or_404(repository, actor_id)
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages is required and must contain at least one chat message.")

    lm_client = LMStudioClient()
    authoritative_context = _build_session_summary_context(repository, actor_id)
    draft_payload, model = lm_client.generate_session_summary_from_chat(
        chat_title=payload.chat_title,
        messages=[message.model_dump(exclude_none=True) for message in payload.messages],
        authoritative_context=authoritative_context,
        instructions=payload.instructions,
    )
    response = JournalDraftSessionSummaryResponse(
        ok=True,
        chat_title=payload.chat_title,
        scene_id=repository.load_scene_state().get("scene_id"),
        model=model,
        summary=str(draft_payload.get("summary") or "").strip() or "No session summary drafted.",
        durable_facts=[str(fact).strip() for fact in draft_payload.get("durable_facts", []) if str(fact).strip()],
        warnings=[str(warning).strip() for warning in draft_payload.get("warnings", []) if str(warning).strip()],
        source_counts={
            "messages": len(payload.messages),
            "user_messages": sum(1 for message in payload.messages if message.role == "user"),
            "assistant_messages": sum(1 for message in payload.messages if message.role == "assistant"),
        },
    )
    return response.model_dump()
