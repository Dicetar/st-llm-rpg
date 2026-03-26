from fastapi import APIRouter, Query

from app.domain.models import JournalEntry, JournalEntryCreate
from app.services.repository import JsonStateRepository

router = APIRouter(tags=["journal"])
repository = JsonStateRepository()


@router.get("/journal/entries")
def list_journal_entries(limit: int = Query(default=20, ge=1, le=100)):
    return {"entries": repository.list_journal(limit=limit)}


@router.post("/journal/entries")
def create_journal_entry(payload: JournalEntryCreate):
    entry = JournalEntry.create(kind=payload.kind, text=payload.text, tags=payload.tags)
    repository.append_journal(entry.model_dump())
    return entry.model_dump()
