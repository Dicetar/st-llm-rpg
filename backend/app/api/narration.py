from fastapi import APIRouter, HTTPException

from app.domain.models import NarrationResolveRequest
from app.services.repository import create_repository
from app.services.turn_resolution_service import TurnResolutionService

router = APIRouter(tags=["narration"])
repository = create_repository()
turn_resolution_service = TurnResolutionService(repository)


@router.post("/narration/resolve-turn")
def resolve_turn(payload: NarrationResolveRequest):
    try:
        return turn_resolution_service.resolve_turn(payload).model_dump()
    except (ValueError, KeyError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail={"error_code": "resolve_turn_failed", "message": str(exc)}) from exc
