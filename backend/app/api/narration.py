from fastapi import APIRouter, HTTPException, Query

from app.domain.models import NarrationResolveRequest
from app.services.repository import create_repository
from app.services.turn_resolution_service import TurnResolutionService

router = APIRouter(tags=["narration"])


@router.post("/narration/resolve-turn")
def resolve_turn(payload: NarrationResolveRequest, save_id: str = Query(default="default")):
    turn_resolution_service = TurnResolutionService(create_repository(save_id=save_id))
    try:
        return turn_resolution_service.resolve_turn(payload).model_dump()
    except (ValueError, KeyError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail={"error_code": "resolve_turn_failed", "message": str(exc)}) from exc
