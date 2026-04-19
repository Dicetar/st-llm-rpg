from fastapi import APIRouter, Body, HTTPException, Query

from app.domain.models import EventRecord
from app.services.command_engine import CommandEngine
from app.services.lore_update_service import LoreUpdateService
from app.services.repository import create_repository

router = APIRouter(tags=["state"])
repository = create_repository()
engine = CommandEngine(repository)
lore_service = LoreUpdateService(repository)


def _get_actor_or_404(actor_id: str):
    character_state = repository.load_character_state()
    actors = character_state.get("actors", {})
    if actor_id not in actors:
        raise HTTPException(status_code=404, detail=f"Unknown actor_id '{actor_id}'.")
    return actors[actor_id]


@router.get("/state/overview")
def get_state_overview(actor_id: str = Query(default="player")):
    try:
        return engine.build_overview(actor_id).model_dump()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/state/inventory")
def get_inventory(actor_id: str = Query(default="player")):
    actor = _get_actor_or_404(actor_id)
    return {
        "actor_id": actor_id,
        "inventory": actor.get("inventory", {}),
        "item_notes": actor.get("item_notes", {}),
    }


@router.get("/state/actor/detail")
def get_actor_detail(actor_id: str = Query(default="player")):
    try:
        return engine.build_actor_detail(actor_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/state/campaign/detail")
def get_campaign_detail():
    return repository.load_campaign_state()


@router.get("/state/scene/current")
def get_current_scene():
    return repository.load_scene_state()


@router.get("/state/scene/detail")
def get_scene_detail():
    return repository.load_scene_state()


@router.get("/state/scene/archive")
def get_scene_archives(limit: int = Query(default=20, ge=1, le=100)):
    return {"archives": repository.list_scene_archives(limit=limit)}


@router.get("/state/lorebook")
def get_lorebook_state():
    return repository.load_lorebook_state()


@router.get("/state/lorebook/insertion-entries")
def get_lorebook_insertion_entries(
    actor_id: str = Query(default="player"),
    sync: bool = Query(default=True),
):
    try:
        return lore_service.build_insertion_payload(actor_id=actor_id, sync=sync)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/state/lorebook/sync")
def sync_lorebook_state(actor_id: str = Query(default="player")):
    try:
        lore_sync = lore_service.sync_from_canonical_state(actor_id=actor_id, command_results=[], scene_id=None)
        return {
            "ok": True,
            "lore_sync": lore_sync,
            "refresh_hints": ["lorebook"],
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/state/quests")
def get_active_quests():
    campaign_state = repository.load_campaign_state()
    quests = campaign_state.get("quests", {})
    active = {name: payload for name, payload in quests.items() if payload.get("status") == "active"}
    return {"active_quests": active}


@router.get("/state/relationships")
def get_relationships():
    campaign_state = repository.load_campaign_state()
    return {"relationships": campaign_state.get("relationships", {})}


@router.post("/state/quest-note")
def update_quest_note(payload: dict = Body(...)):
    quest_name = str(payload.get("quest_name", "")).strip()
    note = str(payload.get("note", ""))
    actor_id = str(payload.get("actor_id", "player")).strip() or "player"
    if not quest_name:
        raise HTTPException(status_code=400, detail="quest_name is required.")

    campaign_state = repository.load_campaign_state()
    quests = campaign_state.setdefault("quests", {})
    if quest_name not in quests:
        raise HTTPException(status_code=404, detail=f"Unknown quest '{quest_name}'.")

    quest_record = quests[quest_name]
    quest_record["note"] = note

    day_counter = campaign_state.get("date", {}).get("day_counter")
    if day_counter is not None:
        quest_record["last_updated_day"] = day_counter

    repository.save_campaign_state(campaign_state)
    repository.append_event(
        EventRecord.create(
            turn_id=f"turn_state_{quest_name.lower().replace(' ', '_')}",
            actor_id=actor_id,
            scene_id=None,
            command_name="quest_note_update",
            event_type="quest_note_updated",
            source="state_api",
            ok=True,
            message=f"Updated quest note for {quest_name}.",
            payload={"quest_name": quest_name, "note": note},
        ).model_dump()
    )
    try:
        lore_sync = lore_service.sync_from_canonical_state(actor_id=actor_id, command_results=[], scene_id=None)
    except KeyError:
        lore_sync = {}

    return {
        "ok": True,
        "quest_name": quest_name,
        "note": note,
        "lore_sync": lore_sync,
    }


@router.get("/events/recent")
def get_recent_events(limit: int = Query(default=20, ge=1, le=100)):
    return {"events": repository.list_events(limit=limit)}
