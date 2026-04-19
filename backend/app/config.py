import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
SEED_DIR = BASE_DIR / "data" / "seed"
RUNTIME_DIR = BASE_DIR / "runtime"
DATA_DIR = RUNTIME_DIR / "data"
STORAGE_DIR = RUNTIME_DIR / "storage"
PROMPTS_DIR = PROJECT_ROOT / "prompts"

REPOSITORY_BACKEND = os.getenv("ST_LLM_RPG_REPOSITORY", "sqlite").strip().lower()
LM_STUDIO_BASE_URL = os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:1234").rstrip("/")
LM_STUDIO_CHAT_COMPLETIONS_PATH = os.getenv("LM_STUDIO_CHAT_COMPLETIONS_PATH", "/v1/chat/completions")
LM_STUDIO_MODEL = os.getenv("LM_STUDIO_MODEL", "").strip()
LM_STUDIO_EXTRACTOR_MODEL = os.getenv("LM_STUDIO_EXTRACTOR_MODEL", "").strip()
LM_STUDIO_API_KEY = (os.getenv("LM_STUDIO_API_KEY") or os.getenv("LM_API_TOKEN") or "").strip()
LM_STUDIO_TIMEOUT_SECONDS = float(os.getenv("LM_STUDIO_TIMEOUT_SECONDS", "45"))
LORE_ACTIVATION_MAX_ENTRIES = int(os.getenv("LORE_ACTIVATION_MAX_ENTRIES", "8"))
LORE_ACTIVATION_MAX_TOTAL_CHARS = int(os.getenv("LORE_ACTIVATION_MAX_TOTAL_CHARS", "6000"))
