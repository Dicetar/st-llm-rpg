from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.domain.models import EventRecord, ExtractedUpdate, JournalEntry, StateMutation
from app.services.lore_update_service import LoreUpdateService
from app.services.repository import StateRepository, TransactionalStateRepository


class ExtractionService:
    SAFE_CATEGORIES = {
        "item_change",
        "quest_progress",
        "location_change",
        "condition_change",
        "scene_object_change",
    }

    def __init__(self, repository: StateRepository) -> None:
        self.repository = repository

    def apply_updates(
        self,
        *,
        turn_id: str,
        actor_id: str,
        scene_id: str | None,
        updates: list[ExtractedUpdate],
        mode: str,
    ) -> dict[str, Any]:
        working_repository = TransactionalStateRepository(self.repository)
        lore_service = LoreUpdateService(working_repository)
        effective_scene_id = scene_id or working_repository.load_scene_state().get("scene_id")
        applied_mutations: list[StateMutation] = []
        staged_updates: list[ExtractedUpdate] = []
        refresh_hints: set[str] = set()
        lore_results: list[dict[str, Any]] = []

        for update in updates:
            if update.category not in self.SAFE_CATEGORIES:
                staged_updates.append(update)
                self._record_staged_update(
                    working_repository,
                    turn_id,
                    actor_id,
                    effective_scene_id,
                    update,
                    reason="unsafe_category",
                )
                refresh_hints.update({"events", "journal"})
                continue

            handler = getattr(self, f"_apply_{update.category}")
            try:
                mutations = handler(working_repository, actor_id, update)
            except (KeyError, TypeError, ValueError) as exc:
                staged_updates.append(update)
                self._record_staged_update(
                    working_repository,
                    turn_id,
                    actor_id,
                    effective_scene_id,
                    update,
                    reason=f"validation_error: {exc}",
                )
                refresh_hints.update({"events", "journal"})
                continue
            if not mutations:
                continue

            applied_mutations.extend(mutations)
            refresh_hints.update(self._refresh_hints_for_category(update.category))
            lore_results.append(
                {
                    "name": "extractor",
                    "argument": update.category,
                    "ok": True,
                    "message": update.description,
                    "mutations": [mutation.model_dump() for mutation in mutations],
                }
            )
            working_repository.append_event(
                EventRecord.create(
                    turn_id=turn_id,
                    actor_id=actor_id,
                    scene_id=effective_scene_id,
                    command_name="extractor",
                    event_type="extracted_update_applied",
                    source="extractor",
                    ok=True,
                    message=update.description,
                    payload={"update": update.model_dump(), "mutations": [mutation.model_dump() for mutation in mutations]},
                ).model_dump()
            )

        lore_sync: dict[str, Any] = {}
        if mode == "commit" and (applied_mutations or staged_updates):
            lore_sync = lore_service.sync_from_canonical_state(
                actor_id=actor_id,
                command_results=lore_results,
                scene_id=effective_scene_id,
            )
            refresh_hints.add("lorebook")

        if mode == "commit" and (applied_mutations or staged_updates):
            working_repository.flush()

        return {
            "applied_updates": applied_mutations,
            "staged_updates": staged_updates,
            "refresh_hints": sorted(refresh_hints),
            "lore_sync": lore_sync,
        }

    def _record_staged_update(
        self,
        repository: TransactionalStateRepository,
        turn_id: str,
        actor_id: str,
        scene_id: str | None,
        update: ExtractedUpdate,
        reason: str,
    ) -> None:
        repository.append_event(
            EventRecord.create(
                turn_id=turn_id,
                actor_id=actor_id,
                scene_id=scene_id,
                command_name="extractor",
                event_type="extracted_update_staged",
                source="extractor",
                ok=False,
                message=update.description,
                payload={"update": update.model_dump(), "reason": reason},
            ).model_dump()
        )
        repository.append_journal(
            JournalEntry.create(
                kind="relationship_note" if update.category == "relationship_shift" else "note",
                text=update.description,
                scene_id=scene_id,
                tags=["extractor", update.category, "staged"],
                metadata={"update": update.model_dump(), "reason": reason},
            ).model_dump()
        )

    def _apply_item_change(
        self,
        repository: TransactionalStateRepository,
        actor_id: str,
        update: ExtractedUpdate,
    ) -> list[StateMutation]:
        payload = deepcopy(update.payload)
        item_name = str(payload.get("item_name", "")).strip()
        quantity_delta = int(payload.get("quantity_delta", 0))
        if not item_name or quantity_delta == 0:
            return []

        character_state = repository.load_character_state()
        actor = character_state.get("actors", {}).get(actor_id)
        if actor is None:
            raise KeyError(f"Unknown actor_id '{actor_id}'.")

        inventory = actor.setdefault("inventory", {})
        item_notes = actor.setdefault("item_notes", {})
        item_registry_wrapper = repository.load_item_registry()
        item_registry = item_registry_wrapper.setdefault("items", {})
        existing_name = self._find_key(inventory, item_name) or item_name
        before_qty = int(inventory.get(existing_name, 0))
        after_qty = max(0, before_qty + quantity_delta)
        if after_qty == before_qty:
            return []

        mutations = [
            StateMutation(
                kind="set",
                path=f"actors.{actor_id}.inventory.{existing_name}",
                before=before_qty,
                after=after_qty,
                note=f"Extractor applied quantity delta {quantity_delta}.",
            )
        ]

        if after_qty <= 0:
            inventory.pop(existing_name, None)
        else:
            inventory[existing_name] = after_qty

        description = str(payload.get("description", "")).strip()
        item_kind = str(payload.get("kind", "misc")).strip() or "misc"
        if description:
            previous_note = item_notes.get(existing_name)
            item_notes[existing_name] = {
                "description": description,
                "tags": list(dict.fromkeys([item_kind, "extractor_applied"])),
                "source": "extractor",
                "active": True,
            }
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"actors.{actor_id}.item_notes.{existing_name}",
                    before=previous_note,
                    after=item_notes[existing_name],
                    note="Extractor upserted item note.",
                )
            )
            previous_registry = item_registry.get(existing_name.lower())
            item_registry[existing_name.lower()] = {
                "name": existing_name,
                "kind": item_kind,
                "consumable": item_kind.lower() == "consumable",
                "description": description,
                "narration_hint": description,
            }
            mutations.append(
                StateMutation(
                    kind="set",
                    path=f"item_registry.items.{existing_name.lower()}",
                    before=previous_registry,
                    after=item_registry[existing_name.lower()],
                    note="Extractor upserted item registry entry.",
                )
            )

        repository.save_character_state(character_state)
        repository.save_item_registry(item_registry_wrapper)
        return mutations

    def _apply_quest_progress(
        self,
        repository: TransactionalStateRepository,
        _actor_id: str,
        update: ExtractedUpdate,
    ) -> list[StateMutation]:
        payload = deepcopy(update.payload)
        quest_name = str(payload.get("quest_name", "")).strip()
        if not quest_name:
            return []

        campaign_state = repository.load_campaign_state()
        quests = campaign_state.setdefault("quests", {})
        quest_record = quests.setdefault(
            quest_name,
            {"status": "active", "note": "", "tags": ["extractor", "quest"], "last_updated_day": campaign_state.get("date", {}).get("day_counter")},
        )
        mutations: list[StateMutation] = []

        if "status" in payload and str(payload["status"]).strip():
            before_status = quest_record.get("status")
            after_status = str(payload["status"]).strip()
            if after_status != before_status:
                quest_record["status"] = after_status
                mutations.append(
                    StateMutation(
                        kind="set",
                        path=f"campaign.quests.{quest_name}.status",
                        before=before_status,
                        after=quest_record["status"],
                        note="Extractor updated quest status.",
                    )
                )

        if "note" in payload and str(payload["note"]).strip():
            before_note = quest_record.get("note")
            after_note = str(payload["note"]).strip()
            if after_note != before_note:
                quest_record["note"] = after_note
                mutations.append(
                    StateMutation(
                        kind="set",
                        path=f"campaign.quests.{quest_name}.note",
                        before=before_note,
                        after=quest_record["note"],
                        note="Extractor updated quest note.",
                    )
                )

        if "current_stage" in payload and str(payload["current_stage"]).strip():
            before_stage = quest_record.get("current_stage")
            after_stage = str(payload["current_stage"]).strip()
            if after_stage != before_stage:
                quest_record["current_stage"] = after_stage
                mutations.append(
                    StateMutation(
                        kind="set",
                        path=f"campaign.quests.{quest_name}.current_stage",
                        before=before_stage,
                        after=quest_record["current_stage"],
                        note="Extractor updated quest stage.",
                    )
                )

        if not mutations:
            return []
        quest_record["last_updated_day"] = campaign_state.get("date", {}).get("day_counter")
        repository.save_campaign_state(campaign_state)
        return mutations

    def _apply_location_change(
        self,
        repository: TransactionalStateRepository,
        _actor_id: str,
        update: ExtractedUpdate,
    ) -> list[StateMutation]:
        payload = deepcopy(update.payload)
        location = str(payload.get("location", "")).strip()
        if not location:
            return []

        scene_state = repository.load_scene_state()
        mutations: list[StateMutation] = []
        before_location = scene_state.get("location")
        if location != before_location:
            scene_state["location"] = location
            mutations.append(
                StateMutation(
                    kind="set",
                    path="scene.location",
                    before=before_location,
                    after=location,
                    note="Extractor updated current location.",
                )
            )
        if "scene_id" in payload and str(payload["scene_id"]).strip():
            before_scene_id = scene_state.get("scene_id")
            after_scene_id = str(payload["scene_id"]).strip()
            if after_scene_id != before_scene_id:
                scene_state["scene_id"] = after_scene_id
                mutations.append(
                    StateMutation(
                        kind="set",
                        path="scene.scene_id",
                        before=before_scene_id,
                        after=scene_state["scene_id"],
                        note="Extractor updated scene id.",
                    )
                )
        if "time_of_day" in payload and str(payload["time_of_day"]).strip():
            before_time = scene_state.get("time_of_day")
            after_time = str(payload["time_of_day"]).strip()
            if after_time != before_time:
                scene_state["time_of_day"] = after_time
                mutations.append(
                    StateMutation(
                        kind="set",
                        path="scene.time_of_day",
                        before=before_time,
                        after=scene_state["time_of_day"],
                        note="Extractor updated scene time of day.",
                    )
                )
        if not mutations:
            return []
        repository.save_scene_state(scene_state)
        return mutations

    def _apply_condition_change(
        self,
        repository: TransactionalStateRepository,
        actor_id: str,
        update: ExtractedUpdate,
    ) -> list[StateMutation]:
        payload = deepcopy(update.payload)
        condition = str(payload.get("condition", "")).strip()
        action = str(payload.get("action", "add")).strip().lower()
        if not condition or action not in {"add", "remove"}:
            return []

        character_state = repository.load_character_state()
        actor = character_state.get("actors", {}).get(actor_id)
        if actor is None:
            raise KeyError(f"Unknown actor_id '{actor_id}'.")

        conditions = actor.setdefault("conditions", [])
        before = list(conditions)
        if action == "add" and condition not in conditions:
            conditions.append(condition)
        if action == "remove":
            conditions[:] = [entry for entry in conditions if entry != condition]
        if conditions == before:
            return []
        repository.save_character_state(character_state)
        return [
            StateMutation(
                kind="set",
                path=f"actors.{actor_id}.conditions",
                before=before,
                after=list(conditions),
                note=f"Extractor {action}ed condition '{condition}'.",
            )
        ]

    def _apply_scene_object_change(
        self,
        repository: TransactionalStateRepository,
        _actor_id: str,
        update: ExtractedUpdate,
    ) -> list[StateMutation]:
        payload = deepcopy(update.payload)
        object_name = str(payload.get("object_name", "")).strip()
        if not object_name:
            return []

        scene_state = repository.load_scene_state()
        objects = scene_state.setdefault("notable_objects", [])
        details = scene_state.setdefault("notable_object_details", {})
        visible = self._coerce_bool(payload.get("visible", True), default=True)
        before_objects = list(objects)
        before_detail = deepcopy(details.get(object_name))
        description = str(payload.get("description", "")).strip()
        if not visible and object_name not in objects and before_detail is None and not description:
            return []

        if visible and object_name not in objects:
            objects.append(object_name)
        if not visible:
            objects[:] = [entry for entry in objects if entry != object_name]

        detail_entry = details.setdefault(object_name, {})
        if description:
            detail_entry["description"] = description
        detail_entry["active"] = visible
        detail_entry.setdefault("source", "extractor")
        detail_entry.setdefault("last_updated_day", None)
        if objects == before_objects and details.get(object_name) == before_detail:
            return []

        repository.save_scene_state(scene_state)
        return [
            StateMutation(
                kind="set",
                path="scene.notable_objects",
                before=before_objects,
                after=list(objects),
                note=f"Extractor {'showed' if visible else 'hid'} scene object '{object_name}'.",
            ),
            StateMutation(
                kind="set",
                path=f"scene.notable_object_details.{object_name}",
                before=before_detail,
                after=details.get(object_name),
                note="Extractor updated scene object detail.",
            ),
        ]

    def _refresh_hints_for_category(self, category: str) -> set[str]:
        mapping = {
            "item_change": {"inventory", "actor", "overview"},
            "quest_progress": {"quests", "campaign", "overview"},
            "location_change": {"scene", "overview"},
            "condition_change": {"actor", "overview"},
            "scene_object_change": {"scene", "overview"},
        }
        return mapping.get(category, {"overview"})

    def _find_key(self, mapping: dict[str, Any], raw_name: str) -> str | None:
        normalized = raw_name.strip().lower().replace("_", " ")
        for key in mapping:
            if key.strip().lower().replace("_", " ") == normalized:
                return key
        return None

    def _coerce_bool(self, value: Any, *, default: bool) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default

        normalized = str(value).strip().lower().replace("_", " ").replace("-", " ")
        truthy = {"1", "true", "yes", "y", "visible", "show", "shown", "add", "active", "present"}
        falsy = {"0", "false", "no", "n", "hidden", "hide", "remove", "inactive", "absent"}
        if normalized in truthy:
            return True
        if normalized in falsy:
            return False
        return default
