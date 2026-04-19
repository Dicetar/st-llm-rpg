from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.services.repository import StateRepository


class LoreUpdateService:
    LOREBOOK_SCHEMA_VERSION = "0.2.0"
    JOURNAL_INSERTION_KINDS = {
        "scene_summary",
        "session_summary",
        "canon_fact",
        "fact",
        "quest_update",
        "relationship_note",
    }
    KEYWORD_STOPWORDS = {
        "and",
        "are",
        "but",
        "day",
        "for",
        "from",
        "has",
        "have",
        "into",
        "its",
        "not",
        "scene",
        "that",
        "the",
        "this",
        "with",
    }

    def __init__(self, repository: StateRepository) -> None:
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
        lorebook["schema_version"] = self.LOREBOOK_SCHEMA_VERSION
        lorebook["revision"] = int(lorebook.get("revision", 0)) + 1
        lorebook["updated_at"] = now
        lorebook.setdefault("actors", {})
        lorebook.setdefault("items", {})
        lorebook.setdefault("quests", {})
        lorebook.setdefault("relationships", {})
        lorebook.setdefault("locations", {})
        lorebook.setdefault("timeline", [])

        lorebook["actors"][actor_id] = self._build_actor_entry(actor_id, actor, scene_state, now)
        self._sync_items(lorebook, actor_id, actor, item_registry, scene_state, now)
        self._sync_quests(lorebook, campaign_state, now)
        self._sync_relationships(lorebook, campaign_state, now)
        self._sync_location(lorebook, scene_state, now)
        timeline_added = self._append_timeline_entries(lorebook, actor_id, scene_state, command_results or [], now, scene_id)
        self._sync_insertion_entries(lorebook, actor_id, actor, campaign_state, scene_state, item_registry)

        self.repository.save_lorebook_state(lorebook)
        return {
            "actor_id": actor_id,
            "revision": lorebook["revision"],
            "timeline_events_added": timeline_added,
            "synced_items": len(lorebook.get("items", {})),
            "synced_quests": len(lorebook.get("quests", {})),
            "synced_relationships": len(lorebook.get("relationships", {})),
            "synced_insertion_entries": len(lorebook.get("insertion_entries", {})),
            "location_key": self._location_key(scene_state),
        }

    def build_insertion_payload(self, *, actor_id: str = "player", sync: bool = False) -> dict[str, Any]:
        lorebook = self.repository.load_lorebook_state()
        if sync and not lorebook.get("insertion_entries"):
            self.sync_from_canonical_state(actor_id=actor_id, command_results=[], scene_id=None)
            lorebook = self.repository.load_lorebook_state()

        entries = self._sorted_insertion_entries(lorebook.get("insertion_entries", {}))
        return {
            "schema_version": lorebook.get("schema_version", self.LOREBOOK_SCHEMA_VERSION),
            "revision": lorebook.get("revision", 0),
            "updated_at": lorebook.get("updated_at"),
            "entry_count": len(entries),
            "entries": entries,
            "sillytavern_world_info": self._build_sillytavern_world_info(entries),
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
            item_entry = items_bucket.setdefault(
                key,
                {
                    "id": key,
                    "name": item_name,
                    "description": "",
                    "tags": [],
                    "owners": {},
                    "equipped_by": [],
                    "updated_at": updated_at,
                },
            )
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
            "time_of_day": scene_state.get("time_of_day"),
            "scene_tags": scene_state.get("scene_tags", []),
            "nearby_npcs": scene_state.get("nearby_npcs", []),
            "notable_objects": scene_state.get("notable_objects", []),
            "visible_clues": scene_state.get("visible_clues", []),
            "active_hazards": scene_state.get("active_hazards", []),
            "recent_discoveries": scene_state.get("recent_discoveries", []),
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
            timeline.append(
                {
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
                }
            )
            added += 1
        if len(timeline) > 200:
            lorebook["timeline"] = timeline[-200:]
        return added

    def _sync_insertion_entries(
        self,
        lorebook: dict[str, Any],
        actor_id: str,
        actor: dict[str, Any],
        campaign_state: dict[str, Any],
        scene_state: dict[str, Any],
        item_registry: dict[str, Any],
    ) -> None:
        existing = lorebook.get("insertion_entries", {})
        manual_entries = {
            key: value
            for key, value in existing.items()
            if isinstance(value, dict) and value.get("source") == "manual"
        } if isinstance(existing, dict) else {}
        generated: dict[str, dict[str, Any]] = {}

        def add(entry: dict[str, Any]) -> None:
            generated[entry["id"]] = entry

        add(self._actor_insertion_entry(actor_id, actor, scene_state))
        add(self._scene_insertion_entry(scene_state))
        add(self._campaign_insertion_entry(campaign_state))

        for quest_name, payload in campaign_state.get("quests", {}).items():
            add(self._quest_insertion_entry(quest_name, payload))

        for relationship_name, payload in campaign_state.get("relationships", {}).items():
            add(self._relationship_insertion_entry(relationship_name, payload))

        for item_name, quantity in actor.get("inventory", {}).items():
            if int(quantity) <= 0:
                continue
            registry_entry = item_registry.get(item_name.lower(), {})
            note = actor.get("item_notes", {}).get(item_name, {})
            add(self._item_insertion_entry(actor_id, item_name, int(quantity), registry_entry, note, scene_state))

        for fact in campaign_state.get("known_facts", []):
            if isinstance(fact, dict):
                add(self._fact_insertion_entry(fact, "canon_fact"))

        for event in campaign_state.get("recent_major_events", []):
            if isinstance(event, dict):
                add(self._fact_insertion_entry(event, "major_event"))

        for flag_name, payload in campaign_state.get("plot_flag_notes", {}).items():
            if isinstance(payload, dict) and payload.get("active", True):
                add(self._plot_flag_insertion_entry(flag_name, payload))

        for journal_entry in reversed(self.repository.list_journal(limit=40)):
            if journal_entry.get("kind") in self.JOURNAL_INSERTION_KINDS:
                add(self._journal_insertion_entry(journal_entry))

        lorebook["insertion_entries"] = {**manual_entries, **generated}

    def _actor_insertion_entry(self, actor_id: str, actor: dict[str, Any], scene_state: dict[str, Any]) -> dict[str, Any]:
        name = actor.get("name") or actor_id
        conditions = actor.get("conditions") or []
        equipment = actor.get("equipment", {})
        held = {slot: item for slot, item in equipment.get("held", {}).items() if item}
        worn = [entry.get("item") for entry in equipment.get("worn_items", []) if entry.get("worn", True) and entry.get("item")]
        known_spells = [payload.get("name") or key for key, payload in actor.get("known_spells", {}).items()]
        content = "\n".join(
            [
                f"[ACTOR: {name}]",
                f"Current scene: {scene_state.get('scene_id', 'unknown_scene')} at {scene_state.get('location', 'Unknown Location')}.",
                f"Conditions: {self._join_list(conditions)}.",
                f"Held items: {self._join_map(held)}.",
                f"Worn items: {self._join_list(worn)}.",
                f"Known spells: {self._join_list(sorted(known_spells))}.",
                f"Custom skills: {self._join_list(sorted(actor.get('custom_skills', {}).keys()))}.",
                f"Inventory refs: {self._join_list([name for name, qty in actor.get('inventory', {}).items() if int(qty) > 0])}.",
            ]
        )
        return self._build_insertion_entry(
            entry_id=f"actor_{self._normalize_key(actor_id)}",
            entry_type="actor",
            title=name,
            keywords=self._keywords_from_parts([name, actor_id, scene_state.get("location")]),
            secondary_keywords=self._keywords_from_parts(scene_state.get("scene_tags", [])),
            content=content,
            order=180,
            source_refs=[f"actor:{actor_id}", f"scene:{scene_state.get('scene_id', 'unknown_scene')}"],
        )

    def _scene_insertion_entry(self, scene_state: dict[str, Any]) -> dict[str, Any]:
        scene_id = scene_state.get("scene_id") or self._location_key(scene_state)
        location = scene_state.get("location") or "Unknown Location"
        content = "\n".join(
            [
                f"[ACTIVE SCENE: {location}]",
                f"Scene ID: {scene_id}.",
                f"Time: {scene_state.get('time_of_day') or 'unknown'}. Tension: {scene_state.get('tension_level', 0)}.",
                f"Nearby NPCs: {self._join_list(scene_state.get('nearby_npcs', []))}.",
                f"Notable objects: {self._join_list(scene_state.get('notable_objects', []))}.",
                f"Visible clues: {self._join_list(scene_state.get('visible_clues', []))}.",
                f"Active hazards: {self._join_list(scene_state.get('active_hazards', []))}.",
                f"Recent discoveries: {self._join_list(scene_state.get('recent_discoveries', []))}.",
                f"Exits: {self._join_list(scene_state.get('exits', []))}.",
                f"Tags: {self._join_list(scene_state.get('scene_tags', []))}.",
            ]
        )
        return self._build_insertion_entry(
            entry_id=f"scene_{self._normalize_key(scene_id)}",
            entry_type="active_scene",
            title=f"Active Scene: {location}",
            keywords=self._keywords_from_parts(
                [scene_id, location, scene_state.get("time_of_day")]
                + scene_state.get("nearby_npcs", [])
                + scene_state.get("notable_objects", [])
                + scene_state.get("visible_clues", [])
                + scene_state.get("active_hazards", [])
            ),
            secondary_keywords=self._keywords_from_parts(scene_state.get("scene_tags", [])),
            content=content,
            order=190,
            source_refs=[f"scene:{scene_id}"],
        )

    def _campaign_insertion_entry(self, campaign_state: dict[str, Any]) -> dict[str, Any]:
        quests = campaign_state.get("quests", {})
        relationships = campaign_state.get("relationships", {})
        relationship_scores = [f"{name} {payload.get('score', 0)}" for name, payload in relationships.items()]
        content = "\n".join(
            [
                f"[CAMPAIGN STATE: {campaign_state.get('current_arc', 'Unknown Arc')}]",
                f"Date: {campaign_state.get('date', {}).get('label') or 'unknown'}.",
                f"Active quests: {self._join_list([name for name, payload in quests.items() if payload.get('status') == 'active'])}.",
                f"Plot flags: {self._join_list(campaign_state.get('plot_flags', []))}.",
                f"Factions: {self._join_map(campaign_state.get('faction_standings', {}))}.",
                f"Relationships: {self._join_list(relationship_scores)}.",
            ]
        )
        return self._build_insertion_entry(
            entry_id="campaign_state",
            entry_type="campaign_state",
            title="Campaign State",
            keywords=self._keywords_from_parts([campaign_state.get("current_arc"), "campaign state"] + campaign_state.get("plot_flags", [])),
            secondary_keywords=[],
            content=content,
            constant=True,
            selective=False,
            order=210,
            source_refs=["campaign_state"],
        )

    def _quest_insertion_entry(self, quest_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        content = "\n".join(
            [
                f"[QUEST: {quest_name}]",
                f"Status: {payload.get('status', 'unknown')}.",
                f"Note: {payload.get('note') or payload.get('description') or 'No quest note recorded.'}",
                f"Entities: {self._join_list(payload.get('entities', []))}.",
                f"Tags: {self._join_list(payload.get('tags', []))}.",
            ]
        )
        return self._build_insertion_entry(
            entry_id=f"quest_{self._normalize_key(quest_name)}",
            entry_type="quest",
            title=quest_name,
            keywords=self._keywords_from_parts([quest_name] + payload.get("tags", []) + payload.get("entities", [])),
            secondary_keywords=[],
            content=content,
            order=150 + int(payload.get("importance", 0) or 0),
            source_refs=[f"quest:{quest_name}"],
        )

    def _relationship_insertion_entry(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        content = "\n".join(
            [
                f"[RELATIONSHIP: {name}]",
                f"Score: {payload.get('score', 'unknown')}.",
                f"Note: {payload.get('note') or payload.get('description') or payload.get('summary') or 'No relationship note recorded.'}",
            ]
        )
        return self._build_insertion_entry(
            entry_id=f"relationship_{self._normalize_key(name)}",
            entry_type="relationship",
            title=name,
            keywords=self._keywords_from_parts([name]),
            secondary_keywords=[],
            content=content,
            order=140,
            source_refs=[f"relationship:{name}"],
        )

    def _item_insertion_entry(
        self,
        actor_id: str,
        item_name: str,
        quantity: int,
        registry_entry: dict[str, Any],
        note: dict[str, Any],
        scene_state: dict[str, Any],
    ) -> dict[str, Any]:
        description = note.get("description") or registry_entry.get("description") or "No item description recorded."
        tags = list(dict.fromkeys([*(note.get("tags", []) or []), registry_entry.get("kind") or "item"]))
        content = "\n".join(
            [
                f"[ITEM: {item_name}]",
                f"Quantity carried by {actor_id}: {quantity}.",
                f"Description: {description}",
                f"Last seen location: {scene_state.get('location') or 'unknown'}.",
                f"Tags: {self._join_list(tags)}.",
            ]
        )
        return self._build_insertion_entry(
            entry_id=f"item_{self._normalize_key(item_name)}",
            entry_type="item",
            title=item_name,
            keywords=self._keywords_from_parts([item_name] + tags),
            secondary_keywords=self._keywords_from_parts([scene_state.get("location")]),
            content=content,
            order=125,
            source_refs=[f"inventory:{actor_id}:{item_name}"],
        )

    def _fact_insertion_entry(self, fact: dict[str, Any], entry_type: str) -> dict[str, Any]:
        fact_id = str(fact.get("id") or self._normalize_key(fact.get("text") or entry_type))
        text = str(fact.get("text") or fact.get("description") or "").strip()
        content = "\n".join(
            [
                f"[{entry_type.upper()}: {fact_id}]",
                text or "No fact text recorded.",
                f"Tags: {self._join_list(fact.get('tags', []))}.",
                f"Entities: {self._join_list(fact.get('entities', []))}.",
            ]
        )
        return self._build_insertion_entry(
            entry_id=f"{entry_type}_{self._normalize_key(fact_id)}",
            entry_type=entry_type,
            title=fact.get("title") or fact_id,
            keywords=self._keywords_from_parts([fact_id, text] + fact.get("tags", []) + fact.get("entities", [])),
            secondary_keywords=[],
            content=content,
            order=120 + int(fact.get("importance", 0) or 0),
            source_refs=[f"{entry_type}:{fact_id}"],
        )

    def _plot_flag_insertion_entry(self, flag_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        content = "\n".join(
            [
                f"[PLOT FLAG: {flag_name}]",
                payload.get("description") or "No plot flag description recorded.",
                f"Tags: {self._join_list(payload.get('tags', []))}.",
                f"Entities: {self._join_list(payload.get('entities', []))}.",
            ]
        )
        return self._build_insertion_entry(
            entry_id=f"plot_flag_{self._normalize_key(flag_name)}",
            entry_type="plot_flag",
            title=flag_name,
            keywords=self._keywords_from_parts([flag_name] + payload.get("tags", []) + payload.get("entities", [])),
            secondary_keywords=[],
            content=content,
            order=135 + int(payload.get("importance", 0) or 0),
            source_refs=[f"plot_flag:{flag_name}"],
        )

    def _journal_insertion_entry(self, journal_entry: dict[str, Any]) -> dict[str, Any]:
        kind = str(journal_entry.get("kind") or "journal")
        entry_id = str(journal_entry.get("id") or self._normalize_key(journal_entry.get("text") or kind))
        tags = journal_entry.get("tags", []) if isinstance(journal_entry.get("tags"), list) else []
        metadata = journal_entry.get("metadata", {}) if isinstance(journal_entry.get("metadata"), dict) else {}
        durable_facts = [str(fact).strip() for fact in metadata.get("durable_facts", []) if str(fact).strip()]
        content_lines = [
            f"[JOURNAL: {kind}]",
            str(journal_entry.get("text") or "").strip(),
            f"Scene: {journal_entry.get('scene_id') or 'no_scene'}.",
            f"Tags: {self._join_list(tags)}.",
        ]
        if durable_facts:
            content_lines.append(f"Durable facts: {self._join_list(durable_facts)}.")
        order_by_kind = {
            "session_summary": 170,
            "scene_summary": 165,
            "canon_fact": 155,
            "fact": 145,
            "quest_update": 145,
            "relationship_note": 140,
        }
        return self._build_insertion_entry(
            entry_id=f"journal_{self._normalize_key(entry_id)}",
            entry_type=f"journal_{kind}",
            title=f"{kind}: {entry_id}",
            keywords=self._keywords_from_parts(
                [kind, journal_entry.get("scene_id"), journal_entry.get("text")]
                + tags
                + durable_facts
            ),
            secondary_keywords=[],
            content="\n".join(content_lines),
            order=order_by_kind.get(kind, 130),
            source_refs=[f"journal:{entry_id}"],
        )

    def _build_insertion_entry(
        self,
        *,
        entry_id: str,
        entry_type: str,
        title: str,
        keywords: list[str],
        secondary_keywords: list[str],
        content: str,
        order: int,
        source_refs: list[str],
        constant: bool = False,
        selective: bool = True,
        depth: int = 4,
    ) -> dict[str, Any]:
        return {
            "id": entry_id,
            "entry_type": entry_type,
            "title": title,
            "keywords": self._dedupe_terms(keywords),
            "secondary_keywords": self._dedupe_terms(secondary_keywords),
            "content": content.strip(),
            "constant": constant,
            "selective": selective,
            "enabled": True,
            "order": order,
            "priority": order,
            "position": 0,
            "depth": depth,
            "source": "canonical_state",
            "source_refs": source_refs,
        }

    def _sorted_insertion_entries(self, entries: dict[str, Any]) -> list[dict[str, Any]]:
        if not isinstance(entries, dict):
            return []
        safe_entries = [entry for entry in entries.values() if isinstance(entry, dict)]
        return sorted(safe_entries, key=lambda entry: (-int(entry.get("order", 100) or 100), str(entry.get("title") or entry.get("id") or "")))

    def _build_sillytavern_world_info(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        world_entries: dict[str, dict[str, Any]] = {}
        for index, entry in enumerate(entries):
            world_entries[str(index)] = {
                "uid": index,
                "key": entry.get("keywords", []),
                "keysecondary": entry.get("secondary_keywords", []),
                "comment": entry.get("id") or entry.get("title") or f"entry_{index}",
                "content": entry.get("content", ""),
                "constant": bool(entry.get("constant", False)),
                "selective": bool(entry.get("selective", True)),
                "order": int(entry.get("order", 100) or 100),
                "position": int(entry.get("position", 0) or 0),
                "disable": not bool(entry.get("enabled", True)),
                "displayIndex": index,
                "addMemo": True,
                "group": "LLM RPG Runtime",
                "groupOverride": False,
                "groupWeight": 100,
                "sticky": 0,
                "cooldown": 0,
                "delay": 0,
                "probability": 100,
                "depth": int(entry.get("depth", 4) or 4),
                "useProbability": True,
                "role": None,
                "vectorized": False,
                "excludeRecursion": False,
                "preventRecursion": False,
                "delayUntilRecursion": False,
                "scanDepth": None,
                "caseSensitive": None,
                "matchWholeWords": None,
                "useGroupScoring": None,
                "automationId": "",
                "selectiveLogic": 0,
                "ignoreBudget": False,
                "matchPersonaDescription": False,
                "matchCharacterDescription": False,
                "matchCharacterPersonality": False,
                "matchCharacterDepthPrompt": False,
                "matchScenario": False,
                "matchCreatorNotes": False,
                "outletName": "",
                "triggers": [],
                "characterFilter": {
                    "isExclude": False,
                    "names": [],
                    "tags": [],
                },
                "extensions": {
                    "llm_rpg_bridge": {
                        "entry_type": entry.get("entry_type"),
                        "source_refs": entry.get("source_refs", []),
                    }
                },
            }
        return {
            "name": "LLM RPG Runtime Lorebook",
            "entries": world_entries,
        }

    def _keywords_from_parts(self, parts: list[Any]) -> list[str]:
        keywords: list[str] = []
        for part in parts:
            if part is None:
                continue
            if isinstance(part, list):
                keywords.extend(self._keywords_from_parts(part))
                continue
            value = str(part).strip()
            if not value:
                continue
            keywords.append(value)
            no_parenthetical = re.sub(r"\s*\([^)]*\)", "", value).strip()
            if no_parenthetical and no_parenthetical != value:
                keywords.append(no_parenthetical)
            keywords.extend(match.strip() for match in re.findall(r"\(([^)]*)\)", value) if match.strip())
            for token in re.split(r"[^A-Za-z0-9']+", value):
                token = token.strip()
                if len(token) >= 4 and token.lower() not in self.KEYWORD_STOPWORDS:
                    keywords.append(token)
        return self._dedupe_terms(keywords)

    def _dedupe_terms(self, terms: list[Any]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for term in terms:
            value = str(term or "").strip()
            if len(value) < 2 or len(value) > 96:
                continue
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            result.append(value)
        return result[:24]

    def _join_list(self, values: list[Any]) -> str:
        items = [str(value).strip() for value in values if str(value).strip()]
        return ", ".join(items) if items else "none"

    def _join_map(self, values: dict[str, Any]) -> str:
        items = [f"{key}: {value}" for key, value in values.items() if value not in (None, "")]
        return ", ".join(items) if items else "none"

    def _location_key(self, scene_state: dict[str, Any]) -> str:
        scene_id = scene_state.get("scene_id")
        if scene_id:
            return self._normalize_key(str(scene_id))
        return self._normalize_key(scene_state.get("location") or "unknown_location")

    def _normalize_key(self, value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower())
        return re.sub(r"_+", "_", normalized).strip("_") or "unknown"
