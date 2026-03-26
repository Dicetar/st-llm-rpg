from __future__ import annotations

import re
from typing import Any, Iterable

from app.domain.models import (
    CommandExecutionRequest,
    CommandExecutionResult,
    CommandInvocation,
    EventRecord,
    StateMutation,
    StateOverview,
    TurnExecutionResponse,
)
from app.services.repository import JsonStateRepository

COMMAND_PATTERN = re.compile(
    r"/(?P<name>[a-zA-Z_]+)(?:\s+\[(?P<bracket>[^\]]+)\]|(?P<plain>[^/]+?))?(?=(?:\s+(?:and\s+)?/\w+)|$)",
    re.IGNORECASE,
)


class CommandEngine:
    def __init__(self, repository: JsonStateRepository) -> None:
        self.repository = repository

    def parse_text(self, text: str) -> list[CommandInvocation]:
        commands: list[CommandInvocation] = []
        for match in COMMAND_PATTERN.finditer(text):
            name = match.group("name")
            argument = match.group("bracket") or match.group("plain")
            if argument:
                argument = argument.strip()
                if argument.lower().startswith("and "):
                    argument = argument[4:].strip()
            commands.append(CommandInvocation(name=name, argument=argument or None))
        return commands

    def execute(self, request: CommandExecutionRequest) -> TurnExecutionResponse:
        invocations = request.commands or self.parse_text(request.text or "")
        if not invocations:
            raise ValueError("No slash commands found in the request.")

        event_ids: list[str] = []
        results: list[CommandExecutionResult] = []

        for invocation in invocations:
            result = self._dispatch(request.actor_id, request.scene_id, invocation)
            results.append(result)
            event = EventRecord.create(
                actor_id=request.actor_id,
                scene_id=request.scene_id,
                command_name=invocation.name,
                ok=result.ok,
                message=result.message,
                payload={
                    "argument": invocation.argument,
                    "mutations": [mutation.model_dump() for mutation in result.mutations],
                    "data": result.data,
                },
            )
            self.repository.append_event(event.model_dump())
            event_ids.append(event.id)

        overview = self.build_overview(request.actor_id)
        narration_context = {
            "actor_id": request.actor_id,
            "scene": {
                "scene_id": overview.current_scene_id,
                "location": overview.current_location,
            },
            "command_results": [result.model_dump() for result in results],
            "post_command_overview": overview.model_dump(),
        }
        return TurnExecutionResponse(
            parsed_commands=invocations,
            results=results,
            overview=overview,
            event_ids=event_ids,
            narration_context=narration_context,
        )

    def build_overview(self, actor_id: str) -> StateOverview:
        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
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
            inventory=actor["inventory"],
            equipment=actor["equipment"],
            current_scene_id=scene_state.get("scene_id", "unknown_scene"),
            current_location=scene_state.get("location", "Unknown Location"),
            active_quests=active_quests,
        )

    def _dispatch(self, actor_id: str, scene_id: str | None, invocation: CommandInvocation) -> CommandExecutionResult:
        name = invocation.name
        if name == "inventory":
            return self._handle_inventory(actor_id, invocation)
        if name == "use_item":
            return self._handle_use_item(actor_id, invocation)
        if name == "cast":
            return self._handle_cast(actor_id, invocation)
        if name == "equip":
            return self._handle_equip(actor_id, invocation)
        if name == "quest":
            return self._handle_quest(actor_id, invocation)
        if name == "journal":
            return self._handle_journal(actor_id, invocation)
        return CommandExecutionResult(
            name=name,
            argument=invocation.argument,
            ok=False,
            message=f"Unknown command '/{name}'.",
        )

    def _handle_inventory(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        actor = self._require_actor(self.repository.load_character_state(), actor_id)
        inventory = dict(sorted(actor["inventory"].items(), key=lambda item: item[0]))
        return CommandExecutionResult(
            name=invocation.name,
            argument=invocation.argument,
            ok=True,
            message="Inventory retrieved.",
            data={"inventory": inventory},
        )

    def _handle_use_item(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/use_item requires an item name.")

        character_state = self.repository.load_character_state()
        actor = self._require_actor(character_state, actor_id)
        item_registry = self.repository.load_item_registry().get("items", {})
        canonical_item = self._find_inventory_item(actor["inventory"], invocation.argument)
        if canonical_item is None:
            return CommandExecutionResult(
                name=invocation.name,
                argument=invocation.argument,
                ok=False,
                message=f"{actor['name']} does not have '{invocation.argument}'.",
            )

        item_def = item_registry.get(canonical_item.lower())
        if not item_def or not item_def.get("consumable"):
            return CommandExecutionResult(
                name=invocation.name,
                argument=canonical_item,
                ok=False,
                message=f"{canonical_item} cannot be used as a consumable item.",
            )

        mutations: list[StateMutation] = []
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

        before_qty = actor["inventory"][canonical_item]
        after_qty = before_qty - 1
        if after_qty <= 0:
            del actor["inventory"][canonical_item]
        else:
            actor["inventory"][canonical_item] = after_qty
        mutations.append(StateMutation(kind="set", path=f"actors.{actor_id}.inventory.{canonical_item}", before=before_qty, after=max(after_qty, 0), note="Consumable quantity decremented."))
        self.repository.save_character_state(character_state)

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
        canonical_spell = self._find_known_spell(actor["known_spells"], invocation.argument)
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
                data={"spell_level": level, "remaining_slots": actor["spell_slots"][slot_key]},
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
        canonical_item = self._find_inventory_item(actor["inventory"], invocation.argument)
        if canonical_item is None:
            return CommandExecutionResult(name=invocation.name, argument=invocation.argument, ok=False, message=f"{actor['name']} does not have '{invocation.argument}'.")

        item_def = self.repository.load_item_registry().get("items", {}).get(canonical_item.lower())
        slot = (item_def or {}).get("equippable_slot")
        if not slot:
            return CommandExecutionResult(name=invocation.name, argument=canonical_item, ok=False, message=f"{canonical_item} is not equippable.")

        before = actor["equipment"].get(slot)
        actor["equipment"][slot] = canonical_item
        self.repository.save_character_state(character_state)
        mutation = StateMutation(kind="set", path=f"actors.{actor_id}.equipment.{slot}", before=before, after=canonical_item, note="Equipped item set.")
        return CommandExecutionResult(
            name=invocation.name,
            argument=canonical_item,
            ok=True,
            message=f"{actor['name']} equips {canonical_item} in slot '{slot}'.",
            mutations=[mutation],
            data={"slot": slot},
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

    def _handle_journal(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        entries = self.repository.list_journal(limit=10)
        return CommandExecutionResult(
            name=invocation.name,
            argument=invocation.argument,
            ok=True,
            message="Recent journal entries retrieved.",
            data={"entries": entries},
        )

    def _require_actor(self, character_state: dict[str, Any], actor_id: str) -> dict[str, Any]:
        actors = character_state.get("actors", {})
        if actor_id not in actors:
            raise KeyError(f"Unknown actor_id '{actor_id}'.")
        return actors[actor_id]

    def _find_inventory_item(self, inventory: dict[str, int], raw_name: str) -> str | None:
        normalized = self._normalize(raw_name)
        for name in inventory:
            if self._normalize(name) == normalized:
                return name
        return None

    def _find_known_spell(self, known_spells: dict[str, Any], raw_name: str) -> str | None:
        normalized = self._normalize(raw_name)
        for key, payload in known_spells.items():
            candidate_names = {key, payload.get("name", "")}
            for candidate in candidate_names:
                if self._normalize(candidate) == normalized:
                    return payload.get("name") or key
        return None

    def _normalize(self, value: str) -> str:
        return value.strip().lower().replace("_", " ")
