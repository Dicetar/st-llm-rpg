from __future__ import annotations

import re
from uuid import uuid4

from app.domain.models import (
    CommandExecutionRequest,
    NarrationResolveRequest,
    ResolvedTurnResponse,
    StateOverview,
    TurnSidecarWarning,
    TurnExecutionResponse,
)
from app.services.command_engine import CommandEngine
from app.services.extraction_service import ExtractionService
from app.services.lore_activation_service import LoreActivationService
from app.services.lm_studio_client import LMStudioClient
from app.services.repository import StateRepository

FRONTEND_ONLY_TURN_MARKERS = (
    "actor",
    "campaign",
    "lorebook",
    "rpg",
    "rpg_refresh",
    "rpg_resolve",
    "scene",
    "scene_close",
    "scene_draft_close",
    "scene_open",
    "session_summary",
)
FRONTEND_ONLY_TURN_PATTERN = re.compile(
    r"/(?P<name>" + "|".join(sorted(FRONTEND_ONLY_TURN_MARKERS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


class TurnResolutionService:
    def __init__(
        self,
        repository: StateRepository,
        *,
        command_engine: CommandEngine | None = None,
        lm_client: LMStudioClient | None = None,
        extraction_service: ExtractionService | None = None,
        lore_activation_service: LoreActivationService | None = None,
    ) -> None:
        self.repository = repository
        self.command_engine = command_engine or CommandEngine(repository)
        self.lm_client = lm_client or LMStudioClient()
        self.extraction_service = extraction_service or ExtractionService(repository)
        self.lore_activation_service = lore_activation_service or LoreActivationService(repository)

    def resolve_turn(self, request: NarrationResolveRequest) -> ResolvedTurnResponse:
        resolved_text = self._sanitize_resolve_text(request.raw_text)
        execution = self._execute_or_build_empty(request, resolved_text)
        execution.narration_context["recent_chat_messages"] = [message.model_dump() for message in request.recent_chat_messages]
        activated_lore_entries = self.lore_activation_service.select_entries(
            actor_id=request.actor_id,
            player_input=resolved_text or "",
            execution=execution,
            recent_chat_messages=[message.model_dump() for message in request.recent_chat_messages],
        )
        execution.narration_context["activated_lore_entries"] = [entry.model_dump() for entry in activated_lore_entries]
        execution.narration_context["lore_activation"] = {
            "selected_count": len(activated_lore_entries),
            "selected_ids": [entry.id for entry in activated_lore_entries],
        }
        warnings: list[TurnSidecarWarning] = []
        try:
            prose, narrator_model = self.lm_client.generate_narration(
                player_input=resolved_text or "",
                narration_context=execution.narration_context,
            )
        except Exception as exc:
            prose = self._build_narration_fallback(resolved_text, execution)
            narrator_model = None
            warnings.append(
                TurnSidecarWarning(
                    stage="narration",
                    error_code="narration_failed",
                    message=str(exc),
                )
            )

        response_payload = execution.model_dump()
        response_payload.update(
            {
                "prose": prose,
                "narrator_model": narrator_model,
                "activated_lore_entries": [entry.model_dump() for entry in activated_lore_entries],
                "extractor_model": None,
                "proposed_updates": [],
                "applied_updates": [],
                "staged_updates": [],
                "warnings": [warning.model_dump() for warning in warnings],
            }
        )

        if request.include_extraction and narrator_model is not None:
            effective_scene_id = execution.overview.current_scene_id or request.scene_id
            try:
                proposed_updates, extractor_model = self.lm_client.extract_updates(
                    player_input=resolved_text or "",
                    narration_context=execution.narration_context,
                    prose=prose,
                )
                apply_result = self.extraction_service.apply_updates(
                    turn_id=execution.turn_id,
                    actor_id=request.actor_id,
                    scene_id=effective_scene_id,
                    updates=proposed_updates.updates,
                    mode=request.mode,
                )
            except Exception as exc:
                warnings.append(
                    TurnSidecarWarning(
                        stage="extraction",
                        error_code="extraction_failed",
                        message=str(exc),
                    )
                )
            else:
                if apply_result["applied_updates"]:
                    refreshed_overview = self.command_engine.build_overview(request.actor_id)
                else:
                    refreshed_overview = execution.overview

                response_payload["overview"] = refreshed_overview.model_dump()
                response_payload["refresh_hints"] = sorted(set(execution.refresh_hints + apply_result["refresh_hints"]))
                response_payload["lore_sync"] = apply_result["lore_sync"] or execution.lore_sync
                response_payload["proposed_updates"] = [update.model_dump() for update in proposed_updates.updates]
                response_payload["applied_updates"] = [mutation.model_dump() for mutation in apply_result["applied_updates"]]
                response_payload["staged_updates"] = [update.model_dump() for update in apply_result["staged_updates"]]
                response_payload["extractor_model"] = extractor_model

        response_payload["warnings"] = [warning.model_dump() for warning in warnings]

        return ResolvedTurnResponse.model_validate(response_payload)

    def _execute_or_build_empty(self, request: NarrationResolveRequest, resolved_text: str | None) -> TurnExecutionResponse:
        invocations = request.commands or self.command_engine.parse_text(resolved_text or "")
        if invocations:
            return self.command_engine.execute(
                CommandExecutionRequest(
                    actor_id=request.actor_id,
                    scene_id=request.scene_id,
                    text=resolved_text,
                    raw_text=resolved_text,
                    commands=invocations,
                    mode=request.mode,
                    failure_policy=request.failure_policy,
                )
            )

        if not resolved_text:
            raise ValueError("resolve-turn requires text or explicit commands.")

        overview = self.command_engine.build_overview(request.actor_id)
        turn_id = f"turn_{uuid4().hex[:10]}"
        narration_context = self._build_empty_narration_context(turn_id, request, overview, resolved_text)
        return TurnExecutionResponse(
            turn_id=turn_id,
            mode=request.mode,
            failure_policy=request.failure_policy,
            parsed_commands=[],
            results=[],
            command_count=0,
            success_count=0,
            failure_count=0,
            has_failures=False,
            rolled_back=False,
            committed=False,
            state_changes=[],
            discarded_state_changes=[],
            overview=overview,
            refresh_hints=["overview"],
            event_ids=[],
            narration_context=narration_context,
            lore_sync={},
        )

    def _build_empty_narration_context(
        self,
        turn_id: str,
        request: NarrationResolveRequest,
        overview: StateOverview,
        resolved_text: str | None,
    ) -> dict:
        return {
            "turn_id": turn_id,
            "actor_id": request.actor_id,
            "mode": request.mode,
            "failure_policy": request.failure_policy,
            "raw_text": resolved_text,
            "recent_chat_messages": [message.model_dump() for message in request.recent_chat_messages],
            "scene": {
                "scene_id": overview.current_scene_id,
                "location": overview.current_location,
            },
            "command_results": [],
            "state_changes": [],
            "post_command_overview": overview.model_dump(),
            "refresh_hints": ["overview"],
            "turn_summary": {
                "command_count": 0,
                "success_count": 0,
                "failure_count": 0,
                "has_failures": False,
                "rolled_back": False,
                "committed": False,
            },
            "lore_sync": {},
        }

    def _sanitize_resolve_text(self, raw_text: str | None) -> str | None:
        if raw_text is None:
            return None
        sanitized = FRONTEND_ONLY_TURN_PATTERN.sub("", raw_text)
        sanitized = re.sub(r"[ \t]{2,}", " ", sanitized)
        sanitized = re.sub(r"\s+\n", "\n", sanitized)
        sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
        sanitized = re.sub(r"\s+([,.;:!?])", r"\1", sanitized)
        sanitized = sanitized.strip()
        return sanitized or None

    def _build_narration_fallback(
        self,
        player_input: str | None,
        execution: TurnExecutionResponse,
    ) -> str:
        if execution.rolled_back:
            lead = "The backend rolled back this turn after a command failure, and live narration was unavailable."
        elif execution.mode == "dry_run":
            lead = "The backend simulated this turn, but live narration was unavailable."
        elif execution.committed:
            lead = "The backend applied this turn, but live narration was unavailable."
        else:
            lead = "The backend accepted this turn, but live narration was unavailable."

        lines = [lead]
        clean_player_input = (player_input or "").strip()
        if clean_player_input:
            lines.extend(["", f"Player intent: {clean_player_input}"])

        if execution.results:
            lines.extend(["", "Authoritative outcome:"])
            for result in execution.results[:4]:
                command_text = f"/{result.name}"
                if result.argument:
                    command_text = f"{command_text} {result.argument}"
                status = "succeeded" if result.ok else "failed"
                lines.append(f"- {command_text}: {status}. {result.message}")
            extra_results = len(execution.results) - 4
            if extra_results > 0:
                lines.append(f"- {extra_results} additional command result(s) omitted.")
        elif execution.has_failures:
            lines.extend(["", "No command mutations were committed."])

        location = execution.overview.current_location
        scene_id = execution.overview.current_scene_id
        if location or scene_id:
            lines.extend(["", f"Current scene: {location or 'Unknown'} ({scene_id or 'no_scene_id'})."])

        return "\n".join(lines).strip()
