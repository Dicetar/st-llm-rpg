from fastapi import APIRouter, HTTPException, Query

from app.domain.models import CommandExecutionRequest, ParseCommandsRequest, ParseCommandsResponse
from app.services.command_engine import CommandEngine
from app.services.repository import create_repository

router = APIRouter(tags=["commands"])


@router.post("/commands/parse", response_model=ParseCommandsResponse)
def parse_commands(payload: ParseCommandsRequest, save_id: str = Query(default="default")):
    engine = CommandEngine(create_repository(save_id=save_id))
    commands = engine.parse_text(payload.text)
    return ParseCommandsResponse(commands=commands)


@router.post("/commands/execute")
def execute_commands(payload: CommandExecutionRequest, save_id: str = Query(default="default")):
    engine = CommandEngine(create_repository(save_id=save_id))
    try:
        return engine.execute(payload).model_dump()
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail={"error_code": "command_execution_failed", "message": str(exc)}) from exc
