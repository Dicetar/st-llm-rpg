from pathlib import Path
import shutil

from app.api import journal as journal_api
from app.domain.models import CommandExecutionRequest, JournalSessionSummaryCreate
from app.services.command_engine import CommandEngine
from app.services.lore_update_service import LoreUpdateService
from app.services.repository import JsonStateRepository


def make_repo(tmp_path: Path) -> JsonStateRepository:
    source_root = Path(__file__).resolve().parents[1]
    work_root = tmp_path / "work"
    shutil.copytree(source_root / "data" / "seed", work_root / "data" / "seed")
    return JsonStateRepository(base_dir=work_root)


def test_parse_mixed_commands(tmp_path):
    engine = CommandEngine(make_repo(tmp_path))
    commands = engine.parse_text("I want to /use_item [health potion] and /cast [suggestion]")
    assert [command.name for command in commands] == ["use_item", "cast"]
    assert commands[0].argument == "health potion"
    assert commands[1].argument == "suggestion"


def test_repository_bootstraps_runtime_from_seed(tmp_path):
    repository = make_repo(tmp_path)

    assert repository.data_dir.exists()
    assert repository.storage_dir.exists()
    assert repository.character_state_path.exists()
    assert repository.event_log_path.exists()

    seed_character = (repository.seed_dir / "character_state.safe.json").read_text(encoding="utf-8")
    runtime_character = repository.character_state_path.read_text(encoding="utf-8")
    assert runtime_character == seed_character
    assert repository.list_events() == []
    assert repository.load_lorebook_state()["revision"] == 0


def test_inventory_command_returns_items(tmp_path):
    engine = CommandEngine(make_repo(tmp_path))
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "inventory"}]))
    assert response.results[0].ok is True
    assert "health potion" in response.results[0].data["inventory"]


def test_use_item_backfills_consumable_registry_from_item_notes(tmp_path):
    repository = make_repo(tmp_path)
    item_registry = repository.load_item_registry()
    item_registry["items"].pop("potion of arousal", None)
    repository.save_item_registry(item_registry)

    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "use_item", "argument": "potion of arousal"}]))

    updated_registry = repository.load_item_registry()["items"]["potion of arousal"]
    inventory = repository.load_character_state()["actors"]["player"]["inventory"]

    assert response.results[0].ok is True
    assert response.results[0].argument == "potion of arousal"
    assert updated_registry["consumable"] is True
    assert "potion of arousal" not in inventory
    assert any(mutation.path == "item_registry.items.potion of arousal" for mutation in response.state_changes)


def test_use_item_backfills_consumable_when_kind_contains_comma_separated_tags(tmp_path):
    repository = make_repo(tmp_path)
    character_state = repository.load_character_state()
    actor = character_state["actors"]["player"]
    actor["inventory"]["potion of arousal"] = 10
    actor["item_notes"]["potion of arousal"] = {
        "description": "Amber vial, black-wax seal.",
        "tags": ["consumable, alchemy", "player_defined"],
        "source": "builder_command",
        "active": True,
    }
    repository.save_character_state(character_state)

    item_registry = repository.load_item_registry()
    item_registry["items"]["potion of arousal"] = {
        "name": "potion of arousal",
        "kind": "consumable, alchemy",
        "consumable": False,
        "description": "Amber vial, black-wax seal.",
    }
    repository.save_item_registry(item_registry)

    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "use_item", "argument": "potion of arousal"}]))

    repaired_registry = repository.load_item_registry()["items"]["potion of arousal"]
    remaining_qty = repository.load_character_state()["actors"]["player"]["inventory"]["potion of arousal"]

    assert response.results[0].ok is True
    assert repaired_registry["consumable"] is True
    assert repaired_registry["kind"] == "consumable"
    assert remaining_qty == 9


def test_use_item_explains_when_only_item_note_remains(tmp_path):
    repository = make_repo(tmp_path)
    character_state = repository.load_character_state()
    character_state["actors"]["player"]["inventory"].pop("potion of arousal", None)
    repository.save_character_state(character_state)

    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "use_item", "argument": "potion of arousal"}]))

    assert response.results[0].ok is False
    assert response.results[0].message == "Lavitz Harcourt no longer has 'potion of arousal' in inventory. The item note still exists, but quantity is 0."


def test_cast_suggestion_spends_level_2_slot(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    before = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    seed_before = (repository.seed_dir / "character_state.safe.json").read_text(encoding="utf-8")
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "cast", "argument": "suggestion"}]))
    after = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    seed_after = (repository.seed_dir / "character_state.safe.json").read_text(encoding="utf-8")
    assert response.results[0].ok is True
    assert after == before - 1
    assert seed_after == seed_before


def test_cast_allows_trailing_narrative_text_after_spell_name(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "cast", "argument": "Mage Hand and inspect the desk drawer."}],
        )
    )

    assert response.results[0].ok is True
    assert response.results[0].argument == "mage hand"
    assert response.results[0].message == "Lavitz Harcourt casts cantrip mage hand."


def test_equip_dagger_sets_main_hand(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "equip", "argument": "ceremonial dagger"}]))
    updated = repository.load_character_state()["actors"]["player"]["equipment"]["held"]["main_hand"]
    assert response.results[0].ok is True
    assert updated == "ceremonial dagger"


def test_equip_allows_trailing_narrative_text_after_item_name(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "equip", "argument": "ceremonial dagger and keep it low at my side."}],
        )
    )

    updated = repository.load_character_state()["actors"]["player"]["equipment"]["held"]["main_hand"]

    assert response.results[0].ok is True
    assert response.results[0].argument == "ceremonial dagger"
    assert updated == "ceremonial dagger"


def test_equip_multiple_shirts_auto_shifts_layer_upward(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    state = repository.load_character_state()
    actor = state["actors"]["player"]
    actor["equipment"] = {
        "held": {"main_hand": None, "off_hand": None, "focus": None},
        "worn_items": [],
    }
    actor["inventory"]["linen shirt"] = 2
    repository.save_character_state(state)

    first = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "equip", "argument": "linen shirt"}]))
    second = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "equip", "argument": "linen shirt"}]))
    updated = repository.load_character_state()["actors"]["player"]["equipment"]["worn_items"]
    torso_layers = sorted(
        placement["layer"]
        for entry in updated
        for placement in entry["placements"]
        if placement["region"] == "torso"
    )

    assert first.results[0].ok is True
    assert second.results[0].ok is True
    assert torso_layers == [1, 2]


def test_condition_command_adds_condition_and_refreshes_actor(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)

    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "condition", "argument": "rattled | add"}]))
    updated_actor = repository.load_character_state()["actors"]["player"]

    assert response.results[0].ok is True
    assert response.results[0].message == "Lavitz Harcourt condition 'rattled' added."
    assert "rattled" in updated_actor["conditions"]
    assert "actor" in response.refresh_hints


def test_condition_command_removes_condition_with_action_first_syntax(tmp_path):
    repository = make_repo(tmp_path)
    character_state = repository.load_character_state()
    character_state["actors"]["player"]["conditions"] = ["rattled", "blessed"]
    repository.save_character_state(character_state)
    engine = CommandEngine(repository)

    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "condition", "argument": "remove | rattled"}]))
    updated_actor = repository.load_character_state()["actors"]["player"]

    assert response.results[0].ok is True
    assert response.results[0].message == "Lavitz Harcourt condition 'rattled' removed."
    assert updated_actor["conditions"] == ["blessed"]


def test_new_custom_skill_creates_skill(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "new_custom_skill", "argument": "swimming | 3 | Competent in water movement and breath control."}]))
    updated_state = repository.load_character_state()["actors"]["player"]
    assert response.results[0].ok is True
    assert updated_state["custom_skills"]["swimming"] == 3
    assert "swimming" in updated_state["custom_skill_notes"]


def test_new_spell_registers_spell(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "new_spell", "argument": "feather fall | 1 | Slow the fall of nearby creatures. | transmutation"}]))
    updated_state = repository.load_character_state()["actors"]["player"]
    registry = repository.load_spell_registry()["spells"]
    assert response.results[0].ok is True
    assert "feather_fall" in updated_state["known_spells"]
    assert registry["feather_fall"]["level"] == 1


def test_new_item_adds_inventory_and_note(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "new_item", "argument": "rope | 2 | tool | 50 feet of braided hemp rope."}]))
    updated_state = repository.load_character_state()["actors"]["player"]
    registry = repository.load_item_registry()["items"]
    assert response.results[0].ok is True
    assert updated_state["inventory"]["rope"] == 2
    assert updated_state["item_notes"]["rope"]["description"] == "50 feet of braided hemp rope."
    assert registry["rope"]["kind"] == "tool"


def test_new_item_treats_comma_separated_kind_tokens_as_consumable_tags(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "new_item", "argument": "amber stimulant vial | 2 | consumable, alchemy | Bright tonic."}]))

    updated_state = repository.load_character_state()["actors"]["player"]
    registry = repository.load_item_registry()["items"]["amber stimulant vial"]

    assert response.results[0].ok is True
    assert updated_state["inventory"]["amber stimulant vial"] == 2
    assert updated_state["item_notes"]["amber stimulant vial"]["tags"] == ["consumable", "alchemy", "player_defined"]
    assert registry["kind"] == "consumable"
    assert registry["consumable"] is True


def test_generic_new_dispatches_to_custom_skill(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "new", "argument": "custom_skill | swimming | 4 | Stronger training."}]))
    updated_state = repository.load_character_state()["actors"]["player"]
    assert response.results[0].ok is True
    assert updated_state["custom_skills"]["swimming"] == 4


def test_execute_syncs_lorebook_projection(tmp_path):
    repository = make_repo(tmp_path)
    engine = CommandEngine(repository)
    response = engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "equip", "argument": "ceremonial dagger"}]))
    lorebook = repository.load_lorebook_state()
    actor_entry = lorebook["actors"]["player"]

    assert response.lore_sync["actor_id"] == "player"
    assert actor_entry["held_items"]["main_hand"] == "ceremonial dagger"
    assert any(entry["command_name"] == "equip" for entry in lorebook["timeline"])


def test_manual_lore_sync_picks_up_quest_note_changes(tmp_path):
    repository = make_repo(tmp_path)
    campaign = repository.load_campaign_state()
    campaign["quests"]["House Expectations"]["note"] = "Updated through test sync."
    repository.save_campaign_state(campaign)

    lore_service = LoreUpdateService(repository)
    lore_service.sync_from_canonical_state(actor_id="player", command_results=[])
    lorebook = repository.load_lorebook_state()

    assert lorebook["quests"]["house_expectations"]["note"] == "Updated through test sync."


def test_lorebook_sync_builds_keyword_insertion_entries(tmp_path):
    repository = make_repo(tmp_path)
    actor_name = repository.load_character_state()["actors"]["player"]["name"]
    service = LoreUpdateService(repository)

    sync_result = service.sync_from_canonical_state(actor_id="player", command_results=[])
    payload = service.build_insertion_payload(actor_id="player")
    lorebook = repository.load_lorebook_state()
    entries = lorebook["insertion_entries"]

    assert sync_result["synced_insertion_entries"] >= 10
    assert "actor_player" in entries
    assert actor_name in entries["actor_player"]["keywords"]
    assert "Known spells:" in entries["actor_player"]["content"]
    assert "quest_house_expectations" in entries
    assert "House Expectations" in entries["quest_house_expectations"]["keywords"]
    assert payload["entry_count"] == len(entries)

    world_entries = payload["sillytavern_world_info"]["entries"]
    st_actor_entry = next(entry for entry in world_entries.values() if entry["comment"] == "actor_player")
    assert st_actor_entry["key"] == entries["actor_player"]["keywords"]
    assert st_actor_entry["content"] == entries["actor_player"]["content"]


def test_session_summary_endpoint_updates_journal_and_lorebook_insertions(tmp_path, monkeypatch):
    repository = make_repo(tmp_path)
    monkeypatch.setattr(journal_api, "repository", repository)
    monkeypatch.setattr(journal_api, "lore_service", LoreUpdateService(repository))

    response = journal_api.create_session_summary(
        JournalSessionSummaryCreate(
            summary="Lavitz catalogued the private chamber and chose patience over display.",
            durable_facts=["Lavitz found a moon key in the private chamber."],
            tags=["moon_key", "private_chamber"],
        ),
        actor_id="player",
    )
    journal_entries = repository.list_journal(limit=5)
    events = repository.list_events(limit=5)
    lore_entries = repository.load_lorebook_state()["insertion_entries"]
    session_entry = next(entry for entry in lore_entries.values() if entry["entry_type"] == "journal_session_summary")

    assert response["ok"] is True
    assert response["refresh_hints"] == ["events", "journal", "lorebook"]
    assert journal_entries[0]["kind"] == "session_summary"
    assert events[0]["event_type"] == "session_summary_created"
    assert "moon_key" in session_entry["keywords"]
    assert "Lavitz found a moon key in the private chamber." in session_entry["content"]
