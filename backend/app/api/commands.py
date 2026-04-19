from fastapi import APIRouter, HTTPException

from app.domain.models import CommandExecutionRequest, ParseCommandsRequest, ParseCommandsResponse
from app.services.command_engine import CommandEngine
from app.services.repository import create_repository

router = APIRouter(tags=["commands"])
repository = create_repository()
engine = CommandEngine(repository)


@router.post("/commands/parse", response_model=ParseCommandsResponse)
def parse_commands(payload: ParseCommandsRequest):
    commands = engine.parse_text(payload.text)
    return ParseCommandsResponse(commands=commands)


@router.post("/commands/execute")
def execute_commands(payload: CommandExecutionRequest):
    try:
        return engine.execute(payload).model_dump()
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail={"error_code": "command_execution_failed", "message": str(exc)}) from exc
