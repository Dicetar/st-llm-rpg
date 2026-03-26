from fastapi import FastAPI

from app.api.commands import router as commands_router
from app.api.health import router as health_router
from app.api.journal import router as journal_router
from app.api.state import router as state_router

app = FastAPI(
    title="ST LLM RPG Backend Skeleton",
    version="0.1.0",
    description="Command-first backend skeleton for a SillyTavern + LM Studio narrative RPG workflow.",
)

app.include_router(health_router)
app.include_router(state_router)
app.include_router(journal_router)
app.include_router(commands_router)
