from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.commands import router as commands_router
from app.api.health import router as health_router
from app.api.journal import router as journal_router
from app.api.state import router as state_router

app = FastAPI(
    title="ST LLM RPG Backend Skeleton",
    version="0.1.0",
    description="Command-first backend skeleton for a SillyTavern + LM Studio narrative RPG workflow.",
)

# Allow SillyTavern running locally to call this backend from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:7860",
        "http://localhost:7860",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(state_router)
app.include_router(journal_router)
app.include_router(commands_router)