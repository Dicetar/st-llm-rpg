from fastapi import APIRouter, HTTPException, Query

from app.services.command_engine import CommandEngine
from app.services.repository import JsonStateRepository

router = APIRouter(tags=["state"])
repository = JsonStateRepository()
engine = CommandEngine(repository)


@router.get("/state/overview")
def get_state_overview(actor_id: str = Query(default="player")):
    try:
        return engine.build_overview(actor_id).model_dump()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/state/inventory")
def get_inventory(actor_id: str = Query(default="player")):
    character_state = repository.load_character_state()
    actors = character_state.get("actors", {})
    if actor_id not in actors:
        raise HTTPException(status_code=404, detail=f"Unknown actor_id '{actor_id}'.")
    actor = actors[actor_id]
    return {"actor_id": actor_id, "inventory": actor.get("inventory", {})}


@router.get("/state/scene/current")
def get_current_scene():
    return repository.load_scene_state()


@router.get("/state/quests")
def get_active_quests():
    campaign_state = repository.load_campaign_state()
    quests = campaign_state.get("quests", {})
    active = {name: payload for name, payload in quests.items() if payload.get("status") == "active"}
    return {"active_quests": active}


@router.get("/events/recent")
def get_recent_events(limit: int = Query(default=20, ge=1, le=100)):
    return {"events": repository.list_events(limit=limit)}
