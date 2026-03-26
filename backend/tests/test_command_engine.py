from pathlib import Path
import shutil

from app.domain.models import CommandExecutionRequest
from app.services.command_engine import CommandEngine
from app.services.repository import JsonStateRepository


def make_repo(tmp_path: Path) -> JsonStateRepository:
    source_root = Path(__file__).resolve().parents[1]
    work_root = tmp_path / "work"
    shutil.copytree(source_root / "data", work_root / "data")
    shutil.copytree(source_root / "storage", work_root / "storage")
    return JsonStateRepository(base_dir=work_root)


def test_parse_mixed_commands(tmp_path):
    engine = CommandEngine(make_repo(tmp_path))
    commands = engine.parse_text("I want to /use_item [health potion] and /cast [suggestion]")
    assert [command.name for command in commands] == ["use_item", "cast"]
    assert commands[0].argument == "health potion"
    assert commands[1].argument == "suggestion"


def test_inventory_command_returns_items(tmp_path):
    engine = CommandEngine(make_repo(tmp_path))
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "inventory"}]))
    assert response.results[0].ok is True
    assert "health potion" in response.results[0].data["inventory"]


def test_cast_suggestion_spends_level_2_slot(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    before = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "cast", "argument": "suggestion"}]))
    after = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    assert response.results[0].ok is True
    assert after == before - 1


def test_equip_dagger_sets_main_hand(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "equip", "argument": "ceremonial dagger"}]))
    updated = repository.load_character_state()["actors"]["player"]["equipment"]["main_hand"]
    assert response.results[0].ok is True
    assert updated == "ceremonial dagger"
