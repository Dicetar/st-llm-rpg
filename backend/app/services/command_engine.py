from __future__ import annotations

import re
from typing import Any, Callable

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
        self.command_handlers: dict[str, Callable[[str, CommandInvocation], CommandExecutionResult]] = {
            "inventory": self._handle_inventory,
            "use_item": self._handle_use_item,
            "cast": self._handle_cast,
            "equip": self._handle_equip,
            "quest": self._handle_quest,
            "quests": self._handle_quest,
            "journal": self._handle_journal,
            "new": self._handle_new,
            "new_item": self._handle_new_item,
            "new_spell": self._handle_new_spell,
            "new_custom_skill": self._handle_new_custom_skill,
        }

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
            inventory=actor.get("inventory", {}),
            equipment=actor.get("equipment", {}),
            current_scene_id=scene_state.get("scene_id", "unknown_scene"),
            current_location=scene_state.get("location", "Unknown Location"),
            active_quests=active_quests,
        )

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
        item_registry = self.repository.load_item_registry().get("items", {})
        inventory = actor.setdefault("inventory", {})
        canonical_item = self._find_inventory_item(inventory, invocation.argument)
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

        before_qty = inventory[canonical_item]
        after_qty = before_qty - 1
        if after_qty <= 0:
            del inventory[canonical_item]
        else:
            inventory[canonical_item] = after_qty
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
        inventory = actor.setdefault("inventory", {})
        canonical_item = self._find_inventory_item(inventory, invocation.argument)
        if canonical_item is None:
            return CommandExecutionResult(name=invocation.name, argument=invocation.argument, ok=False, message=f"{actor['name']} does not have '{invocation.argument}'.")

        item_def = self.repository.load_item_registry().get("items", {}).get(canonical_item.lower())
        slot = (item_def or {}).get("equippable_slot")
        if not slot:
            return CommandExecutionResult(name=invocation.name, argument=canonical_item, ok=False, message=f"{canonical_item} is not equippable.")

        equipment = actor.setdefault("equipment", {})
        before = equipment.get(slot)
        equipment[slot] = canonical_item
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

    def _handle_new(self, actor_id: str, invocation: CommandInvocation) -> CommandExecutionResult:
        if not invocation.argument:
            return CommandExecutionResult(name=invocation.name, ok=False, message="/new requires a target type and payload.")

        target_type, builder_argument = self._parse_new_target(invocation.argument)
        alias_map = {
            "item": "new_item",
            "spell": "new_spell",
            "custom_skill": "new_custom_skill",
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
        item_kind = parts[2] if len(parts) > 2 else "misc"
        description = parts[3] if len(parts) > 3 else f"Player-defined item: {item_name}."

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

        item_registry[canonical_item.lower()] = {
          "name": canonical_item,
          "kind": item_kind,
          "consumable": item_kind.lower() == "consumable",
          "description": description,
          "narration_hint": description,
        }

        item_notes[canonical_item] = {
          "description": description,
          "tags": [item_kind.lower(), "player_defined"],
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
                StateMutation(kind="set", path=f"actors.{actor_id}.item_notes.{canonical_item}", before=None if canonical_item not in item_notes else item_notes[canonical_item], after=item_notes[canonical_item], note="Item note upserted."),
                StateMutation(kind="set", path=f"item_registry.items.{canonical_item.lower()}", before=None, after=item_registry[canonical_item.lower()], note="Item registry entry upserted."),
            ],
            data={"quantity": after_qty, "kind": item_kind, "description": description},
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
                StateMutation(kind="set", path=f"spell_registry.spells.{key}", before=None, after=spell_registry[key], note="Spell registry entry upserted."),
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

    def _parse_new_target(self, raw_argument: str) -> tuple[str, str]:
        if "|" in raw_argument:
            parts = self._split_builder_parts(raw_argument)
            if len(parts) < 2:
                raise ValueError("/new requires a target type and payload.")
            return self._normalize(parts[0]), " | ".join(parts[1:])

        raw_argument = raw_argument.strip()
        first, _, remainder = raw_argument.partition(" ")
        target_type = self._normalize(first)
        if not remainder.strip():
            raise ValueError("/new requires a payload after the target type.")
        return target_type, remainder.strip()

    def _split_builder_parts(self, raw_argument: str) -> list[str]:
        if not raw_argument:
            return []
        if "|" not in raw_argument:
            return [raw_argument.strip()] if raw_argument.strip() else []
        return [part.strip() for part in raw_argument.split("|") if part.strip()]

    def _safe_int(self, raw_value: str, default: int) -> int:
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            return default

    def _normalize(self, value: str) -> str:
        return value.strip().lower().replace("_", " ")

    def _normalize_key(self, value: str) -> str:
        return self._normalize(value).replace(" ", "_")
