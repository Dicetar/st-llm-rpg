from fastapi import APIRouter, HTTPException, Query

from app.services.command_engine import CommandEngine
from app.services.repository import JsonStateRepository

router = APIRouter(tags=["state"])
repository = JsonStateRepository()
engine = CommandEngine(repository)


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
    actor = _get_actor_or_404(actor_id)
    return {
        "actor_id": actor_id,
        "name": actor.get("name"),
        "attributes": actor.get("attributes", {}),
        "skills": actor.get("skills", {}),
        "custom_skills": actor.get("custom_skills", {}),
        "custom_skill_notes": actor.get("custom_skill_notes", {}),
        "known_spells": actor.get("known_spells", {}),
        "feats": actor.get("feats", {}),
        "equipment": actor.get("equipment", {}),
        "inventory": actor.get("inventory", {}),
        "item_notes": actor.get("item_notes", {}),
        "conditions": actor.get("conditions", []),
        "active_effects": actor.get("active_effects", {}),
        "notes": actor.get("notes", ""),
    }


@router.get("/state/campaign/detail")
def get_campaign_detail():
    return repository.load_campaign_state()


@router.get("/state/scene/current")
def get_current_scene():
    return repository.load_scene_state()


@router.get("/state/scene/detail")
def get_scene_detail():
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
