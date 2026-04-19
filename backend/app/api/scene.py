from fastapi import APIRouter, HTTPException, Query

from app.domain.models import SceneCloseRequest, SceneDraftCloseSummaryRequest, SceneOpenRequest
from app.services.repository import create_repository
from app.services.scene_service import SceneService

router = APIRouter(tags=["scene"])
repository = create_repository()
scene_service = SceneService(repository)


@router.post("/scene/open")
def open_scene(payload: SceneOpenRequest, actor_id: str = Query(default="player")):
    try:
        return scene_service.open_scene(payload, actor_id=actor_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/scene/close")
def close_scene(payload: SceneCloseRequest, actor_id: str = Query(default="player")):
    try:
        return scene_service.close_scene(payload, actor_id=actor_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/scene/draft-close-summary")
def draft_scene_close_summary(payload: SceneDraftCloseSummaryRequest, actor_id: str = Query(default="player")):
    try:
        return scene_service.draft_close_summary(payload, actor_id=actor_id)
    except (KeyError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail={"error_code": "scene_draft_close_summary_failed", "message": str(exc)}) from exc
