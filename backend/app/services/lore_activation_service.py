from __future__ import annotations

import re
from typing import Any

from app.config import LORE_ACTIVATION_MAX_ENTRIES, LORE_ACTIVATION_MAX_TOTAL_CHARS
from app.domain.models import ActivatedLoreEntry, TurnExecutionResponse
from app.services.lore_update_service import LoreUpdateService
from app.services.repository import StateRepository


class LoreActivationService:
    def __init__(
        self,
        repository: StateRepository,
        *,
        lore_service: LoreUpdateService | None = None,
        max_entries: int = LORE_ACTIVATION_MAX_ENTRIES,
        max_total_chars: int = LORE_ACTIVATION_MAX_TOTAL_CHARS,
    ) -> None:
        self.repository = repository
        self.lore_service = lore_service or LoreUpdateService(repository)
        self.max_entries = max(1, int(max_entries))
        self.max_total_chars = max(500, int(max_total_chars))

    def select_entries(
        self,
        *,
        actor_id: str,
        player_input: str,
        execution: TurnExecutionResponse,
        recent_chat_messages: list[dict[str, Any]] | None = None,
    ) -> list[ActivatedLoreEntry]:
        payload = self.lore_service.build_insertion_payload(actor_id=actor_id, sync=True)
        scene_state = self.repository.load_scene_state()
        campaign_state = self.repository.load_campaign_state()
        entries = payload.get("entries", []) if isinstance(payload, dict) else []
        if not isinstance(entries, list):
            return []

        actor_entry_id = f"actor_{self._normalize_key(actor_id)}"
        current_scene_id = execution.overview.current_scene_id or scene_state.get("scene_id") or ""
        current_scene_entry_id = f"scene_{self._normalize_key(current_scene_id)}" if current_scene_id else ""
        active_quests = {str(name).strip().casefold() for name in execution.overview.active_quests if str(name).strip()}
        nearby_npcs = {str(name).strip().casefold() for name in scene_state.get("nearby_npcs", []) if str(name).strip()}
        context_terms = self._build_context_terms(
            player_input=player_input,
            execution=execution,
            scene_state=scene_state,
            campaign_state=campaign_state,
            recent_chat_messages=recent_chat_messages or [],
        )

        mandatory: list[ActivatedLoreEntry] = []
        scored: list[ActivatedLoreEntry] = []

        for raw_entry in entries:
            if not isinstance(raw_entry, dict):
                continue
            score, reasons, forced = self._score_entry(
                raw_entry,
                context_terms=context_terms,
                actor_entry_id=actor_entry_id,
                current_scene_entry_id=current_scene_entry_id,
                active_quests=active_quests,
                nearby_npcs=nearby_npcs,
            )
            if not forced and score <= 0:
                continue

            entry = ActivatedLoreEntry(
                id=str(raw_entry.get("id") or ""),
                title=str(raw_entry.get("title") or raw_entry.get("id") or "Lore Entry"),
                entry_type=str(raw_entry.get("entry_type") or "entry"),
                content=str(raw_entry.get("content") or ""),
                keywords=[str(value) for value in raw_entry.get("keywords", []) if str(value).strip()],
                secondary_keywords=[str(value) for value in raw_entry.get("secondary_keywords", []) if str(value).strip()],
                source_refs=[str(value) for value in raw_entry.get("source_refs", []) if str(value).strip()],
                match_reasons=reasons,
                score=score,
                order=int(raw_entry.get("order", 0) or 0),
                constant=bool(raw_entry.get("constant", False)),
                selective=bool(raw_entry.get("selective", True)),
            )
            if forced:
                mandatory.append(entry)
            else:
                scored.append(entry)

        selected: list[ActivatedLoreEntry] = []
        seen_ids: set[str] = set()
        total_chars = 0

        for bucket in (
            sorted(mandatory, key=lambda entry: (-entry.score, -entry.order, entry.id)),
            sorted(scored, key=lambda entry: (-entry.score, -entry.order, entry.id)),
        ):
            for entry in bucket:
                if entry.id in seen_ids:
                    continue
                entry_size = len(entry.content) + sum(len(value) for value in entry.keywords[:6])
                if selected and (len(selected) >= self.max_entries or total_chars + entry_size > self.max_total_chars):
                    continue
                selected.append(entry)
                seen_ids.add(entry.id)
                total_chars += entry_size
                if len(selected) >= self.max_entries:
                    return selected

        return selected

    def _score_entry(
        self,
        entry: dict[str, Any],
        *,
        context_terms: dict[str, list[str]],
        actor_entry_id: str,
        current_scene_entry_id: str,
        active_quests: set[str],
        nearby_npcs: set[str],
    ) -> tuple[int, list[str], bool]:
        entry_id = str(entry.get("id") or "")
        entry_type = str(entry.get("entry_type") or "")
        reasons: list[str] = []
        score = 0
        forced = False

        if entry_id == actor_entry_id:
            score += 1000
            reasons.append("mandatory_actor_context")
            forced = True
        if current_scene_entry_id and entry_id == current_scene_entry_id:
            score += 950
            reasons.append("mandatory_scene_context")
            forced = True
        if bool(entry.get("constant")) or bool(entry.get("selective")) is False:
            score += 800
            reasons.append("constant_entry")
            forced = True

        order = int(entry.get("order", 0) or 0)
        score += min(60, max(0, order // 4))

        player_primary_matches = self._find_keyword_matches(entry.get("keywords", []), context_terms.get("player", []))
        scene_primary_matches = self._find_keyword_matches(entry.get("keywords", []), context_terms.get("scene", []))
        turn_primary_matches = self._find_keyword_matches(entry.get("keywords", []), context_terms.get("turn", []))
        chat_primary_matches = self._find_keyword_matches(entry.get("keywords", []), context_terms.get("chat", []))
        secondary_matches = self._find_keyword_matches(entry.get("secondary_keywords", []), context_terms.get("player", []) + context_terms.get("scene", []) + context_terms.get("chat", []))

        for keyword in player_primary_matches[:4]:
            score += 120 if " " in keyword else 65
            reasons.append(f"player_keyword:{keyword}")
        for keyword in chat_primary_matches[:3]:
            score += 75 if " " in keyword else 35
            reasons.append(f"chat_keyword:{keyword}")
        for keyword in scene_primary_matches[:3]:
            score += 40
            reasons.append(f"scene_keyword:{keyword}")
        for keyword in turn_primary_matches[:2]:
            score += 20
            reasons.append(f"turn_keyword:{keyword}")
        for keyword in secondary_matches[:3]:
            score += 25
            reasons.append(f"secondary_keyword:{keyword}")

        entry_title = str(entry.get("title") or "").strip().casefold()
        if entry_type == "quest" and entry_title in active_quests:
            score += 140
            reasons.append("active_quest")
        if entry_type == "relationship" and entry_title in nearby_npcs:
            score += 110
            reasons.append("scene_npc")
        if entry_type.startswith("journal_") and (player_primary_matches or chat_primary_matches):
            score += 70
            reasons.append("journal_memory_match")

        return score, self._dedupe(reasons), forced

    def _build_context_terms(
        self,
        *,
        player_input: str,
        execution: TurnExecutionResponse,
        scene_state: dict[str, Any],
        campaign_state: dict[str, Any],
        recent_chat_messages: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        scene_terms: list[Any] = [
            execution.overview.current_scene_id,
            execution.overview.current_location,
            scene_state.get("scene_id"),
            scene_state.get("location"),
            scene_state.get("time_of_day"),
            *scene_state.get("scene_tags", []),
            *scene_state.get("nearby_npcs", []),
            *scene_state.get("notable_objects", []),
            *scene_state.get("visible_clues", []),
            *scene_state.get("active_hazards", []),
            *scene_state.get("recent_discoveries", []),
            *scene_state.get("exits", []),
        ]
        turn_terms: list[Any] = [
            execution.overview.actor_name,
            *execution.overview.active_quests,
            campaign_state.get("current_arc"),
            *campaign_state.get("plot_flags", []),
        ]
        for result in execution.results:
            turn_terms.append(result.name)
            if result.argument:
                turn_terms.append(result.argument)
            if result.message:
                turn_terms.append(result.message)
        chat_terms: list[Any] = []
        for message in recent_chat_messages:
            if not isinstance(message, dict):
                continue
            if str(message.get("role") or "").strip().lower() not in {"user", "assistant"}:
                continue
            if str(message.get("content") or "").strip():
                chat_terms.append(message.get("content"))
            if str(message.get("name") or "").strip():
                chat_terms.append(message.get("name"))
        return {
            "player": [self._normalize_text(player_input)] if str(player_input or "").strip() else [],
            "scene": [self._normalize_text(term) for term in scene_terms if str(term or "").strip()],
            "turn": [self._normalize_text(term) for term in turn_terms if str(term or "").strip()],
            "chat": [self._normalize_text(term) for term in chat_terms if str(term or "").strip()],
        }

    def _find_keyword_matches(self, keywords: Any, context_terms: list[str]) -> list[str]:
        matches: list[str] = []
        for keyword in keywords if isinstance(keywords, list) else []:
            normalized = self._normalize_text(keyword)
            if not normalized:
                continue
            if any(self._contains_keyword(term, normalized) for term in context_terms):
                matches.append(str(keyword).strip())
        return matches

    def _contains_keyword(self, haystack: str, needle: str) -> bool:
        if not haystack or not needle:
            return False
        if " " in needle:
            return needle in haystack
        return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack) is not None

    def _normalize_text(self, value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "").strip().lower())

    def _normalize_key(self, value: Any) -> str:
        return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())).strip("_")

    def _dedupe(self, values: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for value in values:
            key = str(value).strip().casefold()
            if not key or key in seen:
                continue
            seen.add(key)
            result.append(str(value).strip())
        return result
