from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SEED_DIR = BASE_DIR / "data" / "seed"
RUNTIME_DIR = BASE_DIR / "runtime"
DATA_DIR = RUNTIME_DIR / "data"
STORAGE_DIR = RUNTIME_DIR / "storage"
