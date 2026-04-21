from __future__ import annotations

from copy import deepcopy
from fastapi import HTTPException
from pathlib import Path
import shutil

from app.api import commands as commands_api
from app.api import journal as journal_api
from app.api import narration as narration_api
from app.api import scene as scene_api
from app.api import state as state_api
from app.domain.models import (
    ChatContextMessage,
    CommandExecutionRequest,
    ExtractionEnvelope,
    ExtractedUpdate,
    JournalDraftSessionSummaryRequest,
    JournalEntry,
    NarrationResolveRequest,
    SceneCloseRequest,
    SceneDraftCloseSummaryRequest,
    SceneOpenRequest,
)
from app.services.command_engine import CommandEngine
from app.services.extraction_service import ExtractionService
from app.services.lore_activation_service import LoreActivationService
from app.services.lm_studio_client import LMStudioClient
from app.services.lore_update_service import LoreUpdateService
from app.services.repository import DEFAULT_SAVE_ID, JsonStateRepository, SqliteStateRepository, create_repository, normalize_save_id
from app.services.scene_service import SceneService
from app.services.turn_resolution_service import TurnResolutionService


def make_work_root(tmp_path: Path, name: str) -> Path:
    source_root = Path(__file__).resolve().parents[1]
    work_root = tmp_path / name
    shutil.copytree(source_root / "data" / "seed", work_root / "data" / "seed")
    return work_root


def make_repo(tmp_path: Path, backend: str, name: str):
    work_root = make_work_root(tmp_path, name)
    if backend == "json":
        return JsonStateRepository(base_dir=work_root)
    if backend == "sqlite":
        return SqliteStateRepository(base_dir=work_root)
    raise ValueError(f"Unsupported backend '{backend}'.")


def patch_api_repository_factory(monkeypatch, work_root: Path, backend: str = "sqlite") -> None:
    def repo_factory(*, base_dir=None, backend: str | None = None, save_id: str | None = None):
        return create_repository(base_dir=work_root, backend=backend or backend_name, save_id=save_id)

    backend_name = backend
    for module in (commands_api, journal_api, narration_api, scene_api, state_api):
        monkeypatch.setattr(module, "create_repository", repo_factory)


def normalize_lorebook(payload: dict) -> dict:
    normalized = deepcopy(payload)
    normalized["updated_at"] = None
    for bucket in ("actors", "items", "quests", "relationships", "locations"):
        for entry in normalized.get(bucket, {}).values():
            if isinstance(entry, dict):
                entry["updated_at"] = None
    for entry in normalized.get("timeline", []):
        entry["id"] = "lore_timeline_entry"
        entry["timestamp"] = None
    return normalized


def normalize_events(events: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for event in events:
        normalized.append(
            {
                "command_name": event.get("command_name"),
                "event_type": event.get("event_type"),
                "source": event.get("source"),
                "ok": event.get("ok"),
                "message": event.get("message"),
                "summary": event.get("summary"),
                "payload": event.get("payload"),
            }
        )
    return normalized


class StubLMStudioClient:
    def __init__(
        self,
        *,
        extracted_updates: list[ExtractedUpdate] | None = None,
        scene_summary: dict | None = None,
        session_summary: dict | None = None,
        narration_error: str | None = None,
        extraction_error: str | None = None,
    ) -> None:
        self.extracted_updates = extracted_updates or []
        self.scene_summary = scene_summary or {
            "summary": "Stub scene summary.",
            "durable_facts": [],
            "warnings": [],
        }
        self.session_summary = session_summary or {
            "summary": "Stub session summary.",
            "durable_facts": [],
            "warnings": [],
        }
        self.narration_error = narration_error
        self.extraction_error = extraction_error
        self.narration_calls: list[dict] = []
        self.extraction_calls: list[dict] = []
        self.scene_summary_calls: list[dict] = []
        self.session_summary_calls: list[dict] = []

    def generate_narration(self, *, player_input: str, narration_context: dict) -> tuple[str, str]:
        self.narration_calls.append(
            {
                "player_input": player_input,
                "narration_context": deepcopy(narration_context),
            }
        )
        if self.narration_error:
            raise RuntimeError(self.narration_error)
        return "Stub narration from LM Studio.", "stub-narrator"

    def extract_updates(self, *, player_input: str, narration_context: dict, prose: str) -> tuple[ExtractionEnvelope, str]:
        self.extraction_calls.append(
            {
                "player_input": player_input,
                "narration_context": deepcopy(narration_context),
                "prose": prose,
            }
        )
        if self.extraction_error:
            raise RuntimeError(self.extraction_error)
        return ExtractionEnvelope(updates=deepcopy(self.extracted_updates)), "stub-extractor"

    def generate_scene_close_summary(
        self,
        *,
        scene_state: dict,
        recent_events: list[dict],
        recent_journal: list[dict],
        instructions: str | None = None,
    ) -> tuple[dict, str]:
        self.scene_summary_calls.append(
            {
                "scene_state": deepcopy(scene_state),
                "recent_events": deepcopy(recent_events),
                "recent_journal": deepcopy(recent_journal),
                "instructions": instructions,
            }
        )
        return deepcopy(self.scene_summary), "stub-scene-summary"

    def generate_session_summary_from_chat(
        self,
        *,
        chat_title: str | None,
        messages: list[dict],
        authoritative_context: dict,
        instructions: str | None = None,
    ) -> tuple[dict, str]:
        self.session_summary_calls.append(
            {
                "chat_title": chat_title,
                "messages": deepcopy(messages),
                "authoritative_context": deepcopy(authoritative_context),
                "instructions": instructions,
            }
        )
        return deepcopy(self.session_summary), "stub-session-summary"


def test_lm_studio_client_builds_bearer_headers_when_api_key_present():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model", api_key="sk-lm-test")

    assert client._build_headers()["Content-Type"] == "application/json"
    assert client._build_headers()["Authorization"] == "Bearer sk-lm-test"


def test_lm_studio_client_caps_narration_completion_tokens(monkeypatch):
    client = LMStudioClient(
        narrator_model="test-model",
        extractor_model="test-model",
        narration_max_tokens=123,
    )
    captured: dict = {}

    def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return "Capped narration."

    monkeypatch.setattr(client, "_chat_completion", fake_chat_completion)

    prose, model = client.generate_narration(
        player_input="I wait for her answer.",
        narration_context={
            "turn_id": "turn_test_cap",
            "actor_id": "player",
            "mode": "commit",
            "failure_policy": "best_effort",
            "scene": {},
            "turn_summary": {},
            "post_command_overview": {},
            "refresh_hints": [],
        },
    )

    assert prose == "Capped narration."
    assert model == "test-model"
    assert captured["max_tokens"] == 123
    assert captured["temperature"] == 0.8


def test_lm_studio_client_can_resolve_current_loaded_model(monkeypatch):
    client = LMStudioClient(narrator_model="current", extractor_model="current")
    monkeypatch.setattr(
        client,
        "_list_models",
        lambda: ["text-embedding-nomic-embed-text-v1.5", "magidonia-24b-v4.3-creative-orpo-v3-i1"],
    )

    assert client._resolve_model("current") == "magidonia-24b-v4.3-creative-orpo-v3-i1"
    assert client._resolve_model("auto") == "magidonia-24b-v4.3-creative-orpo-v3-i1"


def test_lm_studio_client_parses_fenced_json_extractor_content():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model")

    parsed = client._parse_json_content(
        """```json
{"updates":[{"category":"item_change","description":"Lavitz pocketed a marker.","confidence":1.0,"payload":{"item_name":"marker","quantity_delta":1}}]}
```"""
    )

    assert parsed["updates"][0]["category"] == "item_change"
    assert parsed["updates"][0]["payload"]["item_name"] == "marker"


def test_lm_studio_client_normalizes_bare_extractor_array_content():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model")

    parsed = client._parse_json_content(
        """Extraction result:
[
  {"category":"condition_change","description":"Lavitz is rattled.","confidence":0.7,"payload":{"condition":"rattled","action":"add"}},
  {"category":"scene_object_change","description":"The mirror is hidden.","confidence":0.8,"payload":{"object_name":"wall mirror (floor-length)","visible":"hidden"}}
]"""
    )

    assert list(parsed) == ["updates"]
    assert len(parsed["updates"]) == 2
    assert parsed["updates"][1]["payload"]["visible"] == "hidden"


def test_lm_studio_client_recovers_completed_updates_from_truncated_extractor_json():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model")

    parsed = client._parse_json_content(
        """```json
{
  "updates": [
    {
      "category": "condition_change",
      "description": "Lavitz observes active fae transformations.",
      "confidence": 0.9,
      "payload": {
        "condition": "physically transformed with fae features",
        "action": "add"
      }
    },
    {
      "category": "scene_object_change",
      "description": "The draconic musk perfume remains visible.",
      "confidence": 0.8,
      "payload": {
        "object_name": "draconic musk perfume",
        "visible": true
      }
    },
    {
      "category": "item_change",
      "description": "The third update is cut off",
"""
    )

    assert len(parsed["updates"]) == 2
    assert parsed["updates"][0]["category"] == "condition_change"
    assert parsed["updates"][1]["payload"]["object_name"] == "draconic musk perfume"


def test_lm_studio_client_parses_scene_summary_json_shapes_and_prose_fallback():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model")

    fenced = client._parse_scene_summary_content(
        """```json
{"summary":"The balcony parley ended cleanly.","durable_facts":["Lavitz agreed to meet after dusk."],"warnings":[]}
```"""
    )
    plain = client._parse_scene_summary_content(
        '{"scene_summary":"The private audience ended.","facts":"Seraphina kept the moon key;Lavitz noticed the seal","warnings":["review relationship tone"]}'
    )
    prose = client._parse_scene_summary_content("The scene ended with no durable facts established.")

    assert fenced["summary"] == "The balcony parley ended cleanly."
    assert fenced["durable_facts"] == ["Lavitz agreed to meet after dusk."]
    assert plain["summary"] == "The private audience ended."
    assert plain["durable_facts"] == ["Seraphina kept the moon key", "Lavitz noticed the seal"]
    assert plain["warnings"] == ["review relationship tone"]
    assert prose["summary"] == "The scene ended with no durable facts established."
    assert prose["warnings"] == ["model_returned_prose_fallback"]


def test_lm_studio_client_parses_session_summary_json_shapes_and_prose_fallback():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model")

    fenced = client._parse_summary_draft_content(
        """```json
{"summary":"Lavitz tested the fae bargain boundaries.","durable_facts":["Lavitz accepted the bargain."],"warnings":[]}
```"""
    )
    plain = client._parse_summary_draft_content(
        '{"text":"The private quarters conversation established a secret accord.","facts":"Lavitz concealed the moon key;Seraphina gained private access","warnings":["review whether access was explicit"]}'
    )
    prose = client._parse_summary_draft_content("The chat so far established that Lavitz is still in House Harcourt.")

    assert fenced["summary"] == "Lavitz tested the fae bargain boundaries."
    assert fenced["durable_facts"] == ["Lavitz accepted the bargain."]
    assert plain["summary"] == "The private quarters conversation established a secret accord."
    assert plain["durable_facts"] == ["Lavitz concealed the moon key", "Seraphina gained private access"]
    assert plain["warnings"] == ["review whether access was explicit"]
    assert prose["summary"] == "The chat so far established that Lavitz is still in House Harcourt."
    assert prose["warnings"] == ["model_returned_prose_fallback"]


def test_lm_studio_client_compacts_turn_context_for_prompts():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model")

    compact = client._build_compact_turn_context(
        {
            "turn_id": "turn_test_001",
            "actor_id": "player",
            "mode": "commit",
            "failure_policy": "best_effort",
            "scene": {"scene_id": "private_quarters", "location": "Private Quarters"},
            "turn_summary": {"command_count": 1, "success_count": 1, "failure_count": 0, "has_failures": False},
            "post_command_overview": {"current_scene_id": "private_quarters", "inventory": {"moon key": 1}},
            "attempted_post_command_overview": {"current_scene_id": "private_quarters", "inventory": {"moon key": 1}},
            "refresh_hints": ["overview", "inventory"],
            "lore_sync": {"revision": 7, "location_key": "private_quarters"},
            "command_results": [
                {
                    "name": "new_item",
                    "argument": "moon key | 1 | quest | " + ("glint " * 100),
                    "ok": True,
                    "message": "Created item note. " + ("detail " * 100),
                    "mutations": [
                        {
                            "path": "actors.player.inventory.moon key",
                            "kind": "set",
                            "note": "Inventory updated. " + ("note " * 100),
                            "before": 0,
                            "after": 1,
                        }
                    ],
                }
            ],
            "state_changes": [
                {
                    "path": "actors.player.inventory.moon key",
                    "kind": "set",
                    "note": "Inventory updated. " + ("note " * 100),
                    "before": 0,
                    "after": 1,
                }
            ],
        }
    )

    assert "attempted_post_command_overview" not in compact
    assert "lore_sync" not in compact
    assert compact["command_results"][0]["name"] == "new_item"
    assert len(compact["command_results"][0]["message"]) < 285
    assert compact["state_changes"][0]["after"] == 1


def test_lm_studio_client_compacts_activated_lore_entries_for_prompts():
    client = LMStudioClient(narrator_model="test-model", extractor_model="test-model")

    compact = client._compact_lore_entries(
        [
            {
                "id": "journal_session_summary_001",
                "title": "Moon Key Memory",
                "entry_type": "journal_session_summary",
                "content": "The moon key was hidden beside the washbasin. " * 40,
                "keywords": ["moon key", "washbasin"],
                "source_refs": ["journal_001"],
                "match_reasons": ["recent_chat_match", "keyword: moon key", "scene_match", "quest_match", "extra_reason"],
                "constant": False,
            }
        ]
    )

    assert compact[0]["id"] == "journal_session_summary_001"
    assert len(compact[0]["content"]) < 325
    assert compact[0]["match_reasons"] == ["recent_chat_match", "keyword: moon key", "scene_match", "quest_match"]


def test_create_repository_defaults_to_sqlite_runtime_backend(tmp_path):
    work_root = make_work_root(tmp_path, "factory")
    repository = create_repository(base_dir=work_root)
    seed_character_state = (work_root / "data" / "seed" / "character_state.safe.json").read_text(encoding="utf-8")

    assert isinstance(repository, SqliteStateRepository)
    assert repository.database_path.exists()
    assert repository.load_character_state()["actors"]["player"]["name"] in seed_character_state
    assert repository.list_events() == []


def test_create_repository_keeps_default_save_on_legacy_runtime_path(tmp_path):
    work_root = make_work_root(tmp_path, "factory_default_save")
    repository = create_repository(base_dir=work_root, save_id=DEFAULT_SAVE_ID)

    assert isinstance(repository, SqliteStateRepository)
    assert repository.save_id == DEFAULT_SAVE_ID
    assert repository.runtime_dir == work_root / "runtime"
    assert repository.database_path == work_root / "runtime" / "storage" / "state.sqlite3"


def test_create_repository_uses_namespaced_runtime_for_named_saves(tmp_path):
    work_root = make_work_root(tmp_path, "factory_named_save")
    repository = create_repository(base_dir=work_root, save_id="House Harcourt Private Quarters")
    expected_save_id = normalize_save_id("House Harcourt Private Quarters")

    assert isinstance(repository, SqliteStateRepository)
    assert repository.save_id == expected_save_id
    assert repository.runtime_dir == work_root / "runtime" / "saves" / expected_save_id
    assert repository.database_path == work_root / "runtime" / "saves" / expected_save_id / "storage" / "state.sqlite3"


def test_named_save_repositories_do_not_share_state_or_events(tmp_path):
    work_root = make_work_root(tmp_path, "factory_save_isolation")
    alpha_repo = create_repository(base_dir=work_root, save_id="Alpha Save")
    beta_repo = create_repository(base_dir=work_root, save_id="Beta Save")
    alpha_engine = CommandEngine(alpha_repo)

    alpha_engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "new_item", "argument": "chat-bound sigil | 1 | quest | A save-isolated sigil."}],
        )
    )

    alpha_inventory = alpha_repo.load_character_state()["actors"]["player"]["inventory"]
    beta_inventory = beta_repo.load_character_state()["actors"]["player"]["inventory"]

    assert alpha_inventory["chat-bound sigil"] == 1
    assert "chat-bound sigil" not in beta_inventory
    assert len(alpha_repo.list_events(limit=10)) == 1
    assert beta_repo.list_events(limit=10) == []


def test_api_save_id_query_scopes_backend_runtime(tmp_path, monkeypatch):
    work_root = make_work_root(tmp_path, "api_save_scope")
    patch_api_repository_factory(monkeypatch, work_root)
    execute_response = commands_api.execute_commands(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "new_item", "argument": "velvet balcony token | 1 | quest | Save-scoped token."}],
        ),
        save_id="Velvet Balcony",
    )
    alpha_inventory = state_api.get_inventory(actor_id="player", save_id="Velvet Balcony")
    beta_inventory = state_api.get_inventory(actor_id="player", save_id="Moonlit Gallery")
    alpha_events = state_api.get_recent_events(limit=20, save_id="Velvet Balcony")
    beta_events = state_api.get_recent_events(limit=20, save_id="Moonlit Gallery")

    assert execute_response["results"][0]["ok"] is True
    assert alpha_inventory["inventory"]["velvet balcony token"] == 1
    assert "velvet balcony token" not in beta_inventory["inventory"]
    assert len(alpha_events["events"]) == 1
    assert beta_events["events"] == []


def test_repository_parity_between_json_and_sqlite_for_command_sequence(tmp_path):
    json_repo = make_repo(tmp_path, "json", "json_runtime")
    sqlite_repo = make_repo(tmp_path, "sqlite", "sqlite_runtime")

    def run_sequence(repository):
        engine = CommandEngine(repository)
        responses = [
            engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "cast", "argument": "suggestion"}])),
            engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "equip", "argument": "ceremonial dagger"}])),
            engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "new_item", "argument": "rope | 2 | tool | 50 feet of braided hemp rope."}])),
        ]
        return {
            "messages": [response.results[0].message for response in responses],
            "state_changes": [[mutation.model_dump() for mutation in response.state_changes] for response in responses],
            "overview": responses[-1].overview.model_dump(),
            "character_state": repository.load_character_state(),
            "item_registry": repository.load_item_registry(),
            "lorebook_state": normalize_lorebook(repository.load_lorebook_state()),
            "events": normalize_events(repository.list_events(limit=10)),
        }

    assert run_sequence(json_repo) == run_sequence(sqlite_repo)


def test_execute_dry_run_does_not_persist_mutations_or_events(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "dry_run")
    engine = CommandEngine(repository)
    before_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "cast", "argument": "suggestion"}],
            mode="dry_run",
        )
    )

    after_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    assert response.mode == "dry_run"
    assert response.turn_id.startswith("turn_")
    assert response.results[0].ok is True
    assert any(change.path.endswith("spell_slots.2") for change in response.state_changes)
    assert {"actor", "events", "inventory", "overview"}.issubset(set(response.refresh_hints))
    assert response.command_count == 1
    assert response.success_count == 1
    assert response.failure_count == 0
    assert response.has_failures is False
    assert response.lore_sync == {}
    assert response.narration_context["turn_summary"]["failure_count"] == 0
    assert after_slots == before_slots
    assert repository.list_events() == []
    assert repository.load_lorebook_state()["revision"] == 0


def test_execute_without_explicit_scene_id_uses_current_scene_for_events(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "scene_event_fallback")
    engine = CommandEngine(repository)
    current_scene_id = repository.load_scene_state()["scene_id"]

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "inventory"}],
        )
    )

    events = repository.list_events(limit=10)

    assert response.command_count == 1
    assert response.success_count == 1
    assert response.failure_count == 0
    assert response.has_failures is False
    assert events[0]["scene_id"] == current_scene_id


def test_parse_bracketed_command_ignores_trailing_narrative_text(tmp_path):
    engine = CommandEngine(make_repo(tmp_path, "sqlite", "parse_tail"))

    commands = engine.parse_text(
        "I quietly /new_item [live smoke marker | 1 | misc | Temporary dry-run item for backend resolve-turn verification.] and keep my voice low."
    )

    assert len(commands) == 1
    assert commands[0].name == "new_item"
    assert commands[0].argument == "live smoke marker | 1 | misc | Temporary dry-run item for backend resolve-turn verification."


def test_execute_commits_turn_contract_and_event_log(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "command_contract")
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            text="/cast [suggestion]",
        )
    )

    events = repository.list_events()
    assert response.turn_id.startswith("turn_")
    assert response.mode == "commit"
    assert response.results[0].name == "cast"
    assert response.state_changes
    assert {"actor", "events", "inventory", "overview"}.issubset(set(response.refresh_hints))
    assert len(events) == 1
    assert events[0]["turn_id"] == response.turn_id
    assert events[0]["event_type"] == "command_execution"
    assert events[0]["source"] == "command_engine:commit"
    assert events[0]["payload"]["error_code"] is None


def test_turn_resolution_service_uses_stub_lm_client_without_live_server(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "turn_resolution")
    lm_client = StubLMStudioClient()
    service = TurnResolutionService(repository, lm_client=lm_client)

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I quietly /equip [ceremonial dagger] before speaking.",
        )
    )

    assert response.prose == "Stub narration from LM Studio."
    assert response.narrator_model == "stub-narrator"
    assert response.extractor_model is None
    assert response.results[0].name == "equip"
    assert lm_client.narration_calls[0]["player_input"] == "I quietly /equip [ceremonial dagger] before speaking."
    assert lm_client.narration_calls[0]["narration_context"]["turn_id"] == response.turn_id
    assert repository.list_events(limit=10)[0]["turn_id"] == response.turn_id


def test_turn_resolution_returns_fallback_prose_when_narration_fails_after_commit(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "turn_resolution_narration_fallback")
    lm_client = StubLMStudioClient(narration_error="LM Studio request failed: timed out")
    service = TurnResolutionService(repository, lm_client=lm_client)
    before_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I steady myself and /cast [suggestion] before answering.",
        )
    )

    after_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    events = repository.list_events(limit=10)

    assert response.narrator_model is None
    assert response.results[0].name == "cast"
    assert response.results[0].ok is True
    assert response.prose.startswith("The backend applied this turn, but live narration was unavailable.")
    assert any(warning.stage == "narration" for warning in response.warnings)
    assert after_slots == before_slots - 1
    assert len(events) == 1
    assert events[0]["turn_id"] == response.turn_id


def test_turn_resolution_includes_recent_chat_messages_in_narration_context(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "turn_resolution_chat_context")
    lm_client = StubLMStudioClient()
    service = TurnResolutionService(repository, lm_client=lm_client)

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I ask if the key is still in the chamber.",
            recent_chat_messages=[
                ChatContextMessage(role="assistant", name="Narrator", content="The moon key glints beside the washbasin."),
                ChatContextMessage(role="user", name="Player", content="I move closer and study it."),
            ],
        )
    )

    recent_chat = lm_client.narration_calls[0]["narration_context"]["recent_chat_messages"]

    assert response.prose == "Stub narration from LM Studio."
    assert len(recent_chat) == 2
    assert recent_chat[0]["content"] == "The moon key glints beside the washbasin."
    assert recent_chat[1]["content"] == "I move closer and study it."


def test_turn_resolution_ignores_frontend_only_wrapper_commands_in_mixed_prose(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "turn_resolution_frontend_wrapper")
    lm_client = StubLMStudioClient()
    service = TurnResolutionService(repository, lm_client=lm_client)

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I /cast Mage Hand and nudge the curtain aside and /rpg_resolve inspect his reaction.",
        )
    )

    assert response.command_count == 1
    assert response.failure_count == 0
    assert response.results[0].name == "cast"
    assert response.results[0].ok is True
    assert response.results[0].argument == "mage hand"
    assert lm_client.narration_calls[0]["player_input"] == "I /cast Mage Hand and nudge the curtain aside and inspect his reaction."


def test_lore_activation_service_selects_scene_actor_and_matching_entries(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "lore_activation")
    command_engine = CommandEngine(repository)
    activation_service = LoreActivationService(repository)

    execution = command_engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "scene_move", "argument": "Private Quarters | house_private_quarters | morning | 1"}],
        )
    )
    selected = activation_service.select_entries(
        actor_id="player",
        player_input="I inspect the private quarters and think about House Expectations.",
        execution=execution,
    )
    selected_ids = {entry.id for entry in selected}

    assert "actor_player" in selected_ids
    assert "scene_house_private_quarters" in selected_ids
    assert "campaign_state" in selected_ids
    assert "quest_house_expectations" in selected_ids
    assert any("mandatory_scene_context" in entry.match_reasons for entry in selected if entry.id == "scene_house_private_quarters")
    assert len(selected) <= activation_service.max_entries


def test_turn_resolution_exposes_activated_lore_entries_and_journal_memory(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "turn_resolution_activation")
    repository.append_journal(
        JournalEntry.create(
            kind="session_summary",
            text="Lavitz identified a moon key hidden in the private chamber.",
            tags=["moon_key", "private_chamber"],
            scene_id=repository.load_scene_state()["scene_id"],
            metadata={"durable_facts": ["Lavitz identified a moon key hidden in the private chamber."]},
        ).model_dump()
    )
    LoreUpdateService(repository).sync_from_canonical_state(actor_id="player", command_results=[])
    lm_client = StubLMStudioClient()
    service = TurnResolutionService(repository, lm_client=lm_client)

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I search the private chamber for the moon key.",
        )
    )
    activated_ids = {entry.id for entry in response.activated_lore_entries}

    assert response.activated_lore_entries
    assert "actor_player" in activated_ids
    assert any(entry.entry_type == "journal_session_summary" for entry in response.activated_lore_entries)
    assert lm_client.narration_calls[0]["narration_context"]["activated_lore_entries"]
    assert lm_client.narration_calls[0]["narration_context"]["lore_activation"]["selected_count"] == len(response.activated_lore_entries)


def test_lore_activation_can_use_recent_chat_context_for_memory_match(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "lore_activation_chat_match")
    repository.append_journal(
        JournalEntry.create(
            kind="session_summary",
            text="The moon key is hidden in the private chamber.",
            tags=["moon_key", "private_chamber"],
            scene_id=repository.load_scene_state()["scene_id"],
            metadata={"durable_facts": ["The moon key is hidden in the private chamber."]},
        ).model_dump()
    )
    LoreUpdateService(repository).sync_from_canonical_state(actor_id="player", command_results=[])
    execution = CommandEngine(repository).execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "inventory"}]))

    selected = LoreActivationService(repository).select_entries(
        actor_id="player",
        player_input="I pick it up.",
        execution=execution,
        recent_chat_messages=[{"role": "assistant", "content": "The moon key is hidden in the private chamber.", "name": "Narrator"}],
    )

    assert any(entry.entry_type == "journal_session_summary" for entry in selected)


def test_turn_resolution_passes_rollback_policy_into_command_execution(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "turn_resolution_rollback")
    lm_client = StubLMStudioClient()
    service = TurnResolutionService(repository, lm_client=lm_client)
    before_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I try to /cast [suggestion] and /unknown_command [anything].",
            failure_policy="rollback_on_failure",
        )
    )

    after_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    assert response.failure_policy == "rollback_on_failure"
    assert response.rolled_back is True
    assert response.committed is False
    assert response.discarded_state_changes
    assert after_slots == before_slots
    assert lm_client.narration_calls[0]["narration_context"]["turn_summary"]["rolled_back"] is True


def test_quest_update_command_upserts_quest_and_journal(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "quest_update")
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "quest_update", "argument": "Courtship Pressure | Maintain a graceful mask at dinner. | active | dinner_audience"}],
        )
    )

    campaign_state = repository.load_campaign_state()
    journal_entries = repository.list_journal(limit=10)

    assert response.results[0].ok is True
    assert response.results[0].data["created"] is True
    assert campaign_state["quests"]["Courtship Pressure"]["note"] == "Maintain a graceful mask at dinner."
    assert campaign_state["quests"]["Courtship Pressure"]["current_stage"] == "dinner_audience"
    assert {"quests", "campaign", "journal"}.issubset(set(response.refresh_hints))
    assert any(entry["kind"] == "quest_update" for entry in journal_entries)


def test_relationship_note_command_updates_relationship_and_journal(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "relationship_note")
    engine = CommandEngine(repository)
    before_score = repository.load_campaign_state()["relationships"]["Lyra"]["score"]

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "relationship_note", "argument": "Lyra | Her attention feels deliberate rather than casual. | 5"}],
        )
    )

    campaign_state = repository.load_campaign_state()
    journal_entries = repository.list_journal(limit=10)

    assert response.results[0].ok is True
    assert campaign_state["relationships"]["Lyra"]["note"] == "Her attention feels deliberate rather than casual."
    assert campaign_state["relationships"]["Lyra"]["score"] == before_score + 5
    assert {"relationships", "campaign", "journal"}.issubset(set(response.refresh_hints))
    assert any(entry["kind"] == "relationship_note" for entry in journal_entries)


def test_scene_move_command_updates_scene_state_and_journal(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "scene_move")
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "scene_move", "argument": "South Gate Landing | south_gate_landing | dusk | 3"}],
        )
    )

    scene_state = repository.load_scene_state()
    journal_entries = repository.list_journal(limit=10)

    assert response.results[0].ok is True
    assert scene_state["location"] == "South Gate Landing"
    assert scene_state["scene_id"] == "south_gate_landing"
    assert scene_state["time_of_day"] == "dusk"
    assert scene_state["tension_level"] == 3
    assert {"scene", "campaign", "journal", "events", "overview"}.issubset(set(response.refresh_hints))
    assert any(entry["kind"] == "note" and "Scene moved to South Gate Landing." in entry["text"] for entry in journal_entries)


def test_scene_commands_update_objects_clues_hazards_and_discoveries(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "scene_updates")
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[
                {
                    "name": "scene_object",
                    "argument": "Moonlit Balcony | A narrow balcony open to the night air. | visible | balcony,night | 2 | open",
                },
                {"name": "scene_clue", "argument": "Wet footprints near the railing"},
                {"name": "scene_hazard", "argument": "Loose stone underfoot"},
                {"name": "scene_discovery", "argument": "The balcony overlooks the south garden"},
            ],
        )
    )

    scene_state = repository.load_scene_state()
    journal_entries = repository.list_journal(limit=10)

    assert all(result.ok for result in response.results)
    assert "Moonlit Balcony" in scene_state["notable_objects"]
    assert scene_state["notable_object_details"]["Moonlit Balcony"]["description"] == "A narrow balcony open to the night air."
    assert scene_state["notable_object_details"]["Moonlit Balcony"]["tags"] == ["balcony", "night"]
    assert scene_state["notable_object_details"]["Moonlit Balcony"]["importance"] == 2
    assert scene_state["notable_object_details"]["Moonlit Balcony"]["state"] == "open"
    assert "Wet footprints near the railing" in scene_state["visible_clues"]
    assert "Loose stone underfoot" in scene_state["active_hazards"]
    assert "The balcony overlooks the south garden" in scene_state["recent_discoveries"]
    assert {"scene", "campaign", "journal", "events", "overview"}.issubset(set(response.refresh_hints))
    assert sum(1 for entry in journal_entries if entry["kind"] == "note" and "Scene" in entry["text"]) >= 4


def test_multi_command_commit_keeps_successes_and_records_failures(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "partial_failure")
    engine = CommandEngine(repository)
    before_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[
                {"name": "cast", "argument": "suggestion"},
                {"name": "unknown_command", "argument": "anything"},
            ],
        )
    )

    events = repository.list_events(limit=10)
    after_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    assert response.results[0].ok is True
    assert response.results[1].ok is False
    assert response.results[1].error_code == "unknown_command_failed"
    assert response.command_count == 2
    assert response.success_count == 1
    assert response.failure_count == 1
    assert response.has_failures is True
    assert response.narration_context["turn_summary"]["has_failures"] is True
    assert after_slots == before_slots - 1
    assert len(events) == 2
    assert events[0]["turn_id"] == response.turn_id
    assert events[1]["turn_id"] == response.turn_id


def test_multi_command_rollback_policy_discards_successful_mutations_on_failure(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "rollback_on_failure")
    engine = CommandEngine(repository)
    before_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    before_scene = repository.load_scene_state()

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            failure_policy="rollback_on_failure",
            commands=[
                {"name": "cast", "argument": "suggestion"},
                {"name": "scene_move", "argument": "South Gate Landing | south_gate_landing | dusk | 3"},
                {"name": "unknown_command", "argument": "anything"},
            ],
        )
    )

    after_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]
    after_scene = repository.load_scene_state()
    events = repository.list_events(limit=10)

    assert response.has_failures is True
    assert response.rolled_back is True
    assert response.committed is False
    assert response.state_changes == []
    assert response.discarded_state_changes
    assert response.overview.current_scene_id == before_scene["scene_id"]
    assert response.narration_context["turn_summary"]["rolled_back"] is True
    assert response.narration_context["discarded_state_changes"]
    assert after_slots == before_slots
    assert after_scene == before_scene
    assert len(events) == 1
    assert events[0]["event_type"] == "turn_rolled_back"
    assert events[0]["scene_id"] == before_scene["scene_id"]
    assert events[0]["payload"]["failure_policy"] == "rollback_on_failure"
    assert events[0]["payload"]["discarded_mutations"]


def test_dry_run_with_failures_does_not_emit_rollback_event(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "dry_run_failure_policy")
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            mode="dry_run",
            failure_policy="rollback_on_failure",
            commands=[
                {"name": "cast", "argument": "suggestion"},
                {"name": "unknown_command", "argument": "anything"},
            ],
        )
    )

    assert response.has_failures is True
    assert response.rolled_back is False
    assert response.committed is False
    assert response.state_changes
    assert repository.list_events(limit=10) == []


def test_scene_move_event_uses_updated_scene_id(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "scene_move_event")
    engine = CommandEngine(repository)

    response = engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            commands=[{"name": "scene_move", "argument": "South Gate Landing | south_gate_landing | dusk | 3"}],
        )
    )

    event = repository.list_events(limit=10)[0]

    assert response.overview.current_scene_id == "south_gate_landing"
    assert event["scene_id"] == "south_gate_landing"


def test_extraction_service_applies_safe_updates_and_stages_unsafe_updates(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "extraction")
    service = ExtractionService(repository)

    result = service.apply_updates(
        turn_id="turn_extract_001",
        actor_id="player",
        scene_id="court_side_chamber",
        mode="commit",
        updates=[
            ExtractedUpdate(
                category="item_change",
                description="Seraphina recovered a moon key.",
                payload={
                    "item_name": "moon key",
                    "quantity_delta": 1,
                    "description": "A crescent-shaped brass key recovered from the chamber floor.",
                    "kind": "quest",
                },
            ),
            ExtractedUpdate(
                category="relationship_shift",
                description="Lavitz seems more willing to trust Seraphina after the exchange.",
                payload={"target_name": "Lavitz", "note": "Trust improved after the exchange."},
            ),
        ],
    )

    character_state = repository.load_character_state()["actors"]["player"]
    journal_entries = repository.list_journal(limit=10)
    events = repository.list_events(limit=10)

    assert character_state["inventory"]["moon key"] == 1
    assert len(result["applied_updates"]) == 3
    assert len(result["staged_updates"]) == 1
    assert {"actor", "inventory", "overview"}.issubset(set(result["refresh_hints"]))
    assert any(entry["kind"] == "relationship_note" for entry in journal_entries)
    assert any(event["event_type"] == "extracted_update_applied" for event in events)
    assert any(event["event_type"] == "extracted_update_staged" for event in events)
    assert next(event for event in events if event["event_type"] == "extracted_update_staged")["payload"]["reason"] == "unsafe_category"


def test_extraction_service_marks_consumable_item_registry_entries(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "extraction_consumable_registry")
    service = ExtractionService(repository)

    result = service.apply_updates(
        turn_id="turn_extract_consumable_001",
        actor_id="player",
        scene_id=None,
        mode="commit",
        updates=[
            ExtractedUpdate(
                category="item_change",
                description="Lavitz pockets an amber stimulant vial.",
                payload={
                    "item_name": "amber stimulant vial",
                    "quantity_delta": 1,
                    "description": "A bright tonic that heightens sensation for a short span.",
                    "kind": "consumable",
                },
            )
        ],
    )

    registry_entry = repository.load_item_registry()["items"]["amber stimulant vial"]

    assert result["applied_updates"]
    assert registry_entry["consumable"] is True
    assert registry_entry["narration_hint"] == "A bright tonic that heightens sensation for a short span."


def test_extraction_service_uses_current_scene_when_scene_id_missing(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "extraction_scene_fallback")
    service = ExtractionService(repository)
    current_scene_id = repository.load_scene_state()["scene_id"]

    result = service.apply_updates(
        turn_id="turn_extract_scene_001",
        actor_id="player",
        scene_id=None,
        mode="commit",
        updates=[
            ExtractedUpdate(
                category="relationship_shift",
                description="Lavitz seems less guarded after the exchange.",
                payload={"target_name": "Lavitz", "note": "Less guarded after the exchange."},
            ),
        ],
    )

    events = repository.list_events(limit=10)
    journal_entries = repository.list_journal(limit=10)

    assert result["staged_updates"]
    assert result["lore_sync"]["location_key"] == current_scene_id
    assert events[0]["scene_id"] == current_scene_id
    assert journal_entries[0]["scene_id"] == current_scene_id


def test_extraction_service_stages_invalid_safe_update_with_reason(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "extraction_validation_reason")
    service = ExtractionService(repository)

    result = service.apply_updates(
        turn_id="turn_extract_invalid_001",
        actor_id="player",
        scene_id=None,
        mode="commit",
        updates=[
            ExtractedUpdate(
                category="item_change",
                description="The model proposed an invalid quantity.",
                payload={"item_name": "moon key", "quantity_delta": "not-a-number"},
            )
        ],
    )

    events = repository.list_events(limit=10)
    journal_entries = repository.list_journal(limit=10)

    assert result["applied_updates"] == []
    assert len(result["staged_updates"]) == 1
    assert {"events", "journal"}.issubset(set(result["refresh_hints"]))
    assert events[0]["event_type"] == "extracted_update_staged"
    assert events[0]["payload"]["reason"].startswith("validation_error:")
    assert journal_entries[0]["metadata"]["reason"].startswith("validation_error:")


def test_extraction_service_coerces_scene_object_visible_strings(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "extraction_visible_string")
    service = ExtractionService(repository)

    result = service.apply_updates(
        turn_id="turn_extract_visible_001",
        actor_id="player",
        scene_id=None,
        mode="commit",
        updates=[
            ExtractedUpdate(
                category="scene_object_change",
                description="The mirror is covered and no longer useful.",
                payload={
                    "object_name": "wall mirror (floor-length)",
                    "description": "The mirror has been covered by a heavy cloth.",
                    "visible": "hidden",
                },
            )
        ],
    )

    scene_state = repository.load_scene_state()

    assert "wall mirror (floor-length)" not in scene_state["notable_objects"]
    assert scene_state["notable_object_details"]["wall mirror (floor-length)"]["active"] is False
    assert scene_state["notable_object_details"]["wall mirror (floor-length)"]["description"] == "The mirror has been covered by a heavy cloth."
    assert len(result["applied_updates"]) == 2
    assert {"scene", "overview"}.issubset(set(result["refresh_hints"]))


def test_extraction_service_skips_noop_condition_change(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "extraction_noop_condition")
    service = ExtractionService(repository)
    before_conditions = list(repository.load_character_state()["actors"]["player"].get("conditions", []))

    result = service.apply_updates(
        turn_id="turn_extract_noop_001",
        actor_id="player",
        scene_id=None,
        mode="commit",
        updates=[
            ExtractedUpdate(
                category="condition_change",
                description="The model tried to remove a condition that is not present.",
                payload={"condition": "nonexistent", "action": "remove"},
            )
        ],
    )

    assert result["applied_updates"] == []
    assert result["staged_updates"] == []
    assert result["refresh_hints"] == []
    assert repository.load_character_state()["actors"]["player"].get("conditions", []) == before_conditions
    assert repository.list_events(limit=10) == []


def test_turn_resolution_with_extraction_returns_proposed_applied_and_staged_updates(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "resolve_with_extraction")
    lm_client = StubLMStudioClient(
        extracted_updates=[
            ExtractedUpdate(
                category="item_change",
                description="Seraphina pockets a silver whistle.",
                payload={
                    "item_name": "silver whistle",
                    "quantity_delta": 1,
                    "description": "A narrow whistle etched with warding runes.",
                    "kind": "tool",
                },
            ),
            ExtractedUpdate(
                category="relationship_shift",
                description="Lavitz relaxes slightly around Seraphina.",
                payload={"target_name": "Lavitz", "note": "Less guarded after the scene."},
            ),
        ]
    )
    service = TurnResolutionService(repository, lm_client=lm_client)

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I pocket the whistle and try to earn Lavitz's trust.",
            include_extraction=True,
        )
    )

    assert response.prose == "Stub narration from LM Studio."
    assert response.extractor_model == "stub-extractor"
    assert len(response.proposed_updates) == 2
    assert len(response.applied_updates) == 3
    assert len(response.staged_updates) == 1
    assert {"actor", "inventory", "overview"}.issubset(set(response.refresh_hints))
    assert repository.load_character_state()["actors"]["player"]["inventory"]["silver whistle"] == 1
    assert any(entry["kind"] == "relationship_note" for entry in repository.list_journal(limit=10))


def test_turn_resolution_keeps_prose_when_extraction_fails(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "resolve_with_extraction_failure")
    lm_client = StubLMStudioClient(extraction_error="Extractor response was not valid JSON: not json")
    service = TurnResolutionService(repository, lm_client=lm_client)
    before_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I /cast [suggestion] and wait for their reaction.",
            include_extraction=True,
        )
    )

    after_slots = repository.load_character_state()["actors"]["player"]["spell_slots"]["2"]

    assert response.prose == "Stub narration from LM Studio."
    assert response.narrator_model == "stub-narrator"
    assert response.extractor_model is None
    assert response.results[0].name == "cast"
    assert response.results[0].ok is True
    assert response.proposed_updates == []
    assert response.applied_updates == []
    assert response.staged_updates == []
    assert any(warning.stage == "extraction" for warning in response.warnings)
    assert after_slots == before_slots - 1


def test_turn_resolution_dry_run_with_extraction_returns_no_lore_sync(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "resolve_dry_run_extraction")
    lm_client = StubLMStudioClient(
        extracted_updates=[
            ExtractedUpdate(
                category="item_change",
                description="Seraphina pockets a temporary marker.",
                payload={
                    "item_name": "temporary marker",
                    "quantity_delta": 1,
                    "description": "A throwaway dry-run marker.",
                    "kind": "misc",
                },
            ),
        ]
    )
    service = TurnResolutionService(repository, lm_client=lm_client)
    before_inventory = deepcopy(repository.load_character_state()["actors"]["player"]["inventory"])

    response = service.resolve_turn(
        NarrationResolveRequest(
            actor_id="player",
            text="I pocket a temporary marker.",
            include_extraction=True,
            mode="dry_run",
        )
    )

    after_inventory = repository.load_character_state()["actors"]["player"]["inventory"]

    assert response.lore_sync == {}
    assert response.command_count == 0
    assert response.failure_count == 0
    assert response.has_failures is False
    assert after_inventory == before_inventory
    assert repository.list_events(limit=10) == []


def test_scene_service_open_and_close_archives_scene_and_promotes_durable_facts(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "scene_service")
    service = SceneService(repository)

    open_result = service.open_scene(
        SceneOpenRequest(
            scene_id="market_square_evening",
            location="Market Square",
            time_of_day="Evening",
            nearby_npcs=["Lavitz"],
            notable_objects=["fountain"],
            visible_clues=["broken seal"],
            exits=["South Gate", "Glass Alley"],
            scene_tags=["urban", "social"],
            tension_level=2,
        )
    )
    close_result = service.close_scene(
        SceneCloseRequest(
            summary="The market quieted, and Seraphina secured a follow-up meeting with Lavitz.",
            durable_facts=["Lavitz agreed to meet Seraphina again after dusk."],
            next_scene=SceneOpenRequest(
                scene_id="inn_common_room",
                location="Common Room",
                time_of_day="Night",
                nearby_npcs=["Innkeeper"],
                notable_objects=["hearth"],
                exits=["Guest Rooms", "Back Door"],
                scene_tags=["interior", "rest"],
                tension_level=1,
            ),
        )
    )

    archives = repository.list_scene_archives(limit=10)
    journal_entries = repository.list_journal(limit=10)
    current_scene = repository.load_scene_state()
    events = repository.list_events(limit=10)

    assert open_result["scene"]["scene_id"] == "market_square_evening"
    assert {"overview", "scene", "events", "campaign"}.issubset(set(open_result["refresh_hints"]))
    assert close_result["closed_scene"]["scene_id"] == "market_square_evening"
    assert close_result["next_scene"]["scene_id"] == "inn_common_room"
    assert {"overview", "scene", "events", "journal", "campaign", "scene_archive"}.issubset(set(close_result["refresh_hints"]))
    assert archives[0]["scene_id"] == "market_square_evening"
    assert current_scene["scene_id"] == "inn_common_room"
    assert any(entry["kind"] == "scene_summary" for entry in journal_entries)
    assert any(entry["kind"] == "canon_fact" for entry in journal_entries)
    assert any(event["event_type"] == "scene_opened" for event in events)
    assert any(event["event_type"] == "scene_closed" for event in events)


def test_scene_service_draft_close_summary_does_not_mutate_repository(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "scene_draft_summary")
    lm_client = StubLMStudioClient(
        scene_summary={
            "summary": "The private audience ended with Lavitz still composed.",
            "durable_facts": ["Lavitz remained in House Harcourt private quarters."],
            "warnings": ["Review emotional interpretation before promoting."],
        }
    )
    service = SceneService(repository, lm_client=lm_client)
    before_scene = deepcopy(repository.load_scene_state())
    before_events = deepcopy(repository.list_events(limit=20))
    before_journal = deepcopy(repository.list_journal(limit=20))
    before_archives = deepcopy(repository.list_scene_archives(limit=20))
    before_lorebook = normalize_lorebook(repository.load_lorebook_state())

    result = service.draft_close_summary(
        SceneDraftCloseSummaryRequest(
            instructions="Keep only explicit facts.",
            recent_event_limit=5,
            recent_journal_limit=5,
        )
    )

    assert result["ok"] is True
    assert result["scene_id"] == before_scene["scene_id"]
    assert result["model"] == "stub-scene-summary"
    assert result["summary"] == "The private audience ended with Lavitz still composed."
    assert result["durable_facts"] == ["Lavitz remained in House Harcourt private quarters."]
    assert result["source_counts"] == {"events": 0, "raw_events": 0, "journal_entries": 0}
    assert result["warnings"] == ["low_context_no_recent_events", "Review emotional interpretation before promoting."]
    assert lm_client.scene_summary_calls[0]["instructions"] == "Keep only explicit facts."
    assert lm_client.scene_summary_calls[0]["scene_state"] == before_scene
    assert repository.load_scene_state() == before_scene
    assert repository.list_events(limit=20) == before_events
    assert repository.list_journal(limit=20) == before_journal
    assert repository.list_scene_archives(limit=20) == before_archives
    assert normalize_lorebook(repository.load_lorebook_state()) == before_lorebook


def test_scene_service_draft_summary_ignores_readonly_and_rollback_events(tmp_path):
    repository = make_repo(tmp_path, "sqlite", "scene_draft_filters")
    engine = CommandEngine(repository)
    engine.execute(CommandExecutionRequest(actor_id="player", commands=[{"name": "inventory"}]))
    engine.execute(
        CommandExecutionRequest(
            actor_id="player",
            failure_policy="rollback_on_failure",
            commands=[
                {"name": "cast", "argument": "suggestion"},
                {"name": "unknown_command", "argument": "anything"},
            ],
        )
    )
    lm_client = StubLMStudioClient(scene_summary={"summary": "Filtered draft.", "durable_facts": [], "warnings": []})
    service = SceneService(repository, lm_client=lm_client)

    result = service.draft_close_summary(SceneDraftCloseSummaryRequest(recent_event_limit=10, recent_journal_limit=0))

    assert result["source_counts"]["raw_events"] == 2
    assert result["source_counts"]["events"] == 0
    assert "ignored_2_non_substantive_event(s)" in result["warnings"]
    assert "low_context_no_substantive_events" in result["warnings"]
    assert lm_client.scene_summary_calls[0]["recent_events"] == []


def test_journal_draft_session_summary_returns_draft_without_mutating_repository(tmp_path, monkeypatch):
    work_root = make_work_root(tmp_path, "journal_draft_summary")
    patch_api_repository_factory(monkeypatch, work_root)
    lm_client = StubLMStudioClient(
        session_summary={
            "summary": "Lavitz and Seraphina established a private understanding in House Harcourt.",
            "durable_facts": ["Lavitz agreed to continue the conversation in private."],
            "warnings": ["review whether the promise was explicit"],
        }
    )
    monkeypatch.setattr(journal_api, "LMStudioClient", lambda: lm_client)

    repository = create_repository(base_dir=work_root)
    before_scene = deepcopy(repository.load_scene_state())
    before_events = deepcopy(repository.list_events(limit=20))
    before_journal = deepcopy(repository.list_journal(limit=20))
    before_lorebook = normalize_lorebook(repository.load_lorebook_state())

    result = journal_api.draft_session_summary(
        JournalDraftSessionSummaryRequest(
            chat_title="House Harcourt Night One",
            instructions="Focus on durable social developments only.",
            messages=[
                ChatContextMessage(role="user", content="I ask Lavitz to speak privately."),
                ChatContextMessage(role="assistant", content="Lavitz closes the door and agrees to listen."),
            ],
        ),
        actor_id="player",
        save_id="default",
    )

    assert result["ok"] is True
    assert result["chat_title"] == "House Harcourt Night One"
    assert result["scene_id"] == before_scene["scene_id"]
    assert result["model"] == "stub-session-summary"
    assert result["summary"] == "Lavitz and Seraphina established a private understanding in House Harcourt."
    assert result["durable_facts"] == ["Lavitz agreed to continue the conversation in private."]
    assert result["warnings"] == ["review whether the promise was explicit"]
    assert result["source_counts"] == {"messages": 2, "user_messages": 1, "assistant_messages": 1}
    assert lm_client.session_summary_calls[0]["instructions"] == "Focus on durable social developments only."
    assert lm_client.session_summary_calls[0]["chat_title"] == "House Harcourt Night One"
    assert repository.load_scene_state() == before_scene
    assert repository.list_events(limit=20) == before_events
    assert repository.list_journal(limit=20) == before_journal
    assert normalize_lorebook(repository.load_lorebook_state()) == before_lorebook


def test_journal_draft_session_summary_requires_messages(tmp_path, monkeypatch):
    work_root = make_work_root(tmp_path, "journal_draft_summary_requires_messages")
    patch_api_repository_factory(monkeypatch, work_root)

    try:
        journal_api.draft_session_summary(
            JournalDraftSessionSummaryRequest(chat_title="Empty transcript", messages=[]),
            actor_id="player",
            save_id="default",
        )
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "messages is required" in str(exc.detail)
    else:
        raise AssertionError("Expected draft_session_summary to reject empty message input.")
