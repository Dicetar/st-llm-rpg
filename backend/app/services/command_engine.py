from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Callable
from uuid import uuid4

from app.domain.models import (
    CommandExecutionRequest,
    CommandExecutionResult,
    CommandInvocation,
    EventRecord,
    JournalEntry,
    StateMutation,
    StateOverview,
    TurnExecutionResponse,
)
from app.services.lore_update_service import LoreUpdateService
from app.services.repository import StateRepository, TransactionalStateRepository

COMMAND_NAME_PATTERN = re.compile(r"/(?P<name>[a-zA-Z_]+)", re.IGNORECASE)

BUILDER_DELIMITERS = ("::", ";;", "|")
HELD_SLOTS = ("main_hand", "off_hand", "focus")
ARGUMENT_BOUNDARY_PREFIXES = (
    " and ",
    " then ",
    " before ",
    " after ",
    " while ",
    " as ",
    " but ",
    " so ",
    " because ",
    " if ",
    " when ",
    " though ",
    " although ",
    " with ",
    " without ",
    " against ",
    " toward ",
    " towards ",
    " into ",
    " onto ",
    " from ",
    " over ",
    " under ",
    " beside ",
    " near ",
    " around ",
    " through ",
    " for ",
    " about ",
    " on ",
    " in ",
    " at ",
    " /",
    ",",
    ".",
    "!",
    "?",
    ";",
    ":",
    "\n",
    "\r",
    "\t",
)


class CommandEngine:
    def __init__(self, repository: StateRepository) -> None:
        self.repository = repository
        self.lore_service = LoreUpdateService(repository)
        self.command_handlers: dict[str, Callable[[str, CommandInvocation], CommandExecutionResult]] = {
            "inventory": self._handle_inventory,
            "use_item": self._handle_use_item,
            "cast": self._handle_cast,
            "equip": self._handle_equip,
            "quest": self._handle_quest,
            "quests": self._handle_quest,
            "quest_update": self._handle_quest_update,
            "journal": self._handle_journal,
            "condition": self._handle_condition,
            "relationships": self._handle_relationship,
            "relationship": self._handle_relationship,
            "relationship_note": self._handle_relationship_note,
            "scene_move": self._handle_scene_move,
            "scene_object": self._handle_scene_object,
            "scene_clue": self._handle_scene_clue,
            "scene_hazard": self._handle_scene_hazard,
            "scene_discovery": self._handle_scene_discovery,
            "new": self._handle_new,
            "new_item": self._handle_new_item,
            "new_spell": self._handle_new_spell,
            "new_custom_skill": self._handle_new_custom_skill,
        }

    def parse_text(self, text: str) -> list[CommandInvocation]:
        commands: list[CommandInvocation] = []
        matches = list(COMMAND_NAME_PATTERN.finditer(text))
        for index, match in enumerate(matches):
            name = match.group("name")
            next_start = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            segment = text[match.end():next_start].strip()
            argument = self._parse_command_argument_segment(segment)
            commands.append(CommandInvocation(name=name, argument=argument))
        return commands

    def execute(self, request: CommandExecutionRequest) -> TurnExecutionResponse:
        invocations = request.commands or self.parse_text(request.text or "")
        if not invocations:
            raise ValueError("No slash commands found in the request.")

        turn_id = f"turn_{uuid4().hex[:10]}"
        working_repository = TransactionalStateRepository(self.repository)
        working_engine = CommandEngine(working_repository)

        event_ids: list[str] = []
        results: list[CommandExecutionResult] = []

        for invocation in invocations:
            result = self._normalize_result_error_code(working_engine._dispatch(request.actor_id, request.scene_id, invocation))
            results.append(result)
            effective_scene_id = request.scene_id or working_engine._current_scene_id()
            event = EventRecord.create(
                turn_id=turn_id,
                actor_id=request.actor_id,
                scene_id=effective_scene_id,
                command_name=invocation.name,
                ok=result.ok,
                message=result.message,
                summary=result.message,
                source=f"command_engine:{request.mode}",
                payload={
                    "argument": invocation.argument,
                    "error_code": result.error_code,
                    "mutations": [mutation.model_dump() for mutation in result.mutations],
                    "data": result.data,
                },
            )
            working_repository.append_event(event.model_dump())
            event_ids.append(event.id)

        attempted_overview = working_engine.build_overview(request.actor_id)
        effective_turn_scene_id = request.scene_id or attempted_overview.current_scene_id
        attempted_state_changes = [mutation for result in results for mutation in result.mutations]
        lore_sync = {}
        if request.mode == "commit":
            lore_sync = working_engine.lore_service.sync_from_canonical_state(
                actor_id=request.actor_id,
                command_results=[result.model_dump() for result in results],
                scene_id=effective_turn_scene_id,
            )
        refresh_hints = self._build_refresh_hints(attempted_state_changes)
        command_count = len(results)
        failure_count = sum(1 for result in results if not result.ok)
        success_count = command_count - failure_count
        rolled_back = request.mode == "commit" and request.failure_policy == "rollback_on_failure" and failure_count > 0
        committed = request.mode == "commit" and not rolled_back
        if committed and lore_sync:
            refresh_hints = sorted(set(refresh_hints + ["lorebook"]))
        overview = self.build_overview(request.actor_id) if rolled_back else attempted_overview
        committed_turn_scene_id = request.scene_id or overview.current_scene_id
        state_changes = [] if rolled_back else attempted_state_changes
        discarded_state_changes = attempted_state_changes if rolled_back else []
        if rolled_back:
            refresh_hints = sorted(set(refresh_hints + ["events", "overview"]))
        narration_context = {
            "turn_id": turn_id,
            "actor_id": request.actor_id,
            "mode": request.mode,
            "failure_policy": request.failure_policy,
            "raw_text": request.raw_text,
            "scene": {
                "scene_id": overview.current_scene_id,
                "location": overview.current_location,
            },
            "command_results": [result.model_dump() for result in results],
            "state_changes": [mutation.model_dump() for mutation in state_changes],
            "discarded_state_changes": [mutation.model_dump() for mutation in discarded_state_changes],
            "post_command_overview": overview.model_dump(),
            "attempted_post_command_overview": attempted_overview.model_dump(),
            "refresh_hints": refresh_hints,
            "turn_summary": {
                "command_count": command_count,
                "success_count": success_count,
                "failure_count": failure_count,
                "has_failures": failure_count > 0,
                "rolled_back": rolled_back,
                "committed": committed,
            },
            "lore_sync": lore_sync,
        }
        if committed:
            working_repository.flush()
        elif rolled_back:
            rollback_event = EventRecord.create(
                turn_id=turn_id,
                actor_id=request.actor_id,
                scene_id=committed_turn_scene_id,
                command_name="turn_rollback",
                event_type="turn_rolled_back",
                source="command_engine:rollback_on_failure",
                ok=False,
                message=f"Rolled back turn after {failure_count} command failure(s).",
                payload={
                    "failure_policy": request.failure_policy,
                    "command_count": command_count,
                    "success_count": success_count,
                    "failure_count": failure_count,
                    "results": [result.model_dump() for result in results],
                    "discarded_mutations": [mutation.model_dump() for mutation in discarded_state_changes],
                },
            )
            self.repository.append_event(rollback_event.model_dump())
            event_ids = [rollback_event.id]
            lore_sync = {}
            narration_context["lore_sync"] = lore_sync
            narration_context["rollback_event_id"] = rollback_event.id
        return TurnExecutionResponse(
            turn_id=turn_id,
            mode=request.mode,
            failure_policy=request.failure_policy,
            parsed_commands=invocations,
            results=results,
            command_count=command_count,
            success_count=success_count,
            failure_count=failure_count,
            has_failures=failure_count > 0,
            rolled_back=rolled_back,
            committed=committed,
            state_changes=state_changes,
            discarded_state_changes=discarded_state_changes,
            overview=overview,
            refresh_hints=refresh_hints,
            event_ids=event_ids,
            narration_context=narration_context,
            lore_sync=lore_sync,
        )

    def _normalize_result_error_code(self, result: CommandExecutionResult) -> CommandExecutionResult:
        if result.ok or result.error_code:
            return result
        generated = f"{self._normalize_key(result.name)}_failed"
        return result.model_copy(update={"error_code": generated})

    def _build_refresh_hints(self, state_changes: list[StateMutation]) -> list[str]:
        hints = {"events", "overview"}
        for mutation in state_changes:
            path = mutation.path or ""
            if ".inventory." in path or ".equipment." in path or ".spell_slots." in path:
                hints.update({"inventory", "actor"})
            if ".known_spells." in path or ".custom_skills." in path or ".feats." in path or ".item_notes." in path:
                hints.add("actor")
            if ".conditions" in path or ".active_effects." in path:
                hints.add("actor")
            if "journal" in path:
                hints.add("journal")
            if "quests" in path:
                hints.update({"quests", "campaign"})
            if "relationships" in path:
                hints.update({"relationships", "campaign"})
            if "scene" in path or "location" in path:
                hints.update({"scene", "campaign"})
        return sorted(hints)

    def build_overview(self, actor_id: str) -> StateOverview:
        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        equipment, migrated = self._ensure_equipment_model(actor)
        if migrated:
            self.repository.save_character_state(character_state)
        scene_state = self.repository.load_scene_state()
        campaign_state = self.repository.load_campaign_state()
        active_quests = [name for name, quest in campaign_state.get("quests", {}).items() if quest.get("status") == "active"]
        return StateOverview(
            actor_id=actor_id,
            actor_name=actor["name"],
            hp_current=actor["hp_current"],
            hp_max=actor["hp_max"],
            spell_slots=actor["spell_slots"],
            gold=actor["gold"],
            inventory=actor.get("inventory", {}),
            equipment=self._build_overview_equipment(equipment),
            current_scene_id=scene_state.get("scene_id", "unknown_scene"),
            current_location=scene_state.get("location", "Unknown Location"),
            active_quests=active_quests,
        )

    def build_actor_detail(self, actor_id: str) -> dict[str, Any]:
        character_state = self.repository.load_character_state()
        actor = deepcopy(self._require_actor(character_state, actor_id))
        equipment, _ = self._ensure_equipment_model(actor)
        equipment["accessories"] = [
            deepcopy(entry) for entry in equipment.get("worn_items", []) if entry.get("category") == "accessory"
        ]
        equipment["worn_item_layers"] = self._group_worn_items_by_region(equipment.get("worn_items", []))
        return {
            "actor_id": actor_id,
            "name": actor.get("name"),
            "attributes": actor.get("attributes", {}),
            "skills": actor.get("skills", {}),
            "custom_skills": actor.get("custom_skills", {}),
            "custom_skill_notes": actor.get("custom_skill_notes", {}),
            "known_spells": actor.get("known_spells", {}),
            "feats": actor.get("feats", {}),
            "equipment": equipment,
            "inventory": actor.get("inventory", {}),
            "item_notes": actor.get("item_notes", {}),
            "conditions": actor.get("conditions", []),
            "active_effects": actor.get("active_effects", {}),
            "notes": actor.get("notes", ""),
        }

    def _dispatch(self, actor_id: str, scene_id: str | None, invocation: CommandInvocation) -> CommandExecutionResult:
        handler = self.command_handlers.get(invocation.name)
        if handler is None:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message=f"Unknown command '/{invocation.name}'.",
            )
        return handler(actor_id, invocation)

    def _handle_inventory(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        actor = self._require_actor(self.repository.load_character_state(), actor_id)
        inventory = dict(sorted(actor.get("inventory", {}).items(), key=lambda item: item[0]))
        return CommandExecutionResult(
            name=invocation.name,
            argument=invocation.argument,
            ok=True,
            message="Inventory retrieved.",
            data={"inventory": inventory, "item_notes": actor.get("item_notes", {})},
        )

    def _handle_use_item(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/use_item requires an item name.")

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        item_registry_wrapper = self.repository.load_item_registry()
        item_registry = item_registry_wrapper.setdefault("items", {})
        inventory = actor.setdefault("inventory", {})
        canonical_item = self._find_inventory_item(inventory, invocation.argument)
        if canonical_item is None:
            noted_item = self._find_mapping_key(actor.get("item_notes", {}), invocation.argument) or self._find_prefix_mapping_key(
                actor.get("item_notes", {}),
                invocation.argument,
            )
            if noted_item is not None:
                return CommandExecutionResult(
                    name=invocation.name,
                    argument=noted_item,
                    ok=False,
                    message=f"{actor['name']} no longer has '{noted_item}' in inventory. The item note still exists, but quantity is 0.",
                )
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message=f"{actor['name']} does not have '{invocation.argument}'.",
            )

        mutations: list[StateMutation] = []
        previous_registry = deepcopy(item_registry.get(canonical_item.lower()))
        item_def = self._merge_item_definition_from_actor_note(previous_registry, actor, canonical_item)
        registry_repaired = bool(item_def and item_def.get("consumable") and item_def != previous_registry)
        if registry_repaired:
            item_registry[canonical_item.lower()] = deepcopy(item_def)
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"item_registry.items.{canonical_item.lower()}",
                    before=previous_registry,
                    after=item_registry[canonical_item.lower()],
                    note="Consumable item metadata backfilled from actor note.",
                )
            )
        if not item_def or not item_def.get("consumable"):
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_item,
                ok=False,
                message=f"{canonical_item} cannot be used as a consumable item.",
            )

        if item_def.get("effect") == "heal":
            if actor["hp_current"] >= actor["hp_max"]:
                return CommandExecutionResult(
                    name=invocation.name,
                    argument=canonical_item,
                    ok=False,
                    message=f"{actor['name']} is already at full health.",
                )
            before_hp = actor["hp_current"]
            after_hp = min(actor["hp_max"], before_hp + int(item_def.get("heal_amount", 0)))
            actor["hp_current"] = after_hp
            mutations.append(StateMutation(kind="set", path=f"actors.{actor_id}.hp_current", before=before_hp, after=after_hp, note="Healing item used."))

        before_qty = inventory[canonical_item]
        after_qty = before_qty - 1
        if after_qty <= 0:
            del inventory[canonical_item]
        else:
            inventory[canonical_item] = after_qty
        mutations.append(StateMutation(kind="set", path=f"actors.{actor_id}.inventory.{canonical_item}", before=before_qty, after=max(after_qty, 0), note="Consumable quantity decremented."))
        self.repository.save_character_state(character_state)
        if registry_repaired:
            self.repository.save_item_registry(item_registry_wrapper)

        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_item,
            ok=True,
            message=f"{actor['name']} uses {canonical_item} successfully.",
            mutations=mutations,
            data={
                "effect": item_def.get("effect"),
                "heal_amount": item_def.get("heal_amount"),
                "remaining_quantity": max(after_qty, 0),
            },
        )

    def _handle_cast(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/cast requires a spell name.")

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        known_spells = actor.setdefault("known_spells", {})
        canonical_spell = self._find_known_spell(known_spells, invocation.argument)
        if canonical_spell is None:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message=f"{actor['name']} does not know '{invocation.argument}'.",
            )

        spell_registry = self.repository.load_spell_registry().get("spells", {})
        spell_def = spell_registry.get(canonical_spell.lower())
        if not spell_def:
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_spell,
                ok=False,
                message=f"No spell registry entry exists for '{canonical_spell}'.",
            )

        level = int(spell_def.get("level", 0))
        mutations: list[StateMutation] = []
        if level > 0:
            slot_key = str(level)
            current_slots = int(actor["spell_slots"].get(slot_key, 0))
            if current_slots <= 0:
                return CommandExecutionResult(
                    name=invocation.name,
                    argument=canonical_spell,
                    ok=False,
                    message=f"No level {level} spell slots remain for {canonical_spell}.",
                )
            actor["spell_slots"][slot_key] = current_slots - 1
            mutations.append(StateMutation(kind="set", path=f"actors.{actor_id}.spell_slots.{slot_key}", before=current_slots, after=current_slots - 1, note="Spell slot consumed."))
            self.repository.save_character_state(character_state)
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_spell,
                ok=True,
                message=f"{actor['name']} casts {canonical_spell}, spending one level {level} spell slot.",
                mutations=mutations,
                data={"spell_level": level, "remaining_slots": actor['spell_slots'][slot_key]},
            )

        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_spell,
            ok=True,
            message=f"{actor['name']} casts cantrip {canonical_spell}.",
            data={"spell_level": 0},
        )

    def _handle_equip(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/equip requires an item name.")

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        equipment, migrated = self._ensure_equipment_model(actor)
        inventory = actor.setdefault("inventory", {})
        canonical_item = self._find_inventory_item(inventory, invocation.argument)
        if canonical_item is None:
            return CommandExecutionResult(name=invocation.name, argument=invocation.argument, ok=False, message=f"{actor['name']} does not have '{invocation.argument}'.")

        item_def = self.repository.load_item_registry().get("items", {}).get(canonical_item.lower(), {})
        quantity_owned = int(inventory.get(canonical_item, 0))
        equipped_count = self._count_active_item_assignments(equipment, canonical_item)

        slot = item_def.get("equippable_slot")
        if slot in HELD_SLOTS:
            held = equipment.setdefault("held", self._default_held())
            before = held.get(slot)
            if before == canonical_item:
                if migrated:
                    self.repository.save_character_state(character_state)
                return CommandExecutionResult(
                    name=invocation.name,
                    argument=canonical_item,
                    ok=True,
                    message=f"{canonical_item} is already assigned to {slot}.",
                    data={"slot": slot, "already_equipped": True},
                )
            if equipped_count >= quantity_owned:
                return CommandExecutionResult(
                    name=invocation.name,
                    argument=canonical_item,
                    ok=False,
                    message=f"No unassigned copy of {canonical_item} remains to equip.",
                )
            held[slot] = canonical_item
            self.repository.save_character_state(character_state)
            mutation = StateMutation(kind="set", path=f"actors.{actor_id}.equipment.held.{slot}", before=before, after=canonical_item, note="Held slot updated.")
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_item,
                ok=True,
                message=f"{actor['name']} equips {canonical_item} in slot '{slot}'.",
                mutations=[mutation],
                data={"slot": slot},
            )

        if not self._is_wearable_item(item_def):
            if migrated:
                self.repository.save_character_state(character_state)
            return CommandExecutionResult(name=invocation.name, argument=canonical_item, ok=False, message=f"{canonical_item} is not equippable or wearable.")

        if equipped_count >= quantity_owned:
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_item,
                ok=False,
                message=f"No unworn copy of {canonical_item} remains to wear.",
            )

        worn_items = equipment.setdefault("worn_items", [])
        before_len = len(worn_items)
        worn_entry = self._build_worn_entry(canonical_item, item_def, worn_items)
        worn_items.append(worn_entry)
        self.repository.save_character_state(character_state)
        layer_summary = ", ".join(f"{placement['region']}[{placement['layer']}]" for placement in worn_entry.get("placements", []))
        mutation = StateMutation(
            kind="append",
            path=f"actors.{actor_id}.equipment.worn_items",
            before=before_len,
            after=before_len + 1,
            note=f"Worn item entry added for {canonical_item}.",
        )
        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_item,
            ok=True,
            message=f"{actor['name']} wears {canonical_item} ({layer_summary}).",
            mutations=[mutation],
            data={"worn_entry": worn_entry},
        )

    def _handle_quest(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        campaign_state = self.repository.load_campaign_state()
        quests = campaign_state.get("quests", {})
        active = {name: payload for name, payload in quests.items() if payload.get("status") == "active"}
        return CommandExecutionResult(
            name=invocation.name,
            argument=invocation.argument,
            ok=True,
            message="Quest summary retrieved.",
            data={"active_quests": active},
        )

    def _handle_quest_update(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(
                name=invocation.name,
                ok=False,
                message="/quest_update requires 'quest name | note' and optional status/current stage.",
            )

        parts = self._split_builder_parts(invocation.argument)
        if len(parts) < 2:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message="/quest_update requires 'quest name | note' and optional status/current stage.",
            )

        quest_name = parts[0]
        note = parts[1]
        status = parts[2] if len(parts) > 2 else None
        current_stage = parts[3] if len(parts) > 3 else None

        campaign_state = self.repository.load_campaign_state()
        quests = campaign_state.setdefault("quests", {})
        canonical_quest_name = self._find_mapping_key(quests, quest_name) or quest_name
        existing_record = deepcopy(quests.get(canonical_quest_name))
        quest_record = quests.setdefault(
            canonical_quest_name,
            {
                "status": "active",
                "note": "",
                "tags": ["player_defined", "quest"],
                "entities": [actor_id],
                "importance": 2,
                "last_updated_day": campaign_state.get("date", {}).get("day_counter"),
            },
        )

        mutations: list[StateMutation] = []
        before_note = quest_record.get("note")
        quest_record["note"] = note
        mutations.append(
            StateMutation(
                kind="set",
                path=f"campaign.quests.{canonical_quest_name}.note",
                before=before_note,
                after=note,
                note="Quest note updated.",
            )
        )

        if status:
            before_status = quest_record.get("status")
            quest_record["status"] = status
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"campaign.quests.{canonical_quest_name}.status",
                    before=before_status,
                    after=status,
                    note="Quest status updated.",
                )
            )

        if current_stage:
            before_stage = quest_record.get("current_stage")
            quest_record["current_stage"] = current_stage
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"campaign.quests.{canonical_quest_name}.current_stage",
                    before=before_stage,
                    after=current_stage,
                    note="Quest stage updated.",
                )
            )

        day_counter = campaign_state.get("date", {}).get("day_counter")
        if day_counter is not None:
            before_day = quest_record.get("last_updated_day")
            quest_record["last_updated_day"] = day_counter
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"campaign.quests.{canonical_quest_name}.last_updated_day",
                    before=before_day,
                    after=day_counter,
                    note="Quest update day stamped.",
                )
            )

        self.repository.save_campaign_state(campaign_state)

        journal_entry = JournalEntry.create(
            kind="quest_update",
            text=f"{canonical_quest_name}: {note}",
            scene_id=self._current_scene_id(),
            tags=["quest", "command", self._normalize_key(canonical_quest_name)],
            metadata={
                "quest_name": canonical_quest_name,
                "status": quest_record.get("status"),
                "current_stage": quest_record.get("current_stage"),
            },
        )
        self.repository.append_journal(journal_entry.model_dump())
        mutations.append(
            StateMutation(
                kind="append",
                path="journal.entries",
                before=None,
                after=journal_entry.id,
                note="Quest update journal entry appended.",
            )
        )

        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_quest_name,
            ok=True,
            message=(
                f"Quest '{canonical_quest_name}' updated."
                if existing_record is not None
                else f"Quest '{canonical_quest_name}' created and updated."
            ),
            mutations=mutations,
            data={"quest_name": canonical_quest_name, "quest": quest_record, "created": existing_record is None},
        )

    def _handle_journal(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        entries = self.repository.list_journal(limit=10)
        return CommandExecutionResult(
            name=invocation.name,
            argument=invocation.argument,
            ok=True,
            message="Recent journal entries retrieved.",
            data={"entries": entries},
        )

    def _handle_condition(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(
                name=invocation.name,
                ok=False,
                message="/condition requires 'condition' and optional add/remove action.",
            )

        parts = self._split_builder_parts(invocation.argument)
        if not parts:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message="/condition requires 'condition' and optional add/remove action.",
            )

        action = "add"
        condition = parts[0].strip()
        if len(parts) > 1 and parts[0].strip().lower() in {"add", "remove"}:
            action = parts[0].strip().lower()
            condition = parts[1].strip()
        elif len(parts) > 1:
            action = parts[1].strip().lower()

        if not condition or action not in {"add", "remove"}:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message="/condition requires 'condition' and optional add/remove action.",
            )

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        conditions = actor.setdefault("conditions", [])
        normalized_existing = {str(entry).casefold(): entry for entry in conditions}
        canonical_condition = normalized_existing.get(condition.casefold(), condition)

        if action == "add" and canonical_condition in conditions:
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_condition,
                ok=True,
                message=f"{actor['name']} already has condition '{canonical_condition}'.",
                data={"condition": canonical_condition, "action": action, "conditions": list(conditions), "changed": False},
            )

        if action == "remove" and canonical_condition not in conditions:
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_condition,
                ok=True,
                message=f"{actor['name']} does not currently have condition '{canonical_condition}'.",
                data={"condition": canonical_condition, "action": action, "conditions": list(conditions), "changed": False},
            )

        before = list(conditions)
        if action == "add":
            conditions.append(condition)
            canonical_condition = condition
        else:
            conditions[:] = [entry for entry in conditions if str(entry).casefold() != canonical_condition.casefold()]

        self.repository.save_character_state(character_state)
        verb = "added" if action == "add" else "removed"
        mutation = StateMutation(
            kind="set",
            path=f"actors.{actor_id}.conditions",
            before=before,
            after=list(conditions),
            note=f"Condition '{canonical_condition}' {verb}.",
        )
        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_condition,
            ok=True,
            message=f"{actor['name']} condition '{canonical_condition}' {verb}.",
            mutations=[mutation],
            data={"condition": canonical_condition, "action": action, "conditions": list(conditions), "changed": True},
        )

    def _handle_relationship(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        campaign_state = self.repository.load_campaign_state()
        relationships = campaign_state.get("relationships", {})

        if invocation.argument:
            canonical_name = self._find_mapping_key(relationships, invocation.argument)
            if canonical_name is None:
                return CommandExecutionResult(
                    name=invocation.name,
                    argument=invocation.argument,
                    ok=False,
                    message=f"No relationship record exists for '{invocation.argument}'.",
                )
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_name,
                ok=True,
                message=f"Relationship detail for '{canonical_name}' retrieved.",
                data={"relationship_name": canonical_name, "relationship": relationships[canonical_name]},
            )

        return CommandExecutionResult(
            name=invocation.name,
            argument=invocation.argument,
            ok=True,
            message="Relationship summary retrieved.",
            data={"relationships": relationships},
        )

    def _handle_relationship_note(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(
                name=invocation.name,
                ok=False,
                message="/relationship_note requires 'name | note' and optional score delta.",
            )

        parts = self._split_builder_parts(invocation.argument)
        if len(parts) < 2:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message="/relationship_note requires 'name | note' and optional score delta.",
            )

        target_name = parts[0]
        note = parts[1]
        score_delta = self._safe_int(parts[2], 0) if len(parts) > 2 else 0

        campaign_state = self.repository.load_campaign_state()
        relationships = campaign_state.setdefault("relationships", {})
        canonical_name = self._find_mapping_key(relationships, target_name) or target_name
        existing_record = deepcopy(relationships.get(canonical_name))
        relationship = relationships.setdefault(
            canonical_name,
            {
                "score": 0,
                "note": "",
                "last_updated_day": campaign_state.get("date", {}).get("day_counter"),
            },
        )

        mutations: list[StateMutation] = []
        before_note = relationship.get("note")
        relationship["note"] = note
        mutations.append(
            StateMutation(
                kind="set",
                path=f"campaign.relationships.{canonical_name}.note",
                before=before_note,
                after=note,
                note="Relationship note updated.",
            )
        )

        if score_delta:
            before_score = self._safe_int(relationship.get("score"), 0)
            relationship["score"] = before_score + score_delta
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"campaign.relationships.{canonical_name}.score",
                    before=before_score,
                    after=relationship["score"],
                    note="Relationship score adjusted.",
                )
            )

        day_counter = campaign_state.get("date", {}).get("day_counter")
        if day_counter is not None:
            before_day = relationship.get("last_updated_day")
            relationship["last_updated_day"] = day_counter
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"campaign.relationships.{canonical_name}.last_updated_day",
                    before=before_day,
                    after=day_counter,
                    note="Relationship update day stamped.",
                )
            )

        self.repository.save_campaign_state(campaign_state)

        journal_entry = JournalEntry.create(
            kind="relationship_note",
            text=f"{canonical_name}: {note}",
            scene_id=self._current_scene_id(),
            tags=["relationship", "command", self._normalize_key(canonical_name)],
            metadata={"target_name": canonical_name, "score_delta": score_delta},
        )
        self.repository.append_journal(journal_entry.model_dump())
        mutations.append(
            StateMutation(
                kind="append",
                path="journal.entries",
                before=None,
                after=journal_entry.id,
                note="Relationship journal entry appended.",
            )
        )

        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_name,
            ok=True,
            message=(
                f"Relationship note for '{canonical_name}' updated."
                if existing_record is not None
                else f"Relationship record for '{canonical_name}' created."
            ),
            mutations=mutations,
            data={
                "relationship_name": canonical_name,
                "relationship": relationship,
                "created": existing_record is None,
                "score_delta": score_delta,
            },
        )

    def _handle_scene_move(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(
                name=invocation.name,
                ok=False,
                message="/scene_move requires 'location' and optional scene_id/time_of_day/tension_level.",
            )

        parts = self._split_builder_parts(invocation.argument)
        if not parts:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message="/scene_move requires 'location' and optional scene_id/time_of_day/tension_level.",
            )

        location = parts[0]
        scene_id = parts[1] if len(parts) > 1 else None
        time_of_day = parts[2] if len(parts) > 2 else None
        tension_level = self._safe_int(parts[3], 0) if len(parts) > 3 and str(parts[3]).strip() else None

        scene_state = self.repository.load_scene_state()
        mutations: list[StateMutation] = []
        changed = False

        changed = self._set_scene_field(mutations, scene_state, "location", location, note="Scene location updated.") or changed
        if scene_id:
            changed = self._set_scene_field(mutations, scene_state, "scene_id", scene_id, note="Scene identifier updated.") or changed
        if time_of_day:
            changed = self._set_scene_field(mutations, scene_state, "time_of_day", time_of_day, note="Scene time of day updated.") or changed
        if tension_level is not None:
            changed = self._set_scene_field(mutations, scene_state, "tension_level", tension_level, note="Scene tension level updated.") or changed

        if not changed:
            return CommandExecutionResult(
                name=invocation.name,
                argument=location,
                ok=True,
                message="Scene state already matched the requested move.",
                data={"scene": scene_state},
            )

        self.repository.save_scene_state(scene_state)

        journal_entry = self._append_scene_note(
            text=f"Scene moved to {location}.",
            tags=["scene", "move", self._normalize_key(scene_state.get("scene_id") or location)],
            metadata={
                "scene_id": scene_state.get("scene_id"),
                "location": scene_state.get("location"),
                "time_of_day": scene_state.get("time_of_day"),
                "tension_level": scene_state.get("tension_level"),
            },
        )
        mutations.append(self._journal_append_mutation(journal_entry.id, "Scene move journal entry appended."))

        return CommandExecutionResult(
            name=invocation.name,
            argument=location,
            ok=True,
            message=f"Scene moved to '{location}'.",
            mutations=mutations,
            data={"scene": scene_state},
        )

    def _handle_scene_object(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(
                name=invocation.name,
                ok=False,
                message="/scene_object requires 'object name' and optional description/visibility/tags/importance/state.",
            )

        parts = self._split_builder_parts(invocation.argument)
        if not parts:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message="/scene_object requires 'object name' and optional description/visibility/tags/importance/state.",
            )

        object_name = parts[0]
        description = parts[1] if len(parts) > 1 else None
        visible = self._parse_scene_presence(parts[2], default=True) if len(parts) > 2 else True
        tags = self._split_csv(parts[3]) if len(parts) > 3 else None
        importance = self._safe_int(parts[4], 0) if len(parts) > 4 and str(parts[4]).strip() else None
        state = parts[5] if len(parts) > 5 else None

        scene_state = self.repository.load_scene_state()
        objects = scene_state.setdefault("notable_objects", [])
        object_details = scene_state.setdefault("notable_object_details", {})
        canonical_name = self._find_sequence_value(objects, object_name) or self._find_mapping_key(object_details, object_name) or object_name

        before_objects = list(objects)
        before_detail = deepcopy(object_details.get(canonical_name))
        detail_entry = deepcopy(before_detail) if before_detail is not None else {}
        detail_entry.setdefault("source", "scene_object")
        detail_entry["active"] = visible
        detail_entry["last_updated_day"] = self._current_day_counter()

        changed = False
        if visible:
            if canonical_name not in objects:
                objects.append(canonical_name)
                changed = True
        else:
            filtered_objects = [entry for entry in objects if self._normalize(entry) != self._normalize(canonical_name)]
            if filtered_objects != objects:
                objects[:] = filtered_objects
                changed = True

        if description and detail_entry.get("description") != description:
            detail_entry["description"] = description
            changed = True
        if tags is not None and detail_entry.get("tags") != tags:
            detail_entry["tags"] = tags
            changed = True
        if importance is not None and detail_entry.get("importance") != importance:
            detail_entry["importance"] = importance
            changed = True
        if state and detail_entry.get("state") != state:
            detail_entry["state"] = state
            changed = True
        if before_detail != detail_entry:
            changed = True

        object_details[canonical_name] = detail_entry

        if not changed:
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_name,
                ok=True,
                message=f"Scene object '{canonical_name}' was already up to date.",
                data={"scene_object": detail_entry},
            )

        self.repository.save_scene_state(scene_state)

        mutations = [
            StateMutation(
                kind="set",
                path="scene.notable_objects",
                before=before_objects,
                after=list(objects),
                note=f"Scene object '{canonical_name}' visibility updated.",
            ),
            StateMutation(
                kind="set",
                path=f"scene.notable_object_details.{canonical_name}",
                before=before_detail,
                after=detail_entry,
                note=f"Scene object detail for '{canonical_name}' updated.",
            ),
        ]

        journal_entry = self._append_scene_note(
            text=f"Scene object {'revealed' if visible else 'hidden'}: {canonical_name}.",
            tags=["scene", "object", self._normalize_key(canonical_name)],
            metadata={"object_name": canonical_name, "visible": visible, "state": detail_entry.get("state")},
        )
        mutations.append(self._journal_append_mutation(journal_entry.id, "Scene object journal entry appended."))

        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_name,
            ok=True,
            message=f"Scene object '{canonical_name}' updated.",
            mutations=mutations,
            data={"scene_object": detail_entry, "visible": visible},
        )

    def _handle_scene_clue(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        return self._handle_scene_list_entry(
            actor_id,
            invocation,
            field_name="visible_clues",
            label="clue",
            tag="clue",
        )

    def _handle_scene_hazard(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        return self._handle_scene_list_entry(
            actor_id,
            invocation,
            field_name="active_hazards",
            label="hazard",
            tag="hazard",
        )

    def _handle_scene_discovery(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        return self._handle_scene_list_entry(
            actor_id,
            invocation,
            field_name="recent_discoveries",
            label="discovery",
            tag="discovery",
        )

    def _handle_new(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new requires a target type and payload.")

        target_type, builder_argument = self._parse_new_target(invocation.argument)
        alias_map = {
            "item": "new_item",
            "spell": "new_spell",
            "custom_skill": "new_custom_skill",
            "custom skill": "new_custom_skill",
            "skill": "new_custom_skill",
        }
        target_command = alias_map.get(target_type)
        if target_command is None:
            return CommandExecutionResult(name=invocation.name, argument=invocation.argument, ok=False, message=f"Unsupported /new target '{target_type}'.")

        delegated = CommandInvocation(name=target_command, argument=builder_argument)
        return self.command_handlers[target_command](actor_id, delegated)

    def _handle_new_item(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new_item requires at least an item name.")

        parts = self._split_builder_parts(invocation.argument)
        if not parts:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new_item requires at least an item name.")

        item_name = parts[0]
        quantity = self._safe_int(parts[1], 1) if len(parts) > 1 else 1
        raw_item_kind = parts[2] if len(parts) > 2 else "misc"
        description = parts[3] if len(parts) > 3 else f"Player-defined item: {item_name}."
        item_kind_tokens = self._split_tag_tokens(raw_item_kind)
        item_kind = item_kind_tokens[0] if item_kind_tokens else "misc"
        item_note_tags = list(dict.fromkeys(item_kind_tokens + ["player_defined"]))

        if quantity <= 0:
            return CommandExecutionResult(name=invocation.name, argument=invocation.argument, ok=False, message="Item quantity must be greater than zero.")

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        inventory = actor.setdefault("inventory", {})
        item_notes = actor.setdefault("item_notes", {})
        item_registry_wrapper = self.repository.load_item_registry()
        item_registry = item_registry_wrapper.setdefault("items", {})

        canonical_item = self._find_inventory_item(inventory, item_name) or item_name
        before_qty = int(inventory.get(canonical_item, 0))
        after_qty = before_qty + quantity
        inventory[canonical_item] = after_qty

        previous_note = item_notes.get(canonical_item)
        previous_registry = item_registry.get(canonical_item.lower())

        item_registry[canonical_item.lower()] = {
            "name": canonical_item,
            "kind": item_kind,
            "consumable": "consumable" in item_kind_tokens,
            "description": description,
            "narration_hint": description,
        }

        item_notes[canonical_item] = {
            "description": description,
            "tags": item_note_tags,
            "source": "builder_command",
            "active": True,
        }

        self.repository.save_character_state(character_state)
        self.repository.save_item_registry(item_registry_wrapper)

        existed = before_qty > 0
        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_item,
            ok=True,
            message=(
                f"Item '{canonical_item}' updated. Quantity is now {after_qty}."
                if existed else f"Item '{canonical_item}' created and added to inventory. Quantity is now {after_qty}."
            ),
            mutations=[
                StateMutation(kind="set", path=f"actors.{actor_id}.inventory.{canonical_item}", before=before_qty, after=after_qty, note="Inventory quantity updated."),
                StateMutation(kind="set", path=f"actors.{actor_id}.item_notes.{canonical_item}", before=previous_note, after=item_notes[canonical_item], note="Item note upserted."),
                StateMutation(kind="set", path=f"item_registry.items.{canonical_item.lower()}", before=previous_registry, after=item_registry[canonical_item.lower()], note="Item registry entry upserted."),
            ],
            data={"quantity": after_qty, "kind": item_kind, "tags": item_note_tags, "description": description},
        )

    def _handle_new_spell(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new_spell requires at least a spell name.")

        parts = self._split_builder_parts(invocation.argument)
        if not parts:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new_spell requires at least a spell name.")

        spell_name = parts[0]
        spell_level = self._safe_int(parts[1], 0) if len(parts) > 1 else 0
        description = parts[2] if len(parts) > 2 else f"Player-defined spell: {spell_name}."
        school = parts[3] if len(parts) > 3 else "custom"

        if spell_level < 0:
            return CommandExecutionResult(name=invocation.name, argument=invocation.argument, ok=False, message="Spell level cannot be negative.")

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        known_spells = actor.setdefault("known_spells", {})
        spell_registry_wrapper = self.repository.load_spell_registry()
        spell_registry = spell_registry_wrapper.setdefault("spells", {})

        key = self._normalize_key(spell_name)
        existed = key in known_spells
        before_spell = known_spells.get(key)
        previous_registry = spell_registry.get(key)
        known_spells[key] = {
            "name": spell_name,
            "description": description,
            "tags": ["custom", "player_defined", "spell"],
            "source": "builder_command",
        }
        spell_registry[key] = {
            "name": spell_name,
            "level": spell_level,
            "school": school,
            "description": description,
        }

        self.repository.save_character_state(character_state)
        self.repository.save_spell_registry(spell_registry_wrapper)

        return CommandExecutionResult(
            name=invocation.name,
            argument=spell_name,
            ok=True,
            message=(f"Spell '{spell_name}' updated." if existed else f"Spell '{spell_name}' created and added to known spells."),
            mutations=[
                StateMutation(kind="set", path=f"actors.{actor_id}.known_spells.{key}", before=before_spell, after=known_spells[key], note="Known spell upserted."),
                StateMutation(kind="set", path=f"spell_registry.spells.{key}", before=previous_registry, after=spell_registry[key], note="Spell registry entry upserted."),
            ],
            data={"spell_level": spell_level, "school": school},
        )

    def _handle_new_custom_skill(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new_custom_skill requires at least a skill name.")

        parts = self._split_builder_parts(invocation.argument)
        if not parts:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new_custom_skill requires at least a skill name.")

        skill_name = parts[0]
        skill_value = self._safe_int(parts[1], 1) if len(parts) > 1 else 1
        description = parts[2] if len(parts) > 2 else f"Player-defined custom skill: {skill_name}."

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        custom_skills = actor.setdefault("custom_skills", {})
        custom_skill_notes = actor.setdefault("custom_skill_notes", {})

        key = self._normalize_key(skill_name)
        existed = key in custom_skills
        before_value = custom_skills.get(key)
        before_note = custom_skill_notes.get(key)
        custom_skills[key] = skill_value
        custom_skill_notes[key] = {
            "description": description,
            "tags": ["custom", "player_defined", "skill"],
            "source": "builder_command",
            "active": True,
        }

        self.repository.save_character_state(character_state)

        return CommandExecutionResult(
            name=invocation.name,
            argument=skill_name,
            ok=True,
            message=(f"Custom skill '{skill_name}' updated to {skill_value}." if existed else f"Custom skill '{skill_name}' created at {skill_value}."),
            mutations=[
                StateMutation(kind="set", path=f"actors.{actor_id}.custom_skills.{key}", before=before_value, after=skill_value, note="Custom skill value upserted."),
                StateMutation(kind="set", path=f"actors.{actor_id}.custom_skill_notes.{key}", before=before_note, after=custom_skill_notes[key], note="Custom skill note upserted."),
            ],
            data={"skill_value": skill_value, "description": description},
        )

    def _require_actor(self, character_state: dict[str, Any], actor_id: str) -> dict[str, Any]:
        actors = character_state.get("actors", {})
        if actor_id not in actors:
            raise KeyError(f"Unknown actor_id '{actor_id}'.")
        return actors[actor_id]

    def _ensure_equipment_model(self, actor: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        equipment = actor.setdefault("equipment", {})
        migrated = False

        if "held" in equipment and "worn_items" in equipment:
            normalized = {
                "held": self._normalize_held(equipment.get("held", {}), equipment),
                "worn_items": self._normalize_worn_items(equipment.get("worn_items", [])),
            }
            if equipment != normalized:
                actor["equipment"] = normalized
                migrated = True
            return actor["equipment"], migrated

        worn_items: list[dict[str, Any]] = []
        legacy_accessories = equipment.get("accessories") or equipment.get("jewelry") or []
        legacy_clothing = equipment.get("worn_clothing") or []
        legacy_armor = equipment.get("armor_pieces") or []
        cloak = equipment.get("cloak")

        for entry in legacy_accessories:
            worn_items.append(self._normalize_worn_item_entry(entry, default_category="accessory"))
        for entry in legacy_clothing:
            worn_items.append(self._normalize_worn_item_entry(entry, default_category="clothing"))
        for entry in legacy_armor:
            worn_items.append(self._normalize_worn_item_entry(entry, default_category="armor"))
        if cloak:
            worn_items.append(self._normalize_worn_item_entry({"item": cloak, "kind": "cloak", "wear_location": "shoulders", "worn": True}, default_category="clothing"))

        actor["equipment"] = {
            "held": self._normalize_held({}, equipment),
            "worn_items": self._normalize_worn_items(worn_items),
        }
        return actor["equipment"], True

    def _normalize_held(self, held: dict[str, Any], legacy_equipment: dict[str, Any] | None = None) -> dict[str, str | None]:
        legacy_equipment = legacy_equipment or {}
        return {
            "main_hand": self._clean_slot_value(held.get("main_hand", legacy_equipment.get("main_hand"))),
            "off_hand": self._clean_slot_value(held.get("off_hand", legacy_equipment.get("off_hand"))),
            "focus": self._clean_slot_value(held.get("focus", legacy_equipment.get("focus"))),
        }

    def _default_held(self) -> dict[str, str | None]:
        return {"main_hand": None, "off_hand": None, "focus": None}

    def _clean_slot_value(self, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            return value.get("item") or value.get("name")
        return str(value)

    def _normalize_worn_items(self, worn_items: list[Any]) -> list[dict[str, Any]]:
        return [self._normalize_worn_item_entry(entry) for entry in worn_items]

    def _normalize_worn_item_entry(self, entry: Any, default_category: str | None = None) -> dict[str, Any]:
        raw = entry if isinstance(entry, dict) else {"item": entry}
        item_name = raw.get("item") or raw.get("name") or "unknown item"
        category = raw.get("category") or default_category or self._infer_category_from_kind(raw.get("kind"))
        kind = raw.get("kind") or category or "misc"
        placements = self._normalize_placements(raw.get("placements"), raw.get("wear_location"), raw.get("layer"), category, kind, item_name)
        return {
            "entry_id": raw.get("entry_id") or f"wear_{uuid4().hex[:8]}",
            "item": item_name,
            "category": category,
            "kind": kind,
            "worn": bool(raw.get("worn", True)),
            "placements": placements,
            "notes": raw.get("notes"),
        }

    def _normalize_placements(self, placements_raw: Any, legacy_wear_location: Any, legacy_layer: Any, category: str, kind: str, item_name: str) -> list[dict[str, Any]]:
        placements: list[dict[str, Any]] = []
        if isinstance(placements_raw, list):
            for placement in placements_raw:
                if not isinstance(placement, dict):
                    continue
                region = self._normalize_region(placement.get("region") or placement.get("wear_location"))
                if not region:
                    continue
                placements.append({"region": region, "layer": max(1, self._safe_int(placement.get("layer"), 1))})
        elif legacy_wear_location:
            region = self._normalize_region(legacy_wear_location)
            if region:
                placements.append({"region": region, "layer": max(1, self._safe_int(legacy_layer, 1))})

        if placements:
            return placements
        return self._infer_default_placements(category, kind, item_name)

    def _infer_category_from_kind(self, kind: Any) -> str:
        value = self._normalize(str(kind or ""))
        if any(token in value for token in ("ring", "amulet", "necklace", "bracelet", "brooch", "circlet", "accessory")):
            return "accessory"
        if any(token in value for token in ("armor", "mail", "gambison", "brigandine", "plate")):
            return "armor"
        return "clothing"

    def _infer_default_placements(self, category: str, kind: str, item_name: str) -> list[dict[str, Any]]:
        kind_value = self._normalize(kind)
        item_value = self._normalize(item_name)
        if "ring" in kind_value or "ring" in item_value:
            return [{"region": "left_hand", "layer": 1}]
        if any(token in kind_value for token in ("amulet", "necklace", "pendant")):
            return [{"region": "neck", "layer": 1}]
        if "cloak" in kind_value or "cloak" in item_value:
            return [{"region": "shoulders", "layer": 3}, {"region": "back", "layer": 3}]
        if "shirt" in kind_value or "shirt" in item_value:
            return [{"region": "torso", "layer": 1}, {"region": "arms", "layer": 1}]
        if any(token in kind_value for token in ("doublet", "jacket", "coat")):
            return [{"region": "torso", "layer": 2}, {"region": "arms", "layer": 2}]
        if any(token in kind_value for token in ("gambison", "padded armor")):
            return [{"region": "torso", "layer": 2}, {"region": "arms", "layer": 2}]
        if any(token in kind_value for token in ("mail", "chainmail", "mail shirt")):
            return [{"region": "torso", "layer": 3}, {"region": "arms", "layer": 3}]
        if category == "accessory":
            return [{"region": "neck", "layer": 1}]
        if category == "armor":
            return [{"region": "torso", "layer": 2}]
        return [{"region": "torso", "layer": 1}]

    def _is_wearable_item(self, item_def: dict[str, Any]) -> bool:
        if item_def.get("wear"):
            return True
        return self._infer_category_from_kind(item_def.get("kind")) in {"accessory", "clothing", "armor"}

    def _build_worn_entry(self, item_name: str, item_def: dict[str, Any], existing_worn_items: list[dict[str, Any]]) -> dict[str, Any]:
        wear_info = item_def.get("wear", {})
        category = wear_info.get("category") or self._infer_category_from_kind(item_def.get("kind"))
        kind = wear_info.get("kind") or item_def.get("kind") or category
        base_placements = self._normalize_placements(wear_info.get("placements"), wear_info.get("wear_location"), wear_info.get("layer"), category, kind, item_name)
        layer_shift = self._compute_layer_shift(existing_worn_items, base_placements)
        shifted_placements = [{"region": placement["region"], "layer": placement["layer"] + layer_shift} for placement in base_placements]
        return {
            "entry_id": f"wear_{uuid4().hex[:8]}",
            "item": item_name,
            "category": category,
            "kind": kind,
            "worn": True,
            "placements": shifted_placements,
            "notes": wear_info.get("notes") or item_def.get("description") or item_def.get("narration_hint"),
        }

    def _compute_layer_shift(self, existing_worn_items: list[dict[str, Any]], requested_placements: list[dict[str, Any]]) -> int:
        offset = 0
        while True:
            conflict = False
            for requested in requested_placements:
                target_region = requested["region"]
                target_layer = requested["layer"] + offset
                for worn_entry in existing_worn_items:
                    if not worn_entry.get("worn", True):
                        continue
                    for placement in worn_entry.get("placements", []):
                        if self._normalize_region(placement.get("region")) != target_region:
                            continue
                        if self._safe_int(placement.get("layer"), 1) == target_layer:
                            conflict = True
                            break
                    if conflict:
                        break
                if conflict:
                    break
            if not conflict:
                return offset
            offset += 1

    def _count_active_item_assignments(self, equipment: dict[str, Any], item_name: str) -> int:
        total = 0
        held = equipment.get("held", {})
        total += sum(1 for value in held.values() if value == item_name)
        total += sum(1 for entry in equipment.get("worn_items", []) if entry.get("item") == item_name and entry.get("worn", True))
        return total

    def _group_worn_items_by_region(self, worn_items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for entry in worn_items:
            if not entry.get("worn", True):
                continue
            for placement in entry.get("placements", []):
                region = self._normalize_region(placement.get("region"))
                if not region:
                    continue
                grouped.setdefault(region, []).append(
                    {
                        "entry_id": entry.get("entry_id"),
                        "item": entry.get("item"),
                        "category": entry.get("category"),
                        "kind": entry.get("kind"),
                        "layer": self._safe_int(placement.get("layer"), 1),
                        "notes": entry.get("notes"),
                    }
                )
        for region in grouped:
            grouped[region].sort(key=lambda entry: (entry.get("layer", 0), entry.get("item", "")))
        return grouped

    def _find_inventory_item(self, inventory: dict[str, int], raw_name: str) -> str | None:
        return self._find_mapping_key(inventory, raw_name) or self._find_prefix_mapping_key(inventory, raw_name)

    def _find_known_spell(self, known_spells: dict[str, Any], raw_name: str) -> str | None:
        normalized = self._normalize(raw_name)
        best_match: tuple[int, str] | None = None
        for key, payload in known_spells.items():
            candidate_names = {key, payload.get("name", "")}
            for candidate in candidate_names:
                candidate_normalized = self._normalize(candidate)
                if candidate_normalized == normalized:
                    return payload.get("name") or key
                if self._matches_argument_prefix(raw_name, candidate):
                    score = len(candidate_normalized)
                    resolved_name = payload.get("name") or key
                    if best_match is None or score > best_match[0]:
                        best_match = (score, resolved_name)
        if best_match is not None:
            return best_match[1]
        return None

    def _build_overview_equipment(self, equipment: dict[str, Any]) -> dict[str, str | None]:
        held = equipment.get("held", {}) if isinstance(equipment, dict) else {}
        return {slot: self._clean_slot_value(held.get(slot)) for slot in HELD_SLOTS}

    def _handle_scene_list_entry(
        self,
        actor_id: str,
        invocation: CommandInvocation,
        *,
        field_name: str,
        label: str,
        tag: str,
    ) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(
                name=invocation.name,
                ok=False,
                message=f"/{invocation.name} requires '{label} text' and optional action add/remove.",
            )

        parts = self._split_builder_parts(invocation.argument)
        if not parts:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message=f"/{invocation.name} requires '{label} text' and optional action add/remove.",
            )

        entry_text = parts[0]
        action = str(parts[1]).strip().lower() if len(parts) > 1 else "add"
        action_verb = "added" if action == "add" else "removed"
        if action not in {"add", "remove"}:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message=f"/{invocation.name} action must be 'add' or 'remove'.",
            )

        scene_state = self.repository.load_scene_state()
        entries = scene_state.setdefault(field_name, [])
        canonical_entry = self._find_sequence_value(entries, entry_text) or entry_text
        before = list(entries)
        changed = False

        if action == "add" and canonical_entry not in entries:
            entries.append(canonical_entry)
            changed = True
        if action == "remove":
            filtered_entries = [entry for entry in entries if self._normalize(entry) != self._normalize(canonical_entry)]
            if filtered_entries != entries:
                entries[:] = filtered_entries
                changed = True

        if not changed:
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_entry,
                ok=True,
                message=(
                    f"Scene {label} '{canonical_entry}' is already tracked."
                    if action == "add"
                    else f"Scene {label} '{canonical_entry}' was not present."
                ),
                data={field_name: entries},
            )

        self.repository.save_scene_state(scene_state)

        journal_entry = self._append_scene_note(
            text=f"Scene {label} {action_verb}: {canonical_entry}.",
            tags=["scene", tag, action],
            metadata={"field": field_name, "entry": canonical_entry, "action": action},
        )
        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_entry,
            ok=True,
            message=f"Scene {label} '{canonical_entry}' {action_verb}.",
            mutations=[
                StateMutation(
                    kind="set",
                    path=f"scene.{field_name}",
                    before=before,
                    after=list(entries),
                    note=f"Scene {label} list updated.",
                ),
                self._journal_append_mutation(journal_entry.id, f"Scene {label} journal entry appended."),
            ],
            data={field_name: entries, "action": action},
        )

    def _append_scene_note(self, *, text: str, tags: list[str], metadata: dict[str, Any] | None = None) -> JournalEntry:
        journal_entry = JournalEntry.create(
            kind="note",
            text=text,
            scene_id=self._current_scene_id(),
            tags=tags,
            metadata=metadata or {},
        )
        self.repository.append_journal(journal_entry.model_dump())
        return journal_entry

    def _journal_append_mutation(self, entry_id: str, note: str) -> StateMutation:
        return StateMutation(
            kind="append",
            path="journal.entries",
            before=None,
            after=entry_id,
            note=note,
        )

    def _set_scene_field(
        self,
        mutations: list[StateMutation],
        scene_state: dict[str, Any],
        field_name: str,
        value: Any,
        *,
        note: str,
    ) -> bool:
        before_value = scene_state.get(field_name)
        if before_value == value:
            return False
        scene_state[field_name] = value
        mutations.append(
            StateMutation(
                kind="set",
                path=f"scene.{field_name}",
                before=before_value,
                after=value,
                note=note,
            )
        )
        return True

    def _parse_new_target(self, raw_argument: str) -> tuple[str, str]:
        for delimiter in BUILDER_DELIMITERS:
            if delimiter in raw_argument:
                parts = self._split_builder_parts(raw_argument)
                if len(parts) < 2:
                    raise ValueError("/new requires a target type and payload.")
                return self._normalize(parts[0]), self._join_builder_parts(parts[1:])

        raw_argument = raw_argument.strip()
        first, _, remainder = raw_argument.partition(" ")
        target_type = self._normalize(first)
        if not remainder.strip():
            raise ValueError("/new requires a payload after the target type.")
        return target_type, remainder.strip()

    def _split_builder_parts(self, raw_argument: str) -> list[str]:
        if not raw_argument:
            return []
        for delimiter in BUILDER_DELIMITERS:
            if delimiter in raw_argument:
                return [part.strip() for part in raw_argument.split(delimiter) if part.strip()]
        return [raw_argument.strip()] if raw_argument.strip() else []

    def _join_builder_parts(self, parts: list[str]) -> str:
        return " :: ".join(parts)

    def _safe_int(self, raw_value: Any, default: int) -> int:
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            return default

    def _normalize(self, value: str) -> str:
        return value.strip().lower().replace("_", " ")

    def _normalize_key(self, value: str) -> str:
        return self._normalize(value).replace(" ", "_")

    def _normalize_region(self, value: Any) -> str | None:
        if value is None:
            return None
        normalized = self._normalize(str(value))
        return normalized.replace(" ", "_") or None

    def _find_mapping_key(self, mapping: dict[str, Any], raw_name: str) -> str | None:
        normalized = self._normalize(raw_name)
        for key in mapping:
            if self._normalize(key) == normalized:
                return key
        return None

    def _find_prefix_mapping_key(self, mapping: dict[str, Any], raw_name: str) -> str | None:
        best_match: tuple[int, str] | None = None
        for key in mapping:
            if not self._matches_argument_prefix(raw_name, key):
                continue
            score = len(self._normalize(key))
            if best_match is None or score > best_match[0]:
                best_match = (score, key)
        return best_match[1] if best_match is not None else None

    def _matches_argument_prefix(self, raw_name: str, candidate: str) -> bool:
        normalized_raw = self._normalize(raw_name)
        normalized_candidate = self._normalize(candidate)
        if not normalized_candidate:
            return False
        if normalized_raw == normalized_candidate:
            return True
        if not normalized_raw.startswith(normalized_candidate):
            return False
        remainder = normalized_raw[len(normalized_candidate):]
        return self._is_argument_boundary(remainder)

    def _is_argument_boundary(self, remainder: str) -> bool:
        if not remainder:
            return True
        return any(remainder.startswith(prefix) for prefix in ARGUMENT_BOUNDARY_PREFIXES)

    def _merge_item_definition_from_actor_note(
        self,
        registry_entry: dict[str, Any] | None,
        actor: dict[str, Any],
        item_name: str,
    ) -> dict[str, Any] | None:
        note_entry = actor.get("item_notes", {}).get(item_name)
        derived_entry = self._derive_item_definition(item_name, registry_entry, note_entry if isinstance(note_entry, dict) else None)
        if registry_entry is None:
            return derived_entry

        merged = deepcopy(registry_entry)
        if not merged:
            return derived_entry
        if not str(merged.get("kind", "")).strip() or self._normalize(str(merged.get("kind", ""))) == "misc":
            merged["kind"] = derived_entry["kind"]
        registry_kind_tokens = self._split_tag_tokens(str(merged.get("kind", "")))
        if "consumable" in registry_kind_tokens:
            merged["kind"] = "consumable"
            merged["consumable"] = True
        elif derived_entry.get("consumable") and not merged.get("consumable"):
            merged["kind"] = derived_entry["kind"]
            merged["consumable"] = True
        description = str(derived_entry.get("description", "")).strip()
        if description and not str(merged.get("description", "")).strip():
            merged["description"] = description
        if description and not str(merged.get("narration_hint", "")).strip():
            merged["narration_hint"] = description
        for field in ("effect", "heal_amount", "equippable_slot", "wear"):
            if field in derived_entry and merged.get(field) is None:
                merged[field] = deepcopy(derived_entry[field])
        return merged

    def _derive_item_definition(
        self,
        item_name: str,
        registry_entry: dict[str, Any] | None,
        note_entry: dict[str, Any] | None,
    ) -> dict[str, Any]:
        registry_kind_tokens = self._split_tag_tokens(str((registry_entry or {}).get("kind", "")))
        note_tags = self._split_tag_tokens(*((note_entry or {}).get("tags", [])))
        note_kind_tokens = self._split_tag_tokens(str((note_entry or {}).get("kind", "")))
        combined_tokens = list(dict.fromkeys(registry_kind_tokens + note_kind_tokens + note_tags))
        inferred_kind = "consumable" if "consumable" in combined_tokens else (combined_tokens[0] if combined_tokens else "misc")
        description = str((note_entry or {}).get("description") or (registry_entry or {}).get("description") or "").strip()
        derived_entry: dict[str, Any] = {
            "name": item_name,
            "kind": inferred_kind,
            "consumable": bool((registry_entry or {}).get("consumable")) or bool((note_entry or {}).get("consumable")) or "consumable" in combined_tokens,
        }
        if description:
            derived_entry["description"] = description
            derived_entry["narration_hint"] = description
        for field in ("effect", "heal_amount", "equippable_slot", "wear"):
            value = (registry_entry or {}).get(field)
            if value is None:
                value = (note_entry or {}).get(field)
            if value is not None:
                derived_entry[field] = deepcopy(value)
        return derived_entry

    def _split_tag_tokens(self, *values: Any) -> list[str]:
        tokens: list[str] = []
        for value in values:
            if value is None:
                continue
            if isinstance(value, (list, tuple, set)):
                tokens.extend(self._split_tag_tokens(*list(value)))
                continue
            raw_text = str(value)
            for part in raw_text.split(","):
                normalized = self._normalize(part)
                if normalized:
                    tokens.append(normalized)
        return list(dict.fromkeys(tokens))

    def _current_scene_id(self) -> str | None:
        return self.repository.load_scene_state().get("scene_id")

    def _current_day_counter(self) -> int | None:
        return self.repository.load_campaign_state().get("date", {}).get("day_counter")

    def _find_sequence_value(self, values: list[Any], raw_name: str) -> Any | None:
        normalized = self._normalize(raw_name)
        for value in values:
            if self._normalize(str(value)) == normalized:
                return value
        return None

    def _parse_scene_presence(self, raw_value: str | None, *, default: bool) -> bool:
        if raw_value is None:
            return default
        normalized = self._normalize(raw_value)
        if normalized in {"show", "visible", "true", "yes", "add", "active"}:
            return True
        if normalized in {"hide", "hidden", "false", "no", "remove", "inactive"}:
            return False
        return default

    def _split_csv(self, raw_value: str) -> list[str]:
        return [part.strip() for part in str(raw_value).split(",") if part.strip()]

    def _parse_command_argument_segment(self, segment: str) -> str | None:
        if not segment:
            return None

        trimmed = segment.strip()
        if trimmed.startswith("["):
            closing_index = trimmed.find("]")
            if closing_index == -1:
                candidate = trimmed[1:].strip()
                return candidate or None
            candidate = trimmed[1:closing_index].strip()
            return candidate or None

        if trimmed.lower().startswith("and "):
            trimmed = trimmed[4:].strip()
        return trimmed or None
