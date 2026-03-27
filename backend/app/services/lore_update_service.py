from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.services.repository import JsonStateRepository


class LoreUpdateService:
    def __init__(self, repository: JsonStateRepository) -> None:
        self.repository = repository

    def sync_from_canonical_state(
        self,
        *,
        actor_id: str,
        command_results: list[dict[str, Any]] | None = None,
        scene_id: str | None = None,
    ) -> dict[str, Any]:
        character_state = self.repository.load_character_state()
        campaign_state = self.repository.load_campaign_state()
        scene_state = self.repository.load_scene_state()
        item_registry = self.repository.load_item_registry().get("items", {})
        lorebook = self.repository.load_lorebook_state()

        actors = character_state.get("actors", {})
        if actor_id not in actors:
            raise KeyError(f"Unknown actor_id '{actor_id}'.")
        actor = actors[actor_id]

        now = datetime.now(timezone.utc).isoformat()
        lorebook["schema_version"] = "0.1.0"
        lorebook["revision"] = int(lorebook.get("revision", 0)) + 1
        lorebook["updated_at"] = now

        lorebook.setdefault("actors", {})[actor_id] = self._build_actor_entry(actor_id, actor, scene_state, now)
        self._sync_items(lorebook, actor_id, actor, item_registry, scene_state, now)
        self._sync_quests(lorebook, campaign_state, now)
        self._sync_relationships(lorebook, campaign_state, now)
        self._sync_location(lorebook, scene_state, now)
        timeline_added = self._append_timeline_entries(lorebook, actor_id, scene_state, command_results or [], now, scene_id)

        self.repository.save_lorebook_state(lorebook)
        return {
            "actor_id": actor_id,
            "revision": lorebook["revision"],
            "timeline_events_added": timeline_added,
            "synced_items": len(lorebook.get("items", {})),
            "synced_quests": len(lorebook.get("quests", {})),
            "synced_relationships": len(lorebook.get("relationships", {})),
            "location_key": self._location_key(scene_state),
        }

    def _build_actor_entry(self, actor_id: str, actor: dict[str, Any], scene_state: dict[str, Any], updated_at: str) -> dict[str, Any]:
        equipment = actor.get("equipment", {})
        held = {slot: item for slot, item in equipment.get("held", {}).items() if item}
        worn_items = [entry.get("item") for entry in equipment.get("worn_items", []) if entry.get("worn", True) and entry.get("item")]
        known_spells = [payload.get("name") or key for key, payload in actor.get("known_spells", {}).items()]
        inventory_refs = [name for name, qty in actor.get("inventory", {}).items() if int(qty) > 0]
        return {
            "actor_id": actor_id,
            "name": actor.get("name"),
            "current_scene_id": scene_state.get("scene_id"),
            "current_location": scene_state.get("location"),
            "conditions": actor.get("conditions", []),
            "held_items": held,
            "worn_items": worn_items,
            "inventory_refs": inventory_refs,
            "known_spells": sorted(known_spells),
            "custom_skill_refs": sorted(actor.get("custom_skills", {}).keys()),
            "updated_at": updated_at,
        }

    def _sync_items(
        self,
        lorebook: dict[str, Any],
        actor_id: str,
        actor: dict[str, Any],
        item_registry: dict[str, Any],
        scene_state: dict[str, Any],
        updated_at: str,
    ) -> None:
        items_bucket = lorebook.setdefault("items", {})
        equipment = actor.get("equipment", {})
        held_items = set(item for item in equipment.get("held", {}).values() if item)
        worn_items = set(entry.get("item") for entry in equipment.get("worn_items", []) if entry.get("worn", True) and entry.get("item"))

        for item_entry in items_bucket.values():
            owners = item_entry.setdefault("owners", {})
            owners.pop(actor_id, None)
            equipped_by = item_entry.setdefault("equipped_by", [])
            item_entry["equipped_by"] = [value for value in equipped_by if value != actor_id]

        item_notes = actor.get("item_notes", {})
        for item_name, quantity in actor.get("inventory", {}).items():
            key = self._normalize_key(item_name)
            note = item_notes.get(item_name, {})
            registry_entry = item_registry.get(item_name.lower(), {})
            item_entry = items_bucket.setdefault(key, {
                "id": key,
                "name": item_name,
                "description": "",
                "tags": [],
                "owners": {},
                "equipped_by": [],
                "updated_at": updated_at,
            })
            item_entry["name"] = item_name
            item_entry["description"] = note.get("description") or registry_entry.get("description") or item_entry.get("description") or ""
            merged_tags = []
            for tag in note.get("tags", []):
                if tag not in merged_tags:
                    merged_tags.append(tag)
            kind = registry_entry.get("kind")
            if kind and kind not in merged_tags:
                merged_tags.append(kind)
            item_entry["tags"] = merged_tags
            item_entry.setdefault("owners", {})[actor_id] = int(quantity)
            equipped_by = item_entry.setdefault("equipped_by", [])
            if item_name in held_items or item_name in worn_items:
                if actor_id not in equipped_by:
                    equipped_by.append(actor_id)
            item_entry["last_seen_location"] = scene_state.get("location")
            item_entry["updated_at"] = updated_at

    def _sync_quests(self, lorebook: dict[str, Any], campaign_state: dict[str, Any], updated_at: str) -> None:
        quests_bucket = lorebook.setdefault("quests", {})
        for quest_name, payload in campaign_state.get("quests", {}).items():
            key = self._normalize_key(quest_name)
            quests_bucket[key] = {
                "id": key,
                "name": quest_name,
                "status": payload.get("status", "unknown"),
                "note": payload.get("note") or payload.get("description") or "",
                "tags": payload.get("tags", []),
                "last_updated_day": payload.get("last_updated_day"),
                "updated_at": updated_at,
            }

    def _sync_relationships(self, lorebook: dict[str, Any], campaign_state: dict[str, Any], updated_at: str) -> None:
        relationships_bucket = lorebook.setdefault("relationships", {})
        for name, payload in campaign_state.get("relationships", {}).items():
            key = self._normalize_key(name)
            relationships_bucket[key] = {
                "id": key,
                "name": name,
                "score": payload.get("score"),
                "note": payload.get("note") or payload.get("description") or payload.get("summary") or "",
                "updated_at": updated_at,
            }

    def _sync_location(self, lorebook: dict[str, Any], scene_state: dict[str, Any], updated_at: str) -> None:
        key = self._location_key(scene_state)
        lorebook.setdefault("locations", {})[key] = {
            "id": key,
            "scene_id": scene_state.get("scene_id"),
            "location": scene_state.get("location"),
            "scene_tags": scene_state.get("scene_tags", []),
            "notable_objects": scene_state.get("notable_objects", []),
            "exits": scene_state.get("exits", []),
            "updated_at": updated_at,
        }

    def _append_timeline_entries(
        self,
        lorebook: dict[str, Any],
        actor_id: str,
        scene_state: dict[str, Any],
        command_results: list[dict[str, Any]],
        updated_at: str,
        requested_scene_id: str | None,
    ) -> int:
        timeline = lorebook.setdefault("timeline", [])
        added = 0
        for result in command_results:
            timeline.append({
                "id": f"lore_evt_{uuid4().hex[:10]}",
                "timestamp": updated_at,
                "actor_id": actor_id,
                "scene_id": requested_scene_id or scene_state.get("scene_id"),
                "location": scene_state.get("location"),
                "command_name": result.get("name"),
                "argument": result.get("argument"),
                "ok": result.get("ok"),
                "message": result.get("message"),
                "mutations": result.get("mutations", []),
            })
            added += 1
        if len(timeline) > 200:
            lorebook["timeline"] = timeline[-200:]
        return added

    def _location_key(self, scene_state: dict[str, Any]) -> str:
        scene_id = scene_state.get("scene_id")
        if scene_id:
            return str(scene_id)
        return self._normalize_key(scene_state.get("location") or "unknown_location")

    def _normalize_key(self, value: str) -> str:
        return str(value).strip().lower().replace(" ", "_")
